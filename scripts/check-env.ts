/**
 * 快速验证环境变量是否被读取
 */

import { config as loadEnv } from 'dotenv';

loadEnv();

console.log('');
console.log('='.repeat(60));
console.log('环境变量检查');
console.log('='.repeat(60));
console.log('');

if (process.env.SOLANA_PRIVATE_KEY) {
  const key = process.env.SOLANA_PRIVATE_KEY;
  console.log('✅ SOLANA_PRIVATE_KEY 已设置');
  console.log(`   长度: ${key.length} 个字符`);
  console.log(`   前8个字符: ${key.substring(0, 8)}...`);
  console.log(`   后8个字符: ...${key.substring(key.length - 8)}`);
  console.log('');
  console.log('✅ 系统会优先使用环境变量中的私钥！');
} else {
  console.log('❌ SOLANA_PRIVATE_KEY 未设置');
  console.log('');
  console.log('请检查：');
  console.log('  1. .env 文件是否存在');
  console.log('  2. .env 文件中是否有 SOLANA_PRIVATE_KEY=...');
  console.log('  3. .env 文件是否在项目根目录');
}

if (process.env.SOLANA_KEYPAIR_PATH) {
  console.log('');
  console.log('✅ SOLANA_KEYPAIR_PATH 已设置');
  console.log(`   路径: ${process.env.SOLANA_KEYPAIR_PATH}`);
}

console.log('');
console.log('='.repeat(60));

