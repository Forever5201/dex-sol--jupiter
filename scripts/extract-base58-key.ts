/**
 * 从密钥文件提取 Base58 私钥
 * 用于配置环境变量方式
 */

import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';

const keypairPath = process.argv[2] || './keypairs/flashloan-wallet.json';

console.log('');
console.log('='.repeat(60));
console.log('提取 Base58 私钥');
console.log('='.repeat(60));
console.log('');

try {
  // 检查文件是否存在
  const absolutePath = path.resolve(keypairPath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`密钥文件不存在: ${absolutePath}`);
  }

  // 读取密钥文件
  const secretKey = JSON.parse(fs.readFileSync(absolutePath, 'utf-8'));
  
  if (!Array.isArray(secretKey) || secretKey.length !== 64) {
    throw new Error(`密钥格式错误: 应该是64字节的数组`);
  }

  // 创建密钥对
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  
  // 提取前32字节（私钥部分）并转换为 Base58
  const privateKeyBytes = keypair.secretKey.slice(0, 32);
  const base58PrivateKey = bs58.encode(privateKeyBytes);

  console.log('✅ 提取成功！');
  console.log('');
  console.log('钱包地址：');
  console.log(keypair.publicKey.toBase58());
  console.log('');
  console.log('Base58 私钥：');
  console.log(base58PrivateKey);
  console.log('');
  console.log('='.repeat(60));
  console.log('');
  console.log('📝 使用方法：');
  console.log('');
  console.log('1. 复制上面的 Base58 私钥');
  console.log('');
  console.log('2. 添加到 .env 文件：');
  console.log('   SOLANA_PRIVATE_KEY=你的Base58私钥');
  console.log('');
  console.log('3. 或设置系统环境变量：');
  console.log('   Windows PowerShell:');
  console.log('   $env:SOLANA_PRIVATE_KEY = "你的Base58私钥"');
  console.log('');
  console.log('   Linux/Mac:');
  console.log('   export SOLANA_PRIVATE_KEY="你的Base58私钥"');
  console.log('');
  console.log('4. 验证配置：');
  console.log('   pnpm tsx scripts/test-keypair.ts');
  console.log('');
  console.log('⚠️  安全提示：');
  console.log('   - 不要将私钥分享给任何人');
  console.log('   - 不要将私钥提交到 Git');
  console.log('   - 确保 .env 文件在 .gitignore 中');
  console.log('');

} catch (error: any) {
  console.error('❌ 错误:', error.message);
  console.log('');
  console.log('使用方法：');
  console.log('  pnpm tsx scripts/extract-base58-key.ts [密钥文件路径]');
  console.log('');
  console.log('示例：');
  console.log('  pnpm tsx scripts/extract-base58-key.ts');
  console.log('  pnpm tsx scripts/extract-base58-key.ts ./keypairs/wallet.json');
  console.log('');
  process.exit(1);
}

