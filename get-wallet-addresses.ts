#!/usr/bin/env tsx
/**
 * 获取钱包地址工具
 * 安全地显示钱包的公钥地址，不泄露私钥
 */

import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const wallets = [
  {
    name: 'Jito授权钱包',
    path: 'keypairs/jito-auth-wallet.json',
    purpose: '用于Jito Block Engine API授权认证'
  },
  {
    name: '主钱包',
    path: 'keypairs/wallet-b-main.json',
    purpose: '存放SOL/gas，执行套利交易'
  }
];

console.log('🔑 ========== 钱包地址查看工具 ==========\n');

for (const wallet of wallets) {
  try {
    const keypairData = JSON.parse(
      fs.readFileSync(wallet.path, 'utf-8')
    );
    const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    
    console.log(`📌 ${wallet.name}`);
    console.log(`   文件: ${wallet.path}`);
    console.log(`   用途: ${wallet.purpose}`);
    console.log(`   地址: ${keypair.publicKey.toBase58()}`);
    console.log('');
  } catch (error) {
    console.error(`❌ 无法读取 ${wallet.name}:`, error.message);
    console.log('');
  }
}

console.log('✅ 完成！\n');
console.log('💡 提示:');
console.log('   - Jito授权钱包的地址需要提供给Jito团队（用于gRPC认证）');
console.log('   - 主钱包的地址用于接收和发送交易');
console.log('   - 请妥善保管私钥文件，不要泄露！');
