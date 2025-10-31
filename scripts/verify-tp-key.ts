/**
 * 验证并直接使用 TP钱包/其他钱包导出的 Base58 私钥
 * 无需转换，直接填入 .env 文件
 */

import { KeypairManager } from '@solana-arb-bot/core';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

console.log('');
console.log('='.repeat(60));
console.log('TP钱包私钥验证工具（直接使用，无需转换）');
console.log('='.repeat(60));
console.log('');

// 从命令行获取 Base58 私钥
const base58PrivateKey = process.argv[2];

if (!base58PrivateKey) {
  console.log('使用方法：');
  console.log('  pnpm tsx scripts/verify-tp-key.ts 你的Base58私钥');
  console.log('');
  console.log('示例：');
  console.log('  pnpm tsx scripts/verify-tp-key.ts 5Kb8Kk8Lf9ioNdXL...');
  console.log('');
  console.log('📝 说明：');
  console.log('   1. 从 TP钱包 导出私钥（Base58格式）');
  console.log('   2. 运行此命令验证私钥');
  console.log('   3. 如果验证通过，直接复制私钥到 .env 文件');
  console.log('');
  process.exit(1);
}

async function verifyTPKey() {
  try {
    console.log('🔍 正在验证私钥...');
    console.log('');
    
    // 检测私钥长度
    const keyLength = base58PrivateKey.length;
    console.log(`私钥长度: ${keyLength} 个字符`);
    
    if (keyLength < 40 || keyLength > 100) {
      console.log('⚠️  警告：私钥长度异常，可能格式不正确');
      console.log('   正常 Base58 私钥通常是 87-88 个字符');
    }
    console.log('');

    // 使用 KeypairManager 加载私钥（自动处理32字节或64字节）
    const keypair = KeypairManager.fromBase58(base58PrivateKey);
    
    console.log('✅ 私钥验证成功！');
    console.log('');
    console.log('钱包地址：');
    console.log(keypair.publicKey.toBase58());
    console.log('');

    // 验证密钥对
    if (KeypairManager.validateKeypair(keypair)) {
      console.log('✅ 密钥对验证通过');
    } else {
      console.log('❌ 密钥对验证失败');
      process.exit(1);
    }
    console.log('');

    // 查询余额（主网）
    console.log('查询主网余额...');
    const mainnetConnection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    
    try {
      const balance = await KeypairManager.getBalance(mainnetConnection, keypair);
      console.log(`💰 主网余额: ${balance.toFixed(9)} SOL`);
      
      if (balance > 0) {
        const lamports = await mainnetConnection.getBalance(keypair.publicKey);
        console.log(`   = ${lamports.toLocaleString()} lamports`);
      } else {
        console.log('   ⚠️  余额为 0，请充值后再使用');
      }
    } catch (error: any) {
      console.log(`❌ 主网查询失败: ${error.message}`);
    }
    console.log('');

    console.log('='.repeat(60));
    console.log('');
    console.log('✅ 验证完成！可以直接使用！');
    console.log('');
    console.log('📝 下一步：直接复制下面的内容到 .env 文件：');
    console.log('');
    console.log('━'.repeat(60));
    console.log(`SOLANA_PRIVATE_KEY=${base58PrivateKey}`);
    console.log('━'.repeat(60));
    console.log('');
    console.log('💡 提示：');
    console.log('   ✅ TP钱包导出的 Base58 私钥可以直接使用');
    console.log('   ✅ 无需转换，直接填入 .env 文件即可');
    console.log('   ✅ 系统会自动识别并加载');
    console.log('');
    console.log('🧪 验证配置：');
    console.log('   pnpm tsx scripts/test-keypair.ts');
    console.log('');
    console.log('在线查询链接：');
    console.log(`https://solscan.io/account/${keypair.publicKey.toBase58()}`);
    console.log('');

  } catch (error: any) {
    console.error('❌ 验证失败:', error.message);
    console.log('');
    console.log('可能的原因：');
    console.log('  1. 私钥格式不正确');
    console.log('  2. 私钥不完整（复制时遗漏了部分字符）');
    console.log('  3. 包含了多余的空格或换行符');
    console.log('');
    console.log('解决方案：');
    console.log('  1. 确保从 TP钱包 完整复制私钥');
    console.log('  2. 检查是否有空格或换行');
    console.log('  3. Base58 私钥通常是 87-88 个字符');
    console.log('');
    process.exit(1);
  }
}

verifyTPKey();

