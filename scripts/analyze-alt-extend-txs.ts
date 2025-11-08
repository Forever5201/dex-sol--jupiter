/**
 * 分析 ALT 扩展交易
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { NetworkAdapter } from '@solana-arb-bot/core';
import { config as loadEnv } from 'dotenv';

loadEnv();

const signatures = [
  'pmjYMKF4QzRPPTRNLp4o5fztJ23Bzcdx6iFmLorexHHzAYzWCdRjPGJy3BrUsEaMQ2jqEZjcx6tqnCnZig3MvWd',
  '5cYUs93wDgpw58i9DLHPzm2iYoGBuVbGovi1yor1tADRo35erT7B49Su6ipuA4CQWnSeHSoeAtPRD1kAEvmsV39s',
];

async function analyzeTransactions() {
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = NetworkAdapter.createConnection(rpcUrl, 'confirmed');

    console.log('');
    console.log('='.repeat(60));
    console.log('分析 ALT 扩展交易');
    console.log('='.repeat(60));
    console.log('');

    for (let i = 0; i < signatures.length; i++) {
      const sig = signatures[i];
      console.log(`📋 交易 ${i + 1}: ${sig}`);
      console.log('');

      try {
        // 获取交易状态
        const status = await connection.getSignatureStatus(sig);
        
        if (!status || !status.value) {
          console.log('   ⚠️ 交易未找到（可能还未确认）');
          console.log('');
          continue;
        }

        if (status.value.err) {
          console.log(`   ❌ 交易失败: ${JSON.stringify(status.value.err)}`);
          console.log('');
          continue;
        }

        console.log(`   ✅ 交易状态: ${status.value.confirmationStatus || 'confirmed'}`);
        
        // 获取交易详情
        const tx = await connection.getTransaction(sig, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        });

        if (!tx) {
          console.log('   ⚠️ 无法获取交易详情');
          console.log('');
          continue;
        }

        console.log(`   📊 区块: ${tx.slot}`);
        console.log(`   💰 交易费: ${tx.meta?.fee || 0} lamports (${((tx.meta?.fee || 0) / 1e9).toFixed(9)} SOL)`);
        
        // 分析交易类型
        const instructions = tx.transaction.message.instructions;
        console.log(`   📋 指令数量: ${instructions.length}`);
        
        let isExtendALT = false;
        for (const ix of instructions) {
          if ('programId' in ix) {
            const programId = ix.programId.toBase58();
            if (programId === 'AddressLookupTab1e1111111111111111111111111') {
              isExtendALT = true;
              console.log(`   🎯 交易类型: 扩展 Address Lookup Table (ALT)`);
              break;
            }
          }
        }

        // 分析账户变化
        if (tx.meta?.postBalances && tx.meta?.preBalances) {
          const preBalance = tx.meta.preBalances[0] / 1e9;
          const postBalance = tx.meta.postBalances[0] / 1e9;
          const balanceChange = postBalance - preBalance;
          
          console.log(`   💰 账户余额变化:`);
          console.log(`      之前: ${preBalance.toFixed(9)} SOL`);
          console.log(`      之后: ${postBalance.toFixed(9)} SOL`);
          console.log(`      变化: ${balanceChange.toFixed(9)} SOL`);
          
          if (balanceChange < 0) {
            console.log(`   ⚠️ 账户余额减少: ${Math.abs(balanceChange).toFixed(9)} SOL`);
          }
        }

        // 分析内部转账（租金）
        if (tx.meta?.innerInstructions) {
          let rentTransferred = 0;
          for (const innerIx of tx.meta.innerInstructions) {
            for (const ix of innerIx.instructions) {
              if (ix.programId && ix.programId.toBase58() === '11111111111111111111111111111111') {
                // System Program 转账可能是租金
                if ('parsed' in ix && ix.parsed && typeof ix.parsed === 'object' && 'info' in ix.parsed) {
                  const info = (ix.parsed as any).info;
                  if (info.lamports) {
                    rentTransferred += info.lamports;
                  }
                }
              }
            }
          }
          if (rentTransferred > 0) {
            console.log(`   💰 ALT 租金: ${(rentTransferred / 1e9).toFixed(9)} SOL`);
          }
        }

        console.log('');
        console.log(`   🔗 Solscan: https://solscan.io/tx/${sig}`);
        console.log('');
        console.log('-'.repeat(60));
        console.log('');

      } catch (error: any) {
        console.log(`   ❌ 分析失败: ${error.message}`);
        console.log('');
      }
    }

    console.log('='.repeat(60));
    console.log('');
    console.log('💡 分析说明:');
    console.log('');
    console.log('这些交易是真实的 ALT 扩展交易，不是模拟交易。');
    console.log('');
    console.log('为什么会发生：');
    console.log('1. 系统在构建闪电贷指令时，发现 ALT 中缺少某些地址');
    console.log('2. 自动调用 extendALT() 扩展 ALT');
    console.log('3. 扩展 ALT 需要发送链上交易，因此会产生费用');
    console.log('');
    console.log('费用包括：');
    console.log('- 交易费（Gas Fee）：约 0.000005 SOL');
    console.log('- ALT 租金（如果需要）：约 0.0001-0.003 SOL');
    console.log('');
    console.log('如何避免：');
    console.log('1. 预先添加所有常用代币到 ALT');
    console.log('2. 我们已经添加了 SOL、USDC、USDT');
    console.log('3. 但如果遇到其他代币（如 mSOL），仍会触发扩展');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('❌ 分析失败:', error.message);
    console.error('');
    process.exit(1);
  }
}

analyzeTransactions();







































































































































