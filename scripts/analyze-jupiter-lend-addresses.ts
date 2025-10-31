/**
 * 分析 Jupiter Lend 常用的地址
 * 通过实际构建一次闪电贷指令来提取常用地址
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { NetworkAdapter, KeypairManager } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';

loadEnv();

// 常用的代币 mint 地址（SOL 和主流代币）
const COMMON_TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  ETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  JUP: 'JUPyiwrY2skk1h7UXgy8JXctVyAVk3QW6XeZ6kRYfT4U',
  ORCA: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  SAMO: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  COPE: '8HGyAAB1yoM1ttS7pXjHMa3dukTFGQggnFFH3hJZgzQh',
  SRM: 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt',
  FIDA: 'EchesyfXePKdLtoiZSL8pBe8Myagyy8ZRqsACNCFGnvp',
  KIN: 'kinXdEcpDQeHPEuQnqmUgtYykqKGVFq6CeVX5iAHJq6',
  SAMO: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  COPE: '8HGyAAB1yoM1ttS7pXjHMa3dukTFGQggnFFH3hJZgzQh',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  STEP: 'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT',
  MEDIA: 'ETAtLmCmsoiEEKfNrHKJ2kYy3MoABhU6NQvpSfij5tDs',
  ROPE: '8PMHT4swUMtBzgYnh5Zh564jKufHLaq4GMH49zKa5ida',
  COIN: '5yw4vLjQ3nBxW5aBz3V9c6qP7ZJ9J8zKJYJ3JZJ3JZJ3',
  TULIP: 'TuLipcqtGVXP9XR62wM8WWCm6a9pxLs37N1jet5TLpZ',
  SLRS: 'SLRSSpSLUTP7okbCUBYStWCo1vUgyt775faPqz8HUMr',
  PORT: 'PoRTjZMPXb9T7dyU7tpLEZRQj7e7ssdAEcTt4V2FwD5',
  MNDE: 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac',
  LDO: 'HZRCwxP2Vq9PCpPXooayhJ2bxTzp5i8xht1p9cvvbD7p',
  HNT: 'hntyVP6YFq1ige15qAsu1Z3qibwWSat4TKX2yoe2Xsf',
  ALEPH: 'CsZ5LZk8xeWf5x1poSZd8x1LcLN2x6K5T7qY6ZJ3JZJ3',
  ATLAS: 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx',
  POLIS: 'poLisWXnNRwC6oB1H7K8JY7gq1qZJ3JZJ3JZJ3JZJ3',
  GRAPE: '8upjSpvjcdpuzhfR1zriwg5NXoDrKVukAHK5XR1Uqe6J',
  C98: 'C98A4nkJXhpVZNAZdHUA95RpTF3T4whtQubL3YobiUX9',
  SOLAPE: 'GFX1ZjR2P15tmrSwow6FjyDYcEkoFb4p4gXp6ksxeBUV',
  SLIM: 'xxxxa1sKNGwFtw2kFn8XauW9xq8hBZ5kVtcSesTTNf',
  SUNNY: 'SUNNYWgPQmFxe9wTZzNK7iPnJ3vYDrkgnxJRJm1s3ag',
  DOGE: '5zP4KCfQwZJ2J8ZJ3JZJ3JZJ3JZJ3JZJ3JZJ3JZJ3',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  ZBC: 'zebeczgi5fSEtbpfQKVZKCJ3WgYXxjkMUkNNx7fLKAF',
};

async function analyzeJupiterLendAddresses() {
  try {
    console.log('');
    console.log('='.repeat(60));
    console.log('分析 Jupiter Lend 常用地址');
    console.log('='.repeat(60));
    console.log('');

    // 1. 加载密钥对
    console.log('🔑 加载密钥对...');
    const keypair = KeypairManager.load();
    console.log(`✅ 钱包地址: ${keypair.publicKey.toBase58()}`);
    console.log('');

    // 2. 创建连接
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');
    console.log(`📡 连接到 RPC: ${rpcUrl}`);
    console.log('');

    // 3. 收集所有地址
    const addressSet = new Set<string>();
    
    // 添加系统账户
    const { 
      TOKEN_PROGRAM_ID, 
      ASSOCIATED_TOKEN_PROGRAM_ID,
      SYSVAR_CLOCK_PUBKEY,
      SYSVAR_RENT_PUBKEY,
      SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
      SYSVAR_INSTRUCTIONS_PUBKEY,
      SystemProgram,
    } = await import('@solana/web3.js');
    
    addressSet.add(TOKEN_PROGRAM_ID.toBase58());
    addressSet.add(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    addressSet.add(SYSVAR_CLOCK_PUBKEY.toBase58());
    addressSet.add(SYSVAR_RENT_PUBKEY.toBase58());
    addressSet.add(SYSVAR_RECENT_BLOCKHASHES_PUBKEY.toBase58());
    addressSet.add(SYSVAR_INSTRUCTIONS_PUBKEY.toBase58());
    addressSet.add(SystemProgram.programId.toBase58());

    console.log('📋 添加系统账户...');
    console.log(`   - Token Program: ${TOKEN_PROGRAM_ID.toBase58()}`);
    console.log(`   - Associated Token Program: ${ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()}`);
    console.log(`   - System Program: ${SystemProgram.programId.toBase58()}`);
    console.log('');

    // 4. 添加常用代币 mint 地址
    console.log('📋 添加常用代币 mint 地址...');
    for (const [symbol, mint] of Object.entries(COMMON_TOKENS)) {
      addressSet.add(mint);
      console.log(`   - ${symbol}: ${mint}`);
    }
    console.log('');

    // 5. 尝试构建一次 Jupiter Lend 指令来提取实际使用的地址
    console.log('🔍 尝试构建 Jupiter Lend 闪电贷指令（提取实际地址）...');
    try {
      const { getFlashBorrowIx, getFlashPaybackIx } = await import('@jup-ag/lend/flashloan');
      const BN = (await import('bn.js')).default;

      // 使用 USDC 作为测试资产（最常见的资产）
      const testAsset = new PublicKey(COMMON_TOKENS.USDC);
      const testAmount = new BN(1000000); // 1 USDC (6 decimals)

      console.log(`   测试资产: USDC (${testAsset.toBase58()})`);
      console.log(`   测试金额: 1 USDC`);
      console.log('');

      // 构建借款指令
      const borrowIx = await getFlashBorrowIx({
        amount: testAmount,
        asset: testAsset,
        signer: keypair.publicKey,
        connection: connection,
      });

      // 构建还款指令
      const paybackIx = await getFlashPaybackIx({
        amount: testAmount,
        asset: testAsset,
        signer: keypair.publicKey,
        connection: connection,
      });

      // 提取地址
      console.log('📋 从指令中提取地址...');
      
      // 添加程序 ID
      addressSet.add(borrowIx.programId.toBase58());
      addressSet.add(paybackIx.programId.toBase58());
      console.log(`   - Borrow Program: ${borrowIx.programId.toBase58()}`);
      console.log(`   - Payback Program: ${paybackIx.programId.toBase58()}`);

      // 添加所有账户（排除签名者）
      const accountsFromBorrow = borrowIx.keys
        .filter(key => !key.isSigner)
        .map(key => key.pubkey.toBase58());
      
      const accountsFromPayback = paybackIx.keys
        .filter(key => !key.isSigner)
        .map(key => key.pubkey.toBase58());

      console.log(`   - Borrow 指令账户数: ${borrowIx.keys.length} (${borrowIx.keys.filter(k => !k.isSigner).length} 非签名者)`);
      console.log(`   - Payback 指令账户数: ${paybackIx.keys.length} (${paybackIx.keys.filter(k => !k.isSigner).length} 非签名者)`);

      // 添加账户地址
      accountsFromBorrow.forEach(addr => addressSet.add(addr));
      accountsFromPayback.forEach(addr => addressSet.add(addr));

      console.log(`   ✅ 提取了 ${accountsFromBorrow.length + accountsFromPayback.length} 个账户地址`);
      console.log('');

    } catch (error: any) {
      console.log(`   ⚠️ 无法构建指令（可能 SDK 需要网络连接）: ${error.message}`);
      console.log('   将继续使用预定义的地址列表...');
      console.log('');
    }

    // 6. 尝试多个常用代币
    console.log('🔍 尝试多个常用代币...');
    const commonTokensToTest = [
      COMMON_TOKENS.SOL,
      COMMON_TOKENS.USDT,
      COMMON_TOKENS.ETH,
      COMMON_TOKENS.BONK,
    ];

    try {
      const { getFlashBorrowIx, getFlashPaybackIx } = await import('@jup-ag/lend/flashloan');
      const BN = (await import('bn.js')).default;

      for (const mint of commonTokensToTest) {
        try {
          const testAsset = new PublicKey(mint);
          const testAmount = new BN(1000000);

          const borrowIx = await getFlashBorrowIx({
            amount: testAmount,
            asset: testAsset,
            signer: keypair.publicKey,
            connection: connection,
          });

          const paybackIx = await getFlashPaybackIx({
            amount: testAmount,
            asset: testAsset,
            signer: keypair.publicKey,
            connection: connection,
          });

          // 提取地址
          borrowIx.keys
            .filter(key => !key.isSigner)
            .forEach(key => addressSet.add(key.pubkey.toBase58()));
          
          paybackIx.keys
            .filter(key => !key.isSigner)
            .forEach(key => addressSet.add(key.pubkey.toBase58()));

          const tokenSymbol = Object.entries(COMMON_TOKENS).find(([_, addr]) => addr === mint)?.[0] || 'Unknown';
          console.log(`   ✅ ${tokenSymbol}: 提取了 ${borrowIx.keys.length + paybackIx.keys.length} 个账户`);
        } catch (error: any) {
          const tokenSymbol = Object.entries(COMMON_TOKENS).find(([_, addr]) => addr === mint)?.[0] || 'Unknown';
          console.log(`   ⚠️ ${tokenSymbol}: 无法构建指令 (${error.message})`);
        }
      }
      console.log('');
    } catch (error: any) {
      console.log(`   ⚠️ 无法测试多个代币: ${error.message}`);
      console.log('');
    }

    // 7. 转换为数组并排序
    const addresses = Array.from(addressSet)
      .map(addr => new PublicKey(addr))
      .sort((a, b) => a.toBase58().localeCompare(b.toBase58()));

    console.log('='.repeat(60));
    console.log('');
    console.log(`✅ 总共收集了 ${addresses.length} 个唯一地址`);
    console.log('');

    // 8. 保存到文件
    const outputPath = path.join(process.cwd(), 'scripts', 'jupiter-lend-common-addresses.json');
    const addressStrings = addresses.map(addr => addr.toBase58());
    fs.writeFileSync(outputPath, JSON.stringify(addressStrings, null, 2));
    console.log(`💾 已保存到: ${outputPath}`);
    console.log('');

    // 9. 显示前20个地址
    console.log('📋 地址列表（前20个）:');
    addresses.slice(0, 20).forEach((addr, i) => {
      console.log(`   ${i + 1}. ${addr.toBase58()}`);
    });
    if (addresses.length > 20) {
      console.log(`   ... 还有 ${addresses.length - 20} 个地址`);
    }
    console.log('');

    // 10. 统计信息
    console.log('📊 统计信息:');
    console.log(`   - 总地址数: ${addresses.length}`);
    console.log(`   - 系统账户: ${addressSet.has(TOKEN_PROGRAM_ID.toBase58()) ? '✓' : '✗'}`);
    console.log(`   - 常用代币: ${Object.keys(COMMON_TOKENS).length} 个`);
    console.log('');

    console.log('='.repeat(60));
    console.log('');
    console.log('✅ 分析完成！');
    console.log('');
    console.log('💡 提示:');
    console.log('   这些地址将被用于预先创建 Jupiter Lend ALT');
    console.log('   地址列表已保存到: scripts/jupiter-lend-common-addresses.json');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('❌ 分析失败:', error.message);
    console.error('');
    console.error(error.stack);
    process.exit(1);
  }
}

analyzeJupiterLendAddresses();

