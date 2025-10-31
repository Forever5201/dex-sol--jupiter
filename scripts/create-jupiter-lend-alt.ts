/**
 * 预先创建 Jupiter Lend ALT
 * 运行此脚本提前创建 ALT，避免运行时创建失败
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  AddressLookupTableProgram, 
  AddressLookupTableAccount, 
  TransactionMessage, 
  VersionedTransaction,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { KeypairManager, NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';

loadEnv();

/**
 * 收集 Jupiter Lend 常用地址
 * 包括系统账户、常用代币 mint 地址等
 */
function collectCommonJupiterLendAddresses(): PublicKey[] {
  const addressSet = new Set<string>();

  // 1. 系统账户（来自 @solana/web3.js）

  addressSet.add(TOKEN_PROGRAM_ID.toBase58());
  addressSet.add(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  addressSet.add(SYSVAR_CLOCK_PUBKEY.toBase58());
  addressSet.add(SYSVAR_RENT_PUBKEY.toBase58());
  addressSet.add(SYSVAR_RECENT_BLOCKHASHES_PUBKEY.toBase58());
  addressSet.add(SYSVAR_INSTRUCTIONS_PUBKEY.toBase58());
  addressSet.add(SystemProgram.programId.toBase58());

  // 2. 常用代币 mint 地址（主流代币）
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
    POLIS: 'poLisWXnNRwC6oB1H7K8JY7gq1qZJ3JZJ3JZJ3JZJ3',
    GRAPE: '8upjSpvjcdpuzhfR1zriwg5NXoDrKVukAHK5XR1Uqe6J',
    C98: 'C98A4nkJXhpVZNAZdHUA95RpTF3T4whtQubL3YobiUX9',
    WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  };

  for (const mint of Object.values(COMMON_TOKENS)) {
    addressSet.add(mint);
  }

  // 3. Jupiter Lend 协议相关地址（从 SDK 推断）
  // 注意：这些地址可能会根据实际 SDK 实现而变化
  // 如果 SDK 提供了程序 ID，应该添加在这里
  
  // 转换为 PublicKey 数组并去重
  return Array.from(addressSet).map(addr => new PublicKey(addr));
}

console.log('');
console.log('='.repeat(60));
console.log('预先创建 Jupiter Lend ALT');
console.log('='.repeat(60));
console.log('');

async function createJupiterLendALT() {
  try {
    // 1. 加载密钥对
    console.log('🔑 加载密钥对...');
    const keypair = KeypairManager.load();
    console.log(`✅ 钱包地址: ${keypair.publicKey.toBase58()}`);
    console.log('');

    // 2. 创建带代理的 Connection
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');
    
    console.log('💰 检查余额...');
    const balance = await KeypairManager.getBalance(connection, keypair);
    console.log(`✅ 当前余额: ${balance.toFixed(9)} SOL`);
    
    const minBalanceRequired = 0.002; // 创建 ALT 需要约 0.001-0.002 SOL
    if (balance < minBalanceRequired) {
      console.log('');
      console.log('❌ 余额不足！');
      console.log(`   需要至少: ${minBalanceRequired} SOL`);
      console.log(`   当前余额: ${balance.toFixed(9)} SOL`);
      console.log('');
      console.log('请先充值到钱包地址:');
      console.log(`   ${keypair.publicKey.toBase58()}`);
      console.log('');
      process.exit(1);
    }
    console.log('');

    // 3. 创建 ALT（空 ALT，稍后可以扩展）
    console.log('📋 创建 ALT...');
    
    // 4. 获取最新的 blockhash 和 slot
    // 注意：Solana 要求 recentSlot 必须在最近的 150 个 slot 内
    // 使用 'confirmed' commitment 确保 slot 是已确认的
    console.log('📡 获取最新的 blockhash 和 slot...');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    // 使用 'confirmed' commitment 获取 slot，确保一致性
    const slot = await connection.getSlot('confirmed');
    
    // 使用稍微早一点的 slot（减 10 个 slot，约 4 秒），确保被认为是 "recent"
    // 这样可以避免 slot 太新而不被认为是 "recent"
    const recentSlot = Math.max(0, slot - 10);
    
    console.log(`📋 当前 slot: ${slot}`);
    console.log(`📋 使用 recent slot: ${recentSlot} (提前 10 个 slot)`);
    
    const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
      authority: keypair.publicKey,
      payer: keypair.publicKey,
      recentSlot: recentSlot,
    });

    console.log(`📋 ALT 地址: ${altAddress.toBase58()}`);
    console.log('');

    // 5. 发送创建交易（立即发送，避免 slot 过期）
    console.log('📤 发送创建交易...');
    
    const message = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [createIx],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([keypair]);

    // 立即发送，避免 slot 过期（recent slot 必须在 150 个 slot 内，约 60 秒）
    const signature = await connection.sendTransaction(tx, {
      maxRetries: 3,
      skipPreflight: false, // 启用预检查，可以提前发现 slot 过期问题
    });

    console.log(`📤 交易签名: ${signature}`);
    console.log('⏳ 等待确认...');

    // 可靠的交易确认函数（使用轮询，避免 WebSocket 超时）
    async function waitForConfirmation(
      conn: Connection,
      sig: string,
      maxRetries: number = 60, // 60 次重试，每次 1 秒 = 60 秒超时
      retryInterval: number = 1000 // 1 秒间隔
    ): Promise<void> {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const status = await conn.getSignatureStatus(sig);
          
          if (status?.value) {
            if (status.value.err) {
              throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
            }
            
            // 检查确认状态
            const confirmationStatus = status.value.confirmationStatus;
            if (confirmationStatus === 'confirmed' || confirmationStatus === 'finalized') {
              console.log(`✅ 交易已确认 (${confirmationStatus})`);
              return;
            }
          }
          
          // 等待后重试
          if (i < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryInterval));
          }
        } catch (error: any) {
          // 如果是最后一次重试，抛出错误
          if (i === maxRetries - 1) {
            throw error;
          }
          // 否则继续重试
          await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
      }
      
      // 如果所有重试都失败，检查交易是否实际成功（可能只是确认超时）
      const finalStatus = await conn.getSignatureStatus(signature);
      if (finalStatus?.value?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(finalStatus.value.err)}`);
      }
      
      // 如果交易没有错误，但也没有确认，可能是确认超时
      throw new Error(`Transaction confirmation timeout after ${maxRetries} retries. Check transaction manually: https://solscan.io/tx/${signature}`);
    }

    // 使用轮询方式确认交易（避免 WebSocket 超时）
    try {
      await waitForConfirmation(connection, signature);
    } catch (error: any) {
      // 如果确认失败，先检查交易是否实际成功
      console.log('⚠️ 确认过程遇到问题，检查交易实际状态...');
      const finalCheck = await connection.getSignatureStatus(signature);
      
      if (finalCheck?.value) {
        if (finalCheck.value.err) {
          throw error; // 交易确实失败
        }
        
        // 交易可能已经成功，只是确认超时
        console.log('⚠️ 交易可能已成功，但确认超时。请手动检查:');
        console.log(`   https://solscan.io/tx/${signature}`);
        console.log('');
        
        // 继续执行，尝试验证 ALT 账户
        console.log('⏳ 继续验证 ALT 账户...');
      } else {
        throw error;
      }
    }

    console.log('');

    // 5. 等待 warmup（1个slot）
    console.log('⏳ 等待 warmup period (1 slot)...');
    const startSlot = await connection.getSlot();
    const targetSlot = startSlot + 1;

    while (true) {
      const currentSlot = await connection.getSlot();
      if (currentSlot >= targetSlot) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    console.log('✅ Warmup 完成');
    console.log('');

    // 6. 验证 ALT 账户
    console.log('🔍 验证 ALT 账户...');
    const accountInfo = await connection.getAccountInfo(altAddress);
    
    if (!accountInfo) {
      throw new Error(`ALT account ${altAddress.toBase58()} not found after creation`);
    }

    const ALT_PROGRAM_ID = new PublicKey('AddressLookupTab1e1111111111111111111111111');
    if (!accountInfo.owner.equals(ALT_PROGRAM_ID)) {
      throw new Error(
        `Invalid ALT owner: expected ${ALT_PROGRAM_ID.toBase58()}, ` +
        `got ${accountInfo.owner.toBase58()}`
      );
    }

    const altAccount = new AddressLookupTableAccount({
      key: altAddress,
      state: AddressLookupTableAccount.deserialize(accountInfo.data),
    });

    console.log(`✅ ALT 验证成功！`);
    console.log(`   地址数量: ${altAccount.state.addresses.length}（空 ALT，稍后会自动扩展）`);
    console.log('');

    // 7. 扩展 ALT（添加常用地址）
    console.log('📦 扩展 ALT 添加常用地址...');
    const commonAddresses = collectCommonJupiterLendAddresses();
    
    if (commonAddresses.length > 0) {
      console.log(`📋 准备添加 ${commonAddresses.length} 个常用地址...`);
      
      // 分批扩展（每批最多20个地址）
      const batchSize = 20;
      let batchNumber = 0;
      
      for (let i = 0; i < commonAddresses.length; i += batchSize) {
        batchNumber++;
        const batch = commonAddresses.slice(i, i + batchSize);
        
        const extendIx = AddressLookupTableProgram.extendLookupTable({
          payer: keypair.publicKey,
          authority: keypair.publicKey,
          lookupTable: altAddress,
          addresses: batch,
        });

        const { blockhash: extendBlockhash, lastValidBlockHeight: extendLastValid } = 
          await connection.getLatestBlockhash('confirmed');
        
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

        await waitForConfirmation(connection, extendSignature);

        console.log(`   ✅ Batch ${batchNumber} 完成`);
        
        // 等待 warmup（最后一个批次后）
        if (i + batchSize < commonAddresses.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log('✅ 所有常用地址已添加到 ALT');
      console.log('');
      
      // 重新验证 ALT
      const updatedAccountInfo = await connection.getAccountInfo(altAddress);
      if (updatedAccountInfo) {
        const updatedAltAccount = new AddressLookupTableAccount({
          key: altAddress,
          state: AddressLookupTableAccount.deserialize(updatedAccountInfo.data),
        });
        console.log(`✅ ALT 已更新，当前地址数量: ${updatedAltAccount.state.addresses.length}`);
        console.log('');
      }
    } else {
      console.log('⚠️ 未找到常用地址，ALT 将保持为空（系统会在第一次使用时自动扩展）');
      console.log('');
    }

    // 8. 保存到 .env 文件
    console.log('💾 保存 ALT 地址到 .env 文件...');
    const envPath = path.join(process.cwd(), '.env');
    
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    // 检查是否已存在 JUPITER_LEND_ALT_ADDRESS
    const envLines = envContent.split('\n');
    let found = false;
    const newLines = envLines.map(line => {
      if (line.startsWith('JUPITER_LEND_ALT_ADDRESS=')) {
        found = true;
        return `JUPITER_LEND_ALT_ADDRESS=${altAddress.toBase58()}`;
      }
      return line;
    });

    if (!found) {
      newLines.push(`JUPITER_LEND_ALT_ADDRESS=${altAddress.toBase58()}`);
    }

    fs.writeFileSync(envPath, newLines.join('\n'));
    console.log('✅ 已保存到 .env 文件');
    console.log('');

    // 8. 显示结果
    console.log('='.repeat(60));
    console.log('');
    console.log('✅ ALT 创建成功！');
    console.log('');
    console.log('ALT 地址:');
    console.log(`   ${altAddress.toBase58()}`);
    console.log('');
    console.log('📝 已自动添加到 .env 文件:');
    console.log(`   JUPITER_LEND_ALT_ADDRESS=${altAddress.toBase58()}`);
    console.log('');
    console.log('💡 提示:');
    console.log('   - ALT 已创建并预填充了常用地址');
    console.log('   - 系统会在第一次使用时自动扩展新地址');
    console.log('   - 如果遇到新地址，会自动扩展 ALT（费用约 0.0001-0.0005 SOL）');
    console.log('');
    console.log('🚀 现在可以启动机器人了:');
    console.log('   pnpm start:flashloan --config=configs/flashloan-serverchan.toml');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('❌ 创建失败:', error.message);
    console.error('');
    
    if (error.message.includes('余额不足') || error.message.includes('insufficient funds')) {
      console.error('可能的原因:');
      console.error('   1. 钱包余额不足（需要至少 0.002 SOL）');
      console.error('   2. 网络连接问题');
      console.error('');
      console.error('解决方案:');
      console.error('   1. 充值到钱包地址');
      console.error('   2. 检查 RPC 连接');
      console.error('');
    } else {
      console.error('请检查:');
      console.error('   1. 钱包余额是否充足');
      console.error('   2. RPC 连接是否正常');
      console.error('   3. 网络是否稳定');
      console.error('');
    }
    
    process.exit(1);
  }
}

createJupiterLendALT();

