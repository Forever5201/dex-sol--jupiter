import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const signature = 'kvA51Pc9AXNurWQi9qRCJmPxZStCZ3yJgzVc9ckRV37xkxTQdyAWDdAeP7RkNKuLNqKXWCK64P9o9bkcP67N4Se';

console.log('='.repeat(80));
console.log('🔍 交易哈希分析');
console.log('='.repeat(80));
console.log('');

// 1. 基本信息
console.log('📋 基本信息:');
console.log(`   签名: ${signature}`);
console.log(`   长度: ${signature.length} 字符`);
console.log(`   Solscan: https://solscan.io/tx/${signature}`);
console.log('');

// 2. Base58 解码分析
console.log('🔐 Base58 解码分析:');
try {
  const decoded = bs58.decode(signature);
  console.log(`   ✅ Base58 格式正确`);
  console.log(`   解码后字节数: ${decoded.length} bytes`);
  console.log(`   十六进制: ${decoded.toString('hex')}`);
  console.log(`   十六进制长度: ${decoded.length * 2} 字符`);
  
  // Solana 交易签名通常是 64 bytes
  if (decoded.length === 64) {
    console.log(`   ✅ 长度正确（64 bytes = Solana 交易签名标准长度）`);
  } else {
    console.log(`   ⚠️  长度异常（标准应该是 64 bytes）`);
  }
} catch (error: any) {
  console.log(`   ❌ Base58 解码失败: ${error.message}`);
}
console.log('');

// 3. 签名特征分析
console.log('🔍 签名特征分析:');
const chars = signature.split('');
const charFrequency: Record<string, number> = {};
chars.forEach(char => {
  charFrequency[char] = (charFrequency[char] || 0) + 1;
});

console.log(`   唯一字符数: ${Object.keys(charFrequency).length}`);
console.log(`   字符频率（前10个）:`);
Object.entries(charFrequency)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([char, count]) => {
    console.log(`     ${char}: ${count} 次`);
  });
console.log('');

// 4. 可能的交易类型推断（基于签名无法确定，但可以分析）
console.log('💡 分析说明:');
console.log('   Solana 交易签名只是一个签名，不包含交易内容');
console.log('   要了解交易内容，需要：');
console.log('   1. 查询链上数据（getTransaction）');
console.log('   2. 查询交易状态（getSignatureStatus）');
console.log('   3. 如果有交易日志，可以从日志中分析');
console.log('');

// 5. 尝试推断可能的来源
console.log('🔎 可能的来源推断:');
console.log('   根据之前的代码分析，这个签名可能是：');
console.log('   1. ✅ 模拟阶段的交易签名（模拟失败后被拦截）');
console.log('   2. ✅ 构建阶段失败的交易（未发送到链上）');
console.log('   3. ⚠️  已过期被丢弃的交易（blockhash 过期）');
console.log('   4. ⚠️  格式正确的签名，但交易不存在');
console.log('');

// 6. 验证方法
console.log('✅ 验证方法:');
console.log('   要确认这个交易是否存在：');
console.log('   1. 查询链上数据：connection.getTransaction(signature)');
console.log('   2. 查询交易状态：connection.getSignatureStatus(signature)');
console.log('   3. 如果都返回 null，说明交易不存在或已过期');
console.log('');

// 7. 从代码逻辑推断
console.log('📊 从代码逻辑推断:');
console.log('   根据代码流程：');
console.log('   simulateFlashloan() → 构建并签名交易 → simulateTransaction()');
console.log('   → 如果模拟失败 → return { valid: false }');
console.log('   → buildTransactionFromCachedQuote() → return null');
console.log('   → handleOpportunity() → return (不执行交易)');
console.log('');
console.log('   ✅ 结论：模拟失败的交易不会发送到链上');
console.log('   ✅ 这个签名很可能是模拟阶段的交易，被正确拦截');
console.log('');

console.log('='.repeat(80));

