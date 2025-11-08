/**
 * 扩展 Jupiter Lend ALT 添加关键代币（SOL、USDC、USDT）
 */

import { Connection, PublicKey, AddressLookupTableProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { KeypairManager, NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';

loadEnv();

console.log('');
console.log('='.repeat(60));
console.log('扩展 Jupiter Lend ALT - 添加关键代币');
console.log('='.repeat(60));
console.log('');

async function extendJupiterLendALT() {
  try {
    // 1. 加载密钥对
    console.log('🔑 加载密钥对...');
    const keypair = KeypairManager.load();
    console.log(`✅ 钱包地址: ${keypair.publicKey.toBase58()}`);
    console.log('');

    // 2. 检查现有 ALT 地址
    const altAddressStr = process.env.JUPITER_LEND_ALT_ADDRESS;
    if (!altAddressStr) {
      console.log('❌ 未配置 JUPITER_LEND_ALT_ADDRESS');
      console.log('💡 请先运行 create-jupiter-lend-alt.ts 创建 ALT');
      process.exit(1);
    }

    const altAddress = new PublicKey(altAddressStr);
    console.log(`📋 ALT 地址: ${altAddress.toBase58()}`);
    console.log('');

    // 3. 创建连接
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');
    console.log(`📡 连接到 RPC: ${rpcUrl}`);
    console.log('');

    // 4. 检查 ALT 是否存在于链上
    console.log('🔍 检查 ALT 状态...');
    const accountInfo = await connection.getAccountInfo(altAddress);
    if (!accountInfo) {
      console.log('❌ ALT 不存在于链上');
      console.log('💡 请先运行 create-jupiter-lend-alt.ts 创建 ALT');
      process.exit(1);
    }

    const { AddressLookupTableAccount } = await import('@solana/web3.js');
    const altAccount = new AddressLookupTableAccount({
      key: altAddress,
      state: AddressLookupTableAccount.deserialize(accountInfo.data),
    });

    console.log(`✅ ALT 存在`);
    console.log(`   当前地址数量: ${altAccount.state.addresses.length}`);
    console.log('');

    // 5. 准备要添加的关键代币地址
    const addressesToAdd: PublicKey[] = [];
    
    // 系统账户（如果还没有）
    const existingAddresses = new Set(altAccount.state.addresses.map(addr => addr.toBase58()));
    
    const systemAccounts = [
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ];

    for (const account of systemAccounts) {
      if (!existingAddresses.has(account.toBase58())) {
        addressesToAdd.push(account);
        console.log(`➕ 添加系统账户: ${account.toBase58()}`);
      }
    }

    // 关键代币 mint 地址
    const criticalTokens = {
      SOL: 'So11111111111111111111111111111111111111112',
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    };

    console.log('');
    console.log('📋 检查关键代币:');
    for (const [symbol, mint] of Object.entries(criticalTokens)) {
      if (!existingAddresses.has(mint)) {
        addressesToAdd.push(new PublicKey(mint));
        console.log(`➕ 添加 ${symbol}: ${mint}`);
      } else {
        console.log(`✅ ${symbol} 已在 ALT 中`);
      }
    }

    if (addressesToAdd.length === 0) {
      console.log('');
      console.log('✅ 所有关键代币都已存在于 ALT 中！');
      console.log('💡 无需扩展');
      return;
    }

    console.log('');
    console.log(`📊 准备添加 ${addressesToAdd.length} 个地址`);
    console.log('');

    // 6. 扩展 ALT
    console.log('📤 扩展 ALT...');
    
    // 分批扩展（每批最多20个地址）
    const batchSize = 20;
    let batchNumber = 0;
    
    for (let i = 0; i < addressesToAdd.length; i += batchSize) {
      batchNumber++;
      const batch = addressesToAdd.slice(i, i + batchSize);
      
      const extendIx = AddressLookupTableProgram.extendLookupTable({
        payer: keypair.publicKey,
        authority: keypair.publicKey,
        lookupTable: altAddress,
        addresses: batch,
      });

      const { blockhash: extendBlockhash } = await connection.getLatestBlockhash('confirmed');
      
      const extendMessage = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: extendBlockhash,
        instructions: [extendIx],
      }).compileToV0Message();

      const extendTx = new VersionedTransaction(extendMessage);
      extendTx.sign([keypair]);

      const extendSignature = await connection.sendTransaction(extendTx, {
        maxRetries: 3,
        skipPreflight: false,
      });

      console.log(`   📤 Batch ${batchNumber}: ${extendSignature}`);
      console.log('   ⏳ 等待确认...');

      // 等待确认
      async function waitForConfirmation(sig: string, maxRetries: number = 60): Promise<void> {
        for (let i = 0; i < maxRetries; i++) {
          const status = await connection.getSignatureStatus(sig);
          if (status?.value) {
            if (status.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
            }
            const confirmationStatus = status.value.confirmationStatus;
            if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
              return;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`Transaction confirmation timeout`);
      }

      await waitForConfirmation(extendSignature);
      console.log(`   ✅ Batch ${batchNumber} 完成`);
      
      if (i + batchSize < addressesToAdd.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log('');
    console.log('✅ ALT 扩展完成！');
    console.log('');

    // 7. 验证扩展结果
    console.log('🔍 验证扩展结果...');
    const updatedAccountInfo = await connection.getAccountInfo(altAddress);
    if (updatedAccountInfo) {
      const updatedAltAccount = new AddressLookupTableAccount({
        key: altAddress,
        state: AddressLookupTableAccount.deserialize(updatedAccountInfo.data),
      });
      console.log(`✅ ALT 已更新`);
      console.log(`   新地址数量: ${updatedAltAccount.state.addresses.length}`);
      console.log(`   新增地址: ${updatedAltAccount.state.addresses.length - altAccount.state.addresses.length}`);
      console.log('');
    }

    console.log('='.repeat(60));
    console.log('');
    console.log('✅ 扩展完成！');
    console.log('');
    console.log('💡 现在 ALT 包含了关键代币（SOL、USDC、USDT）');
    console.log('💡 首次使用这些代币进行闪电贷时，不会触发 ALT 扩展');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('❌ 扩展失败:', error.message);
    console.error('');
    process.exit(1);
  }
}

extendJupiterLendALT();







































































































































