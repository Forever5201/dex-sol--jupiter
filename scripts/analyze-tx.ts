import { Connection, PublicKey } from '@solana/web3.js';
import { NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';

loadEnv();

async function analyzeTransaction() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');
  
  const signature = 'kvA51Pc9AXNurWQi9qRCJmPxZStCZ3yJgzVc9ckRV37xkxTQdyAWDdAeP7RkNKuLNqKXWCK64P9o9bkcP67N4Se';
  
  console.log('='.repeat(80));
  console.log('🔍 交易分析');
  console.log('='.repeat(80));
  console.log('');
  console.log(`📋 交易签名: ${signature}`);
  console.log(`🔗 Solscan: https://solscan.io/tx/${signature}`);
  console.log('');
  
  try {
    // 1. 获取交易状态
    console.log('📡 查询交易状态...');
    const status = await connection.getSignatureStatus(signature);
    
    if (!status || !status.value) {
      console.log('❌ 交易未找到（可能未发送或已过期）');
      return;
    }
    
    console.log(`   ✅ 交易存在`);
    console.log(`   Slot: ${status.value.slot || '未知'}`);
    console.log(`   确认状态: ${status.value.confirmationStatus || '未知'}`);
    console.log(`   错误: ${status.value.err ? JSON.stringify(status.value.err) : '无 ✅'}`);
    console.log('');
    
    if (status.value.err) {
      console.log('❌ 交易失败');
      return;
    }
    
    // 2. 获取交易详情
    console.log('📡 获取交易详情...');
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    
    if (!tx) {
      console.log('❌ 无法获取交易详情');
      return;
    }
    
    console.log(`   ✅ 交易详情获取成功`);
    console.log('');
    
    // 3. 基本信息
    console.log('📊 基本信息:');
    console.log(`   时间: ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : '未知'}`);
    console.log(`   Slot: ${tx.slot}`);
    console.log(`   费用: ${tx.meta?.fee ? (tx.meta.fee / 1e9).toFixed(9) + ' SOL' : '未知'}`);
    console.log(`   计算单元: ${tx.meta?.computeUnitsConsumed || '未知'}`);
    console.log('');
    
    // 4. 账户信息
    console.log('👥 账户信息:');
    if (tx.transaction.message.accountKeys) {
      const accountKeys = tx.transaction.message.accountKeys;
      console.log(`   账户数量: ${accountKeys.length}`);
      if (accountKeys.length > 0) {
        console.log(`   签名者: ${accountKeys[0].toBase58()}`);
      }
    }
    console.log('');
    
    // 5. 指令信息
    console.log('📝 指令信息:');
    const instructions = tx.transaction.message.compiledInstructions || [];
    console.log(`   指令数量: ${instructions.length}`);
    
    // 6. 日志信息（前10条）
    if (tx.meta?.logMessages && tx.meta.logMessages.length > 0) {
      console.log('');
      console.log('📋 日志信息（前10条）:');
      tx.meta.logMessages.slice(0, 10).forEach((log, i) => {
        console.log(`   ${i + 1}. ${log}`);
      });
    }
    
    // 7. 尝试解析程序ID
    console.log('');
    console.log('🔍 程序ID分析:');
    const programIds = new Set<string>();
    if (tx.transaction.message.accountKeys) {
      instructions.forEach(ix => {
        if (tx.transaction.message.accountKeys) {
          const programId = tx.transaction.message.accountKeys[ix.programIdIndex];
          if (programId) {
            programIds.add(programId.toBase58());
          }
        }
      });
    }
    
    programIds.forEach((programId, i) => {
      console.log(`   ${i + 1}. ${programId}`);
      
      // 识别常见程序
      if (programId === 'AddressLookupTab1e1111111111111111111111111') {
        console.log('      → Address Lookup Table Program');
      } else if (programId === 'ComputeBudget111111111111111111111111111111') {
        console.log('      → Compute Budget Program');
      } else if (programId === 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') {
        console.log('      → Jupiter Aggregator Program');
      } else if (programId === 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB') {
        console.log('      → Jupiter Lend Program');
      }
    });
    
    console.log('');
    console.log('='.repeat(80));
    
    // 8. 根据日志判断交易类型
    if (tx.meta?.logMessages) {
      const logs = tx.meta.logMessages.join(' ');
      
      if (logs.includes('AddressLookupTable')) {
        console.log('🎯 交易类型: Address Lookup Table (ALT) 操作');
      } else if (logs.includes('Jupiter')) {
        console.log('🎯 交易类型: Jupiter 相关操作');
      } else if (logs.includes('flash') || logs.includes('Flash')) {
        console.log('🎯 交易类型: 闪电贷相关操作');
      } else {
        console.log('🎯 交易类型: 其他操作');
      }
    }
    
  } catch (error: any) {
    console.error('❌ 查询失败:', error.message);
  }
}

analyzeTransaction().catch(console.error);

