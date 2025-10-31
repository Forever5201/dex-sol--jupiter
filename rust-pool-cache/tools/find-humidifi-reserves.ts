/**
 * HumidiFi 储备量字段定位工具
 * 通过已知价格反推储备量字段位置
 */

import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';
const connection = new Connection(RPC_URL, 'confirmed');

// HumidiFi JUP/USDC 池子 - 我们知道JUP的大致价格
const HUMIDIFI_JUP_USDC = 'hKgG7iEDRFNsJSwLYqz8ETHuZwzh6qMMLow8VXa8pLm';

// 从CoinGecko或其他来源获取的大致JUP价格 (USDC per JUP)
// 假设 JUP ≈ $0.8-1.2 USDC
const EXPECTED_JUP_PRICE_MIN = 0.6;
const EXPECTED_JUP_PRICE_MAX = 1.5;

async function analyzeHumidiFiPool() {
  console.log('\n🔍 HumidiFi 储备量字段定位器');
  console.log('='.repeat(60));
  
  const accountInfo = await connection.getAccountInfo(new PublicKey(HUMIDIFI_JUP_USDC));
  if (!accountInfo) {
    console.log('❌ 无法获取池子账户数据');
    return;
  }

  const data = accountInfo.data;
  console.log(`✅ 账户数据大小: ${data.length} bytes`);
  
  // 结构：
  // 0-40: Header (5 u64)
  // 40-840: Pubkeys (25 × 32)
  // 840-1728: Config fields (111 u64)
  
  console.log('\n📊 分析 111 个配置字段...\n');
  
  const configStart = 40 + 25 * 32; // 840
  const configFields: bigint[] = [];
  
  for (let i = 0; i < 111; i++) {
    const offset = configStart + i * 8;
    const value = data.readBigUInt64LE(offset);
    configFields.push(value);
  }
  
  // 统计非零字段
  const nonZeroFields = configFields
    .map((val, idx) => ({ idx, val }))
    .filter(f => f.val !== 0n);
  
  console.log(`📌 非零字段数量: ${nonZeroFields.length} / 111`);
  console.log(`   (注释说全为0是错误的！)\n`);
  
  // 显示前20个非零字段
  console.log('前20个非零字段:');
  nonZeroFields.slice(0, 20).forEach(({ idx, val }) => {
    const valNum = Number(val);
    const formatted = valNum / 1e6; // 假设6位小数
    console.log(`  config[${idx.toString().padStart(3)}] = ${val.toString().padStart(20)} (${formatted.toFixed(2)})`);
  });
  
  console.log('\n🎯 搜索可能的储备量字段对...\n');
  
  // 方法1: 找两个大的数值，其比值在预期价格范围内
  const candidates: Array<{
    idxA: number;
    idxB: number;
    reserveA: bigint;
    reserveB: bigint;
    price: number;
  }> = [];
  
  for (let i = 0; i < 111; i++) {
    for (let j = i + 1; j < 111; j++) {
      const a = configFields[i];
      const b = configFields[j];
      
      if (a === 0n || b === 0n) continue;
      
      // 跳过太小的值（可能不是储备量）
      if (a < 1000000n && b < 1000000n) continue;
      
      // 计算两个方向的价格
      const priceBA = Number(b) / Number(a); // B per A
      const priceAB = Number(a) / Number(b); // A per B
      
      // JUP/USDC: price应该是 USDC per JUP
      // 所以如果 A=JUP, B=USDC, price = B/A
      if (priceBA >= EXPECTED_JUP_PRICE_MIN && priceBA <= EXPECTED_JUP_PRICE_MAX) {
        candidates.push({
          idxA: i,
          idxB: j,
          reserveA: a,
          reserveB: b,
          price: priceBA
        });
      }
      
      // 反过来: A=USDC, B=JUP
      if (priceAB >= EXPECTED_JUP_PRICE_MIN && priceAB <= EXPECTED_JUP_PRICE_MAX) {
        candidates.push({
          idxA: j,
          idxB: i,
          reserveA: b,
          reserveB: a,
          price: priceAB
        });
      }
    }
  }
  
  if (candidates.length === 0) {
    console.log('❌ 未找到符合价格范围的字段对');
    console.log('\n尝试显示所有可能的储备量大小的字段（> 1M）:');
    
    const largeFields = nonZeroFields
      .filter(f => f.val > 1000000n)
      .sort((a, b) => Number(b.val - a.val));
    
    largeFields.slice(0, 30).forEach(({ idx, val }) => {
      console.log(`  config[${idx.toString().padStart(3)}] = ${val.toString().padStart(20)} (${(Number(val) / 1e6).toFixed(2)})`);
    });
    
    return;
  }
  
  console.log(`✅ 找到 ${candidates.length} 个候选字段对:\n`);
  
  candidates.forEach((c, i) => {
    console.log(`候选 ${i + 1}:`);
    console.log(`  config[${c.idxA}] = ${c.reserveA.toString()} (Reserve A: ${(Number(c.reserveA) / 1e6).toFixed(2)})`);
    console.log(`  config[${c.idxB}] = ${c.reserveB.toString()} (Reserve B: ${(Number(c.reserveB) / 1e6).toFixed(2)})`);
    console.log(`  价格 (B/A): ${c.price.toFixed(6)} USDC per JUP`);
    console.log(`  ✅ 在预期范围内！\n`);
  });
  
  // 如果有唯一候选，给出代码修复建议
  if (candidates.length === 1) {
    const best = candidates[0];
    console.log('='.repeat(60));
    console.log('🎯 找到唯一候选！修复代码:');
    console.log('='.repeat(60));
    console.log(`
pub fn get_reserve_a(&self) -> u64 {
    self.config_fields[${best.idxA}]
}

pub fn get_reserve_b(&self) -> u64 {
    self.config_fields[${best.idxB}]
}
    `);
  }
  
  // 方法2: 如果方法1失败，尝试找两个相邻的大数值
  if (candidates.length === 0) {
    console.log('\n尝试方法2: 查找相邻的大数值对...\n');
    
    for (let i = 0; i < 110; i++) {
      const a = configFields[i];
      const b = configFields[i + 1];
      
      if (a > 1000000n && b > 1000000n) {
        const price = Number(b) / Number(a);
        console.log(`config[${i}] & config[${i+1}]:`);
        console.log(`  A = ${a.toString()} (${(Number(a) / 1e6).toFixed(2)})`);
        console.log(`  B = ${b.toString()} (${(Number(b) / 1e6).toFixed(2)})`);
        console.log(`  价格: ${price.toFixed(6)}\n`);
      }
    }
  }
}

analyzeHumidiFiPool().catch(console.error);

