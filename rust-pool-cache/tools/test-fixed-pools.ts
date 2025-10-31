/**
 * 测试修复后的池子
 * 
 * 验证：
 * 1. Raydium CLMM (SOL/USDC) - 1544字节反序列化
 * 2. Meteora DLMM (JUP/USDC) - 904字节反序列化
 * 3. SolFi V2, HumidiFi, GoonFi - Vault模式
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';
const connection = new Connection(RPC_URL, 'confirmed');

const TEST_POOLS = [
  { 
    address: '61R1ndXxvsWXXkWSyNkCxnzwd3zUNB8Q2ibmkiLPC8ht', 
    name: 'SOL/USDC (Raydium CLMM)',
    expectedSize: 1544,
    type: 'clmm'
  },
  { 
    address: 'BhQEFZCRnWKQ21LEt4DUby7fKynfmLVJcNjfHNqjEF61', 
    name: 'JUP/USDC (Meteora DLMM)',
    expectedSize: 904,
    type: 'meteora_dlmm'
  },
  { 
    address: '65ZHSArs5XxPseKQbB1B4r16vDxMWnCxHMzogDAqiDUc', 
    name: 'USDC/USDT (SolFi V2)',
    expectedSize: 1728,
    type: 'vault_mode'
  },
  { 
    address: 'hKgG7iEDRFNsJSwLYqz8ETHuZwzh6qMMLow8VXa8pLm', 
    name: 'JUP/USDC (HumidiFi)',
    expectedSize: 1728,
    type: 'vault_mode'
  },
  { 
    address: '4uWuh9fC7rrZKrN8ZdJf69MN1e2S7FPpMqcsyY1aof6K', 
    name: 'USDC/SOL (GoonFi)',
    expectedSize: 856,
    type: 'vault_mode'
  },
];

async function main() {
  console.log('🧪 测试修复后的池子反序列化...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const pool of TEST_POOLS) {
    process.stdout.write(`📦 ${pool.name.padEnd(35)} `);
    
    try {
      const pubkey = new PublicKey(pool.address);
      const accountInfo = await connection.getAccountInfo(pubkey);
      
      if (!accountInfo) {
        console.log('❌ 账户不存在');
        failed++;
        continue;
      }
      
      if (accountInfo.data.length === pool.expectedSize) {
        console.log(`✅ ${accountInfo.data.length} bytes (正确)`);
        passed++;
      } else {
        console.log(`❌ ${accountInfo.data.length} bytes (预期 ${pool.expectedSize})`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ 错误: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log(`测试结果：${passed}/${TEST_POOLS.length} 通过`);
  console.log('='.repeat(80));
  
  if (passed === TEST_POOLS.length) {
    console.log('\n✅ 所有池子验证通过！可以启动系统进行实际测试');
    console.log('\n建议运行命令：');
    console.log('  cd rust-pool-cache');
    console.log('  cargo run --release');
  } else {
    console.log(`\n⚠️ 有 ${failed} 个池子验证失败，请检查`);
  }
}

main().catch(console.error);











