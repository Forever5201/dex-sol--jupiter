/**
 * 分析Vault模式池子的is_active逻辑BUG
 * 
 * 根本原因：
 * 1. Vault模式池子的储备量在外部vault账户中，不在池子账户中
 * 2. get_reserve_a/b()从池子账户读取，返回0或占位值
 * 3. is_active()检查：reserve > 0
 * 4. 第一次接收数据时reserve=0 → is_active()=false → 被跳过
 * 5. 被跳过 → 不订阅vault → 永远收不到数据 → 死锁！
 */

const VAULT_POOLS = [
  {
    name: "SolFi V2 - USDC/USDT",
    address: "65ZHSArs5XxPseKQbB1B4r16vDxMWnCxHMzogDAqiDUc",
    type: "solfi_v2",
    has_vault: true,
    impact: "37%机会损失"
  },
  {
    name: "SolFi V2 - USDC/USDT #2",
    address: "FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32",
    type: "solfi_v2",
    has_vault: true,
    impact: "37%机会损失"
  },
  {
    name: "GoonFi - USDC/SOL",
    address: "4uWuh9fC7rrZKrN8ZdJf69MN1e2S7FPpMqcsyY1aof6K",
    type: "goonfi",
    has_vault: true,
    impact: "6%机会损失"
  },
  {
    name: "HumidiFi - JUP/USDC (已禁用)",
    address: "hKgG7iEDRFNsJSwLYqz8ETHuZwzh6qMMLow8VXa8pLm",
    type: "humidifi",
    has_vault: true,
    impact: "已禁用"
  },
  {
    name: "HumidiFi - USDC/USDT (已禁用)",
    address: "6n9VhCwQ7EwK6NqFDjnHPzEk6wZdRBTfh43RFgHQWHuQ",
    type: "humidifi",
    has_vault: true,
    impact: "已禁用"
  },
  {
    name: "HumidiFi - USD1/USDC (已禁用)",
    address: "3QYYvFWgSuGK8bbxMSAYkCqE8QfSuFtByagnZAuekia2",
    type: "humidifi",
    has_vault: true,
    impact: "已禁用"
  },
];

const NON_VAULT_POOLS = [
  {
    name: "Raydium V4",
    count: 13,
    stores_reserves_in_pool: true,
    works: true
  },
  {
    name: "Raydium CLMM",
    count: 1,
    stores_reserves_in_pool: true,
    works: true
  },
  {
    name: "Meteora DLMM",
    count: 1,
    stores_reserves_in_pool: true,
    works: true
  },
  {
    name: "AlphaQ",
    count: 3,
    stores_reserves_in_pool: true,
    works: true,
    note: "使用虚拟储备量"
  },
  {
    name: "Lifinity V2",
    count: 2,
    stores_reserves_in_pool: true,
    works: true,
    note: "储备量直接在池子账户中(offset 576,696)"
  },
  {
    name: "TesseraV",
    count: 1,
    stores_reserves_in_pool: true,
    works: true
  },
  {
    name: "Stabble",
    count: 2,
    stores_reserves_in_pool: true,
    works: true
  },
  {
    name: "PancakeSwap",
    count: 1,
    stores_reserves_in_pool: true,
    works: true
  },
];

console.log("🔍 Vault模式池子 - is_active() BUG分析\n");
console.log("=" .repeat(80));
console.log("问题池子（受BUG影响）:");
console.log("=" .repeat(80));

let buggy_count = 0;
VAULT_POOLS.forEach(pool => {
  if (!pool.address.includes("已禁用")) {
    buggy_count++;
    console.log(`\n❌ ${pool.name}`);
    console.log(`   地址: ${pool.address}`);
    console.log(`   类型: ${pool.type}`);
    console.log(`   影响: ${pool.impact}`);
    console.log(`   问题: is_active()检查reserve>0，但reserve在vault中，池子账户中为0`);
    console.log(`   结果: 第一次更新时is_active()=false → 被跳过 → 永远收不到数据`);
  }
});

console.log(`\n${"=".repeat(80)}`);
console.log("正常工作的池子:");
console.log("=" .repeat(80));

let working_count = 0;
NON_VAULT_POOLS.forEach(pool => {
  working_count += pool.count;
  console.log(`\n✅ ${pool.name} (${pool.count}个池子)`);
  console.log(`   储备量位置: 池子账户内`);
  console.log(`   is_active()检查: reserve>0 ✓`);
  if (pool.note) {
    console.log(`   说明: ${pool.note}`);
  }
});

console.log(`\n${"=".repeat(80)}`);
console.log("统计汇总:");
console.log("=" .repeat(80));
console.log(`\n配置的池子总数: 27个`);
console.log(`正常工作: ${working_count}个 (储备量在池子账户中)`);
console.log(`受BUG影响: ${buggy_count}个 (储备量在vault账户中)`);
console.log(`已禁用: 3个 (HumidiFi)`);
console.log(`\n${buggy_count}个池子无法工作 = 27 - ${working_count} - 3 = ${27 - working_count - 3}个`);

console.log(`\n${"=".repeat(80)}`);
console.log("根本原因分析:");
console.log("=" .repeat(80));

console.log(`
🎯 核心问题：is_active()逻辑与Vault模式不兼容

代码位置：src/deserializers/solfi_v2.rs (line 175-178)
\`\`\`rust
fn is_active(&self) -> bool {
    // ❌ BUG: SolFi V2储备量在vault中，这里返回的是0！
    self.get_reserve_a() > 0 || self.get_reserve_b() > 0
}
\`\`\`

执行流程（死锁循环）：
1. WebSocket收到池子账户更新
2. 反序列化成功 → SolFiV2PoolState
3. 调用pool.is_active()
4. get_reserve_a()从池子账户读取 → 返回0（因为储备量在vault中）
5. is_active()返回false
6. websocket.rs:392-394: if !pool.is_active() { return Ok(()); }
7. 池子被跳过，不执行后续逻辑
8. 🚫 永远不会到达vault订阅代码（第398-445行）
9. 🚫 永远收不到vault数据
10. 🚫 永远无法计算正确价格
11. 🚫 永远无法用于套利

同样的问题存在于：
- src/deserializers/goonfi.rs (line 126-128)
- src/deserializers/humidifi.rs (line 149-153，但已禁用)
`);

console.log(`\n${"=".repeat(80)}`);
console.log("解决方案:");
console.log("=" .repeat(80));

console.log(`
✅ 方案1：修改is_active()逻辑（推荐）

对于有vault的池子，is_active()应该：
- 不检查储备量（因为储备量不在池子账户中）
- 检查vault地址是否有效
- 或者直接返回true

\`\`\`rust
// SolFi V2
fn is_active(&self) -> bool {
    // 对于vault模式，检查vault地址是否有效
    // 储备量在vault中，不在池子账户中
    self.token_a_vault() != &Pubkey::default() && 
    self.token_b_vault() != &Pubkey::default()
}

// 或者更简单：
fn is_active(&self) -> bool {
    true  // Vault模式池子总是active（储备量在vault中）
}
\`\`\`

✅ 方案2：在websocket.rs中特殊处理vault池子

在跳过inactive池子之前，检查是否有vault：
\`\`\`rust
if !pool.is_active() {
    // 🌐 特殊处理：如果池子有vault，即使储备量为0也继续处理
    if pool.get_vault_addresses().is_none() {
        return Ok(()); // 只跳过非vault模式的inactive池子
    }
}
\`\`\`

推荐使用方案1，因为它更符合"is_active"的语义。
`);

console.log(`\n${"=".repeat(80)}`);
console.log("修复后的预期结果:");
console.log("=" .repeat(80));

console.log(`
修复前：
- 可用池子: 24个（仅非vault模式）
- SolFi V2: ❌ 无数据（37%机会损失）
- GoonFi: ❌ 无数据（6%机会损失）
- 总机会覆盖率: ~57%

修复后：
- 可用池子: 27个（全部）
- SolFi V2: ✅ 正常工作（+37%机会）
- GoonFi: ✅ 正常工作（+6%机会）
- 总机会覆盖率: ~100%

预计新增日收益: $1,000-2,000/天
`);

console.log(`\n${"=".repeat(80)}`);
console.log("🎯 结论");
console.log("=" .repeat(80));

console.log(`
这不是订阅问题，也不是流动性问题。

这是一个**代码逻辑BUG**：
- is_active()的实现假设储备量总是在池子账户中
- 但Vault模式打破了这个假设
- 导致vault模式池子永远被认为是"inactive"而被跳过

修复非常简单，只需要修改3个文件的is_active()方法即可。

透过现象看本质：
现象 → "14个池子没有数据"
本质 → "is_active()逻辑与Vault模式架构不兼容"
`);





