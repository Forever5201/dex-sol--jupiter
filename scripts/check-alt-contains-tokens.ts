/**
 * 检查 ALT 是否包含配置中的代币地址
 */

import { Connection, PublicKey, AddressLookupTableAccount } from '@solana/web3.js';
import { NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';

loadEnv();

// 常用的代币 mint 地址
const COMMON_TOKENS: Record<string, string> = {
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
  STEP: 'StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT',
  MEDIA: 'ETAtLmCmsoiEEKfNrHKJ2kYy3MoABhU6NQvpSfij5tDs',
  ROPE: '8PMHT4swUMtBzgYnh5Zh564jKufHLaq4GMH49zKa5ida',
  TULIP: 'TuLipcqtGVXP9XR62wM8WWCm6a9pxLs37N1jet5TLpZ',
  SLRS: 'SLRSSpSLUTP7okbCUBYStWCo1vUgyt775faPqz8HUMr',
  PORT: 'PoRTjZMPXb9T7dyU7tpLEZRQj7e7ssdAEcTt4V2FwD5',
  MNDE: 'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac',
  LDO: 'HZRCwxP2Vq9PCpPXooayhJ2bxTzp5i8xht1p9cvvbD7p',
  HNT: 'hntyVP6YFq1ige15qAsu1Z3qibwWSat4TKX2yoe2Xsf',
  ATLAS: 'ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx',
  GRAPE: '8upjSpvjcdpuzhfR1zriwg5NXoDrKVukAHK5XR1Uqe6J',
  C98: 'C98A4nkJXhpVZNAZdHUA95RpTF3T4whtQubL3YobiUX9',
  WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
};

async function checkALTAddresses() {
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');

    console.log('');
    console.log('='.repeat(60));
    console.log('检查 ALT 是否包含配置中的代币地址');
    console.log('='.repeat(60));
    console.log('');

    // 1. 加载 Jupiter Lend ALT
    const jupiterLendALTAddress = process.env.JUPITER_LEND_ALT_ADDRESS;
    if (!jupiterLendALTAddress) {
      console.log('❌ 未配置 JUPITER_LEND_ALT_ADDRESS');
      process.exit(1);
    }

    console.log('📋 加载 Jupiter Lend ALT...');
    const altAddress = new PublicKey(jupiterLendALTAddress);
    const accountInfo = await connection.getAccountInfo(altAddress);
    
    if (!accountInfo) {
      console.log('❌ ALT 不存在');
      process.exit(1);
    }

    const altAccount = new AddressLookupTableAccount({
      key: altAddress,
      state: AddressLookupTableAccount.deserialize(accountInfo.data),
    });

    console.log(`✅ ALT 加载成功`);
    console.log(`   地址数量: ${altAccount.state.addresses.length}`);
    console.log('');

    // 2. 创建 ALT 地址集合（用于快速查找）
    const altAddressSet = new Set<string>();
    altAccount.state.addresses.forEach(addr => {
      altAddressSet.add(addr.toBase58());
    });

    // 3. 加载桥接代币配置
    console.log('📋 检查桥接代币配置...');
    const bridgeTokensPath = path.join(process.cwd(), 'bridge-tokens.json');
    let bridgeTokens: Array<{ symbol: string; mint: string; enabled?: boolean }> = [];
    
    if (fs.existsSync(bridgeTokensPath)) {
      const bridgeTokensData = fs.readFileSync(bridgeTokensPath, 'utf-8');
      bridgeTokens = JSON.parse(bridgeTokensData);
      console.log(`✅ 加载了 ${bridgeTokens.length} 个桥接代币配置`);
    } else {
      console.log('⚠️ bridge-tokens.json 不存在，使用默认代币列表');
    }
    console.log('');

    // 4. 检查常用代币
    console.log('='.repeat(60));
    console.log('检查常用代币:');
    console.log('='.repeat(60));
    console.log('');

    const commonTokensInALT: string[] = [];
    const commonTokensNotInALT: string[] = [];

    for (const [symbol, mint] of Object.entries(COMMON_TOKENS)) {
      if (altAddressSet.has(mint)) {
        commonTokensInALT.push(symbol);
        console.log(`✅ ${symbol.padEnd(8)} ${mint} - 在 ALT 中`);
      } else {
        commonTokensNotInALT.push(symbol);
        console.log(`❌ ${symbol.padEnd(8)} ${mint} - 不在 ALT 中`);
      }
    }

    console.log('');
    console.log(`📊 统计: ${commonTokensInALT.length}/${Object.keys(COMMON_TOKENS).length} 个常用代币在 ALT 中`);
    console.log('');

    // 5. 检查桥接代币
    if (bridgeTokens.length > 0) {
      console.log('='.repeat(60));
      console.log('检查桥接代币:');
      console.log('='.repeat(60));
      console.log('');

      const bridgeTokensInALT: string[] = [];
      const bridgeTokensNotInALT: string[] = [];

      for (const token of bridgeTokens) {
        if (token.enabled === false) {
          continue; // 跳过禁用的代币
        }

        const mint = token.mint;
        if (altAddressSet.has(mint)) {
          bridgeTokensInALT.push(token.symbol);
          console.log(`✅ ${token.symbol.padEnd(8)} ${mint} - 在 ALT 中`);
        } else {
          bridgeTokensNotInALT.push(token.symbol);
          console.log(`❌ ${token.symbol.padEnd(8)} ${mint} - 不在 ALT 中`);
        }
      }

      console.log('');
      console.log(`📊 统计: ${bridgeTokensInALT.length}/${bridgeTokens.filter(t => t.enabled !== false).length} 个桥接代币在 ALT 中`);
      console.log('');

      // 6. 显示 ALT 中的所有地址（用于调试）
      console.log('='.repeat(60));
      console.log('ALT 中的所有地址:');
      console.log('='.repeat(60));
      console.log('');

      altAccount.state.addresses.forEach((addr, index) => {
        const addrStr = addr.toBase58();
        
        // 尝试识别代币
        let tokenName = '';
        for (const [symbol, mint] of Object.entries(COMMON_TOKENS)) {
          if (mint === addrStr) {
            tokenName = ` (${symbol})`;
            break;
          }
        }
        
        if (!tokenName) {
          for (const token of bridgeTokens) {
            if (token.mint === addrStr) {
              tokenName = ` (${token.symbol})`;
              break;
            }
          }
        }

        console.log(`${(index + 1).toString().padStart(3)}. ${addrStr}${tokenName}`);
      });

      console.log('');
      console.log('='.repeat(60));
      console.log('总结:');
      console.log('='.repeat(60));
      console.log('');

      if (bridgeTokensNotInALT.length > 0) {
        console.log(`⚠️ 有 ${bridgeTokensNotInALT.length} 个桥接代币不在 ALT 中:`);
        bridgeTokensNotInALT.forEach(symbol => {
          console.log(`   - ${symbol}`);
        });
        console.log('');
        console.log('💡 建议: 这些代币会在首次使用时自动添加到 ALT');
      } else {
        console.log('✅ 所有桥接代币都在 ALT 中！');
      }

      if (commonTokensNotInALT.length > 0) {
        console.log(`⚠️ 有 ${commonTokensNotInALT.length} 个常用代币不在 ALT 中:`);
        commonTokensNotInALT.forEach(symbol => {
          console.log(`   - ${symbol}`);
        });
        console.log('');
        console.log('💡 建议: 如果需要，可以运行扩展脚本添加这些代币');
      } else {
        console.log('✅ 所有常用代币都在 ALT 中！');
      }
    }

    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('❌ 检查失败:', error.message);
    console.error('');
    process.exit(1);
  }
}

checkALTAddresses();



















































































