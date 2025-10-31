/**
 * 从助记词直接生成 Base58 私钥
 * 用于直接填入 .env 文件
 */

import { Keypair } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';

console.log('');
console.log('='.repeat(60));
console.log('从助记词生成 Base58 私钥（用于 .env 文件）');
console.log('='.repeat(60));
console.log('');

// 从命令行获取助记词
const mnemonic = process.argv.slice(2).join(' ');

if (!mnemonic || mnemonic.split(' ').length !== 12) {
  console.log('使用方法：');
  console.log('  pnpm tsx scripts/mnemonic-to-env.ts word1 word2 word3 ... word12');
  console.log('');
  console.log('示例：');
  console.log('  pnpm tsx scripts/mnemonic-to-env.ts apple banana cherry dog elephant fish game house ink jump king lion');
  console.log('');
  console.log('⚠️  请提供 12 个单词的助记词（用空格分隔）');
  console.log('');
  process.exit(1);
}

try {
  console.log('正在处理助记词...');
  console.log('');
  
  // 验证助记词
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('助记词格式不正确，请检查单词拼写');
  }
  
  console.log('✅ 助记词验证通过');
  console.log('');
  
  // 从助记词生成种子
  const seed = bip39.mnemonicToSeedSync(mnemonic, '');
  
  // 使用 Solana 标准派生路径
  const path44 = `m/44'/501'/0'/0'`;
  const derivedSeed = derivePath(path44, seed.toString('hex')).key;
  
  // 创建密钥对
  const keypair = Keypair.fromSeed(derivedSeed);
  
  // 提取前32字节（私钥部分）并转换为 Base58
  const privateKeyBytes = keypair.secretKey.slice(0, 32);
  const base58PrivateKey = bs58.encode(privateKeyBytes);
  
  console.log('='.repeat(60));
  console.log('');
  console.log('✅ 生成成功！');
  console.log('');
  console.log('钱包地址：');
  console.log(keypair.publicKey.toBase58());
  console.log('');
  console.log('='.repeat(60));
  console.log('');
  console.log('📝 直接复制下面的内容到 .env 文件：');
  console.log('');
  console.log('━'.repeat(60));
  console.log(`SOLANA_PRIVATE_KEY=${base58PrivateKey}`);
  console.log('━'.repeat(60));
  console.log('');
  console.log('或者只复制 Base58 私钥：');
  console.log(base58PrivateKey);
  console.log('');
  console.log('='.repeat(60));
  console.log('');
  console.log('📋 下一步：');
  console.log('');
  console.log('1. 复制上面的 Base58 私钥');
  console.log('');
  console.log('2. 在项目根目录创建或编辑 .env 文件：');
  console.log('   SOLANA_PRIVATE_KEY=你的Base58私钥');
  console.log('');
  console.log('3. 验证配置：');
  console.log('   pnpm tsx scripts/test-keypair.ts');
  console.log('');
  console.log('4. 充值钱包地址（如果需要）：');
  console.log(`   ${keypair.publicKey.toBase58()}`);
  console.log('');
  console.log('⚠️  重要安全提示：');
  console.log('   ❌ 不要直接把助记词填入 .env 文件');
  console.log('   ✅ 应该填入 Base58 私钥（上面的字符串）');
  console.log('   ❌ 不要将 .env 文件提交到 Git');
  console.log('   ✅ 确保 .env 在 .gitignore 中');
  console.log('');
  
} catch (error: any) {
  console.error('');
  console.error('❌ 生成失败:', error.message);
  console.error('');
  console.error('请检查：');
  console.error('1. 助记词是否正确（12 个单词）');
  console.error('2. 单词拼写是否正确');
  console.error('3. 单词之间用空格分隔');
  console.error('4. 没有多余的标点符号');
  console.error('');
  process.exit(1);
}

