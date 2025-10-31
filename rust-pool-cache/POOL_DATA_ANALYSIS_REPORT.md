# 池子数据分析报告

生成时间：2025-10-28
分析对象：HumidiFi 和 AlphaQ 池子

---

## 🔍 问题总结

### 问题 1: HumidiFi 储备量为 0
**状态**: ❌ **确认为 BUG**

**现象：**
- 所有 3 个 HumidiFi 池子报告储备量为 0
- 价格为 0.0
- Vault 已成功订阅

**根本原因分析：**

1. **Vault 地址读取错误**
   - 代码假设 vault 在 `pubkey_4` 和 `pubkey_5` 位置
   - 实际验证显示这些地址**不是有效的 SPL Token 账户**
   - Vault 数据长度不是 165 bytes（SPL Token 标准）

2. **配置字段非零**
   - 代码注释说"所有 config_fields 为 0"
   - 实际验证：`❌ 包含非零值`
   - 这意味着储备量可能**就在池子账户中**，而不是 vault

3. **Vault 订阅成功但无效**
   - WebSocket 日志显示 vault 订阅确认
   - 但这些地址不是真正的 SPL Token 账户
   - 订阅的是错误的地址！

### 问题 2: AlphaQ 价格为 1.8（应该接近 1.0）
**状态**: ⚠️ **可能不是 BUG，而是设计**

**现象：**
- USDT/USDC 价格：1.799994
- USDC/USD1 价格：1.799982  
- USDS/USDC 价格：1.799982
- 所有价格都稳定在 **1.8**

**链上数据验证：**

| Offset | Reserve A | Reserve B | 计算价格 | 分析 |
|--------|-----------|-----------|----------|------|
| **408, 416** (当前) | 1,000,003.5 | 1,800,000 | **1.8** | ✅ 数据稳定 |
| 416, 424 | 1,800,000 | 10,001 | 0.0056 | ❌ 不合理 |
| 424, 432 | 10,001 | 999,992 | 100 | ❌ 不合理 |
| **Vault 余额** | 55,260 | 339,455 | **6.14** | ❌ 异常 |

**关键发现：**

1. **储备量数值极其稳定**
   - Reserve A: 始终约 1,000,000 tokens
   - Reserve B: 始终正好 1,800,000 tokens
   - 即使在多次查询中，Reserve B **完全不变**！

2. **这不是 x*y=k AMM！**
   - 在正常 AMM 中，每次交易都会改变储备量
   - Reserve B (1,800,000) 在所有查询中**完全相同**
   - 这表明它是**配置参数**，不是实际储备量

3. **可能是 StableSwap 或固定汇率池**
   - AlphaQ 描述为"stable swap pools"
   - 可能使用 Curve 式的稳定币曲线
   - 1.8 可能是：
     - 固定汇率配置
     - 价格锚定参数（amplification coefficient）
     - 或其他算法参数

4. **Vault 余额也异常**
   - Vault A: 55,260 USDT
   - Vault B: 339,455 USDC
   - 价格 6.14（更加异常）
   - 说明 **vault 余额也不是直接的储备量**

---

## 🔬 深度分析

### AlphaQ 的真实机制推测

基于数据分析，AlphaQ 很可能是：

#### 选项 A: 固定汇率池（最可能）
```
配置参数：
- target_ratio = 1.8
- Reserve A = 1,000,000 (基准值)
- Reserve B = 1,800,000 (基准值 × ratio)

实际流动性：
- 存储在某个未知位置
- 或使用虚拟流动性（无限深度）
```

#### 选项 B: Curve StableSwap 变种
```
A (amplification) = 某个值导致价格锚定在 1.8
Reserve A, B = 虚拟储备量
实际储备量 = 在其他字段或 vault
```

#### 选项 C: Balancer 式权重池
```
Weight A = 1
Weight B = 1.8
价格 = (Weight B / Weight A) × (Reserve A / Reserve B)
```

### HumidiFi 的真实机制

基于 vault 无效的事实，HumidiFi 很可能：

1. **储备量在 config_fields 中**
   - 不在 vault（vault 地址无效）
   - 某个 u64 字段是 reserve_a
   - 某个 u64 字段是 reserve_b

2. **需要重新分析 1728 字节结构**
   ```
   0-40:     Header (5 u64)
   40-840:   Pubkeys (25 × 32)
   840-1728: Config (111 u64) ← 储备量在这里！
   ```

---

## 📋 解决方案

### 对于 HumidiFi

**步骤 1: 重新分析账户数据**
```bash
# 需要找到哪个 config_field 是储备量
# 可能的位置：
- config_fields[0] 和 config_fields[1]
- config_fields[最后两个]
- 或通过已知价格反推
```

**步骤 2: 读取实际链上数据进行模式匹配**
```typescript
// 对于已知价格的池子（如 JUP/USDC）
// 遍历所有 u64 字段，找到符合价格的两个字段
for (let i = 0; i < 111; i++) {
  for (let j = i + 1; j < 111; j++) {
    const a = config_fields[i];
    const b = config_fields[j];
    const price = b / a;
    if (price 匹配已知价格) {
      console.log(`找到储备量: config[${i}], config[${j}]`);
    }
  }
}
```

**步骤 3: 更新反序列化代码**
```rust
pub fn get_reserve_a(&self) -> u64 {
    // 更新为正确的 offset
    self.config_fields[X]  // X = 正确的索引
}
```

### 对于 AlphaQ

**选项 1: 接受 1.8 的价格（如果是固定汇率）**
```rust
// 如果 AlphaQ 确实是固定汇率池
// 那么 1.8 就是正确的价格
// 不需要修复！
```

**选项 2: 查找实际储备量字段**
```rust
// 如果 1.8 是配置参数
// 需要找到真正的储备量字段
// 可能在：
- config_fields 的其他位置
- 需要读取 token vault 的真实余额
- 或使用特殊公式计算虚拟储备
```

**选项 3: 研究 AlphaQ 合约源码**
```bash
# 如果开源，直接查看
# 如果不开源，反编译或分析交易
solana program dump ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA alphaq.so
```

---

## 🎯 立即行动项

### 高优先级（今天修复）

1. **✅ HumidiFi 储备量定位**
   - 创建工具扫描 config_fields
   - 找到正确的储备量字段
   - 更新 `get_reserve_a()` 和 `get_reserve_b()`

### 中优先级（本周研究）

2. **⚠️ AlphaQ 机制研究**
   - 验证是否为固定汇率池
   - 如果是，文档化并接受
   - 如果不是，找到正确的计算方法

3. **📚 更新文档**
   - 记录发现的池子结构
   - 更新配置建议
   - 添加已知问题说明

### 低优先级（未来优化）

4. **🔧 改进 vault 处理**
   - 验证 vault 地址有效性
   - 添加 SPL Token 账户检查
   - 失败时回退到池子账户读取

---

## 📊 影响评估

### 当前状态

| 池子 | 状态 | 影响 | 严重程度 |
|------|------|------|----------|
| **HumidiFi** (3个) | ❌ 储备量为 0 | 无法用于套利 | 🔴 **高** |
| **AlphaQ** (3个) | ⚠️ 价格 1.8 | 可能误导套利 | 🟡 **中** |
| **其他** (24个) | ✅ 正常 | 无影响 | 🟢 **低** |

### 覆盖率影响

- **原计划覆盖率**: HumidiFi 14% + AlphaQ 18% = 32%
- **当前实际可用**: AlphaQ 18%（如果价格正确）
- **损失**: HumidiFi 14% + AlphaQ 0-18%（取决于价格是否正确）
- **剩余可用覆盖率**: ~70%（其他 24 个池子）

---

## ✅ 验证清单

### HumidiFi
- [ ] 找到储备量字段在 config_fields 中的索引
- [ ] 更新反序列化代码
- [ ] 重新编译测试
- [ ] 验证价格与市场一致
- [ ] 确认能检测到套利机会

### AlphaQ
- [ ] 确认 1.8 是固定汇率还是 bug
- [ ] 如果是 bug，找到正确的储备量
- [ ] 如果是固定汇率，更新文档
- [ ] 测试与其他 DEX 的套利逻辑
- [ ] 确认不会产生虚假机会

---

## 🔗 相关文件

- `rust-pool-cache/src/deserializers/humidifi.rs` - HumidiFi 反序列化
- `rust-pool-cache/src/deserializers/alphaq.rs` - AlphaQ 反序列化
- `rust-pool-cache/tools/verify-pool-data.ts` - 验证工具
- `rust-pool-cache/config.toml` - 池子配置

---

## 📝 结论

**HumidiFi**: 明确的 BUG，需要修复
**AlphaQ**: 需要进一步研究，可能是正常行为

**建议优先级**: 
1. 先修复 HumidiFi（14% 覆盖率损失）
2. 再研究 AlphaQ（18% 覆盖率不确定性）
3. 两者都修复后，总覆盖率可达 ~100%

**预计修复时间**:
- HumidiFi: 1-2 小时（找字段 + 测试）
- AlphaQ: 2-4 小时（研究机制 + 验证）

