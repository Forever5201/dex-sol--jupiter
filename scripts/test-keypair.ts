/**
 * 测试密钥配置
 * 验证密钥是否正确加载（支持文件和环境变量）
 */

import { KeypairManager } from '@solana-arb-bot/core';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

async function testKeypair() {
  console.log('');
  console.log('='.repeat(60));
  console.log('密钥配置测试');
  console.log('='.repeat(60));
  console.log('');

  try {
    // 检测密钥源
    let source = '未知';
    if (process.env.SOLANA_PRIVATE_KEY) {
      source = '环境变量: SOLANA_PRIVATE_KEY (Base58私钥)';
    } else if (process.env.SOLANA_KEYPAIR_PATH) {
      source = `环境变量: SOLANA_KEYPAIR_PATH (${process.env.SOLANA_KEYPAIR_PATH})`;
    } else {
      source = '配置文件: DEFAULT_KEYPAIR_PATH';
    }

    console.log('🔍 检测到的密钥源:', source);
    console.log('');

    // 加载密钥（自动检测环境变量或文件）
    const keypair = KeypairManager.load();
    
    console.log('✅ 密钥加载成功！');
    console.log('');
    console.log('钱包地址:');
    console.log(keypair.publicKey.toBase58());
    console.log('');

    // 验证密钥
    if (KeypairManager.validateKeypair(keypair)) {
      console.log('✅ 密钥验证通过');
    } else {
      console.log('❌ 密钥验证失败');
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

    // 查询余额（测试网）
    console.log('查询测试网余额...');
    const devnetConnection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    try {
      const balance = await KeypairManager.getBalance(devnetConnection, keypair);
      console.log(`💰 测试网余额: ${balance.toFixed(9)} SOL`);
      
      if (balance > 0) {
        const lamports = await devnetConnection.getBalance(keypair.publicKey);
        console.log(`   = ${lamports.toLocaleString()} lamports`);
      }
    } catch (error: any) {
      console.log(`❌ 测试网查询失败: ${error.message}`);
    }
    console.log('');

    console.log('='.repeat(60));
    console.log('');
    console.log('✅ 密钥配置测试完成！');
    console.log('');
    console.log('在线查询链接：');
    console.log(`https://solscan.io/account/${keypair.publicKey.toBase58()}`);
    console.log('');

  } catch (error: any) {
    console.error('❌ 错误:', error.message);
    console.log('');
    console.log('可能的原因：');
    console.log('  1. 密钥文件不存在或路径错误');
    console.log('  2. 环境变量未设置或格式错误');
    console.log('  3. 密钥格式不正确');
    console.log('');
    console.log('解决方案：');
    console.log('  1. 检查密钥文件路径: keypairs/flashloan-wallet.json');
    console.log('  2. 或设置环境变量: SOLANA_PRIVATE_KEY 或 SOLANA_KEYPAIR_PATH');
    console.log('  3. 运行: pnpm tsx scripts/extract-base58-key.ts 提取Base58私钥');
    console.log('');
    process.exit(1);
  }
}

testKeypair();

