/**
 * 检查现有 ALT 的状态和内容
 */

import { Connection, PublicKey, AddressLookupTableAccount } from '@solana/web3.js';
import { NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';

loadEnv();

async function checkALTStatus() {
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');

    console.log('');
    console.log('='.repeat(60));
    console.log('检查现有 ALT 状态');
    console.log('='.repeat(60));
    console.log('');

    // 检查 Jupiter Lend ALT
    const jupiterLendALTAddress = process.env.JUPITER_LEND_ALT_ADDRESS;
    if (jupiterLendALTAddress) {
      console.log('📋 Jupiter Lend ALT:');
      console.log(`   地址: ${jupiterLendALTAddress}`);
      
      try {
        const altAddress = new PublicKey(jupiterLendALTAddress);
        const accountInfo = await connection.getAccountInfo(altAddress);
        
        if (accountInfo) {
          const altAccount = new AddressLookupTableAccount({
            key: altAddress,
            state: AddressLookupTableAccount.deserialize(accountInfo.data),
          });
          
          console.log(`   ✅ ALT 存在且有效`);
          console.log(`   📊 包含地址数量: ${altAccount.state.addresses.length}`);
          console.log(`   💰 账户余额: ${accountInfo.lamports / 1e9} SOL`);
          
          if (altAccount.state.addresses.length > 0) {
            console.log(`   📝 前 10 个地址:`);
            altAccount.state.addresses.slice(0, 10).forEach((addr, i) => {
              console.log(`      ${i + 1}. ${addr.toBase58()}`);
            });
            if (altAccount.state.addresses.length > 10) {
              console.log(`      ... 还有 ${altAccount.state.addresses.length - 10} 个地址`);
            }
          } else {
            console.log(`   ⚠️ ALT 是空的（未添加任何地址）`);
          }
        } else {
          console.log(`   ❌ ALT 不存在（账户已被删除）`);
        }
      } catch (error: any) {
        console.log(`   ❌ 检查失败: ${error.message}`);
      }
      console.log('');
    } else {
      console.log('📋 Jupiter Lend ALT: 未配置');
      console.log('');
    }

    // 检查 Solend ALT
    const solendALTAddress = process.env.SOLEND_ALT_ADDRESS || '67c7w9tqt3F1BmAbRbqBx6Ft9Z9btahBqVs1a5QHpq5Z';
    if (solendALTAddress) {
      console.log('📋 Solend ALT:');
      console.log(`   地址: ${solendALTAddress}`);
      
      try {
        const altAddress = new PublicKey(solendALTAddress);
        const accountInfo = await connection.getAccountInfo(altAddress);
        
        if (accountInfo) {
          const altAccount = new AddressLookupTableAccount({
            key: altAddress,
            state: AddressLookupTableAccount.deserialize(accountInfo.data),
          });
          
          console.log(`   ✅ ALT 存在且有效`);
          console.log(`   📊 包含地址数量: ${altAccount.state.addresses.length}`);
          console.log(`   💰 账户余额: ${accountInfo.lamports / 1e9} SOL`);
          
          if (altAccount.state.addresses.length > 0) {
            console.log(`   📝 前 10 个地址:`);
            altAccount.state.addresses.slice(0, 10).forEach((addr, i) => {
              console.log(`      ${i + 1}. ${addr.toBase58()}`);
            });
            if (altAccount.state.addresses.length > 10) {
              console.log(`      ... 还有 ${altAccount.state.addresses.length - 10} 个地址`);
            }
          } else {
            console.log(`   ⚠️ ALT 是空的（未添加任何地址）`);
          }
        } else {
          console.log(`   ❌ ALT 不存在（账户已被删除）`);
        }
      } catch (error: any) {
        console.log(`   ❌ 检查失败: ${error.message}`);
      }
      console.log('');
    } else {
      console.log('📋 Solend ALT: 未配置');
      console.log('');
    }

    // 建议
    console.log('='.repeat(60));
    console.log('');
    console.log('💡 建议:');
    
    const provider = process.env.FLASHLOAN_PROVIDER || 'jupiter-lend';
    
    if (provider === 'jupiter-lend') {
      if (jupiterLendALTAddress) {
        console.log('✅ 你使用的是 Jupiter Lend，Jupiter Lend ALT 已配置');
        console.log('✅ 可以继续使用现有的 ALT');
        console.log('⚠️ Solend ALT 不需要（如果使用 Jupiter Lend）');
      } else {
        console.log('⚠️ 你使用的是 Jupiter Lend，但未配置 Jupiter Lend ALT');
        console.log('💡 建议运行脚本创建 ALT');
      }
    } else {
      if (solendALTAddress) {
        console.log('✅ 你使用的是 Solend，Solend ALT 已配置');
        console.log('✅ 可以继续使用现有的 ALT');
        console.log('⚠️ Jupiter Lend ALT 不需要（如果使用 Solend）');
      } else {
        console.log('⚠️ 你使用的是 Solend，但未配置 Solend ALT');
        console.log('💡 建议运行脚本创建 ALT');
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

checkALTStatus();

