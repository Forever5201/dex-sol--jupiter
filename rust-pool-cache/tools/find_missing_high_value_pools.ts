/**
 * 分析当前配置，找出缺失的高价值池子
 */

import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

// 基于专业知识和Solana生态公开信息的候选池子
const ADDITIONAL_CANDIDATES = [
  // ========== USDC/USDT高价值池子（稳定币套利核心）==========
  {
    address: '4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4',
    name: 'USDC/USDT (Orca Whirlpool)',
    type: 'whirlpool',
    priority: 10,
    reason: '稳定币直接套利，与Raydium/SolFi形成跨DEX套利'
  },
  
  // ========== 更多Raydium CLMM池子（通过Solscan查找）==========
  {
    address: 'EoNrn8iUhwgJySD1pHu8Qxm5gSQqLK3za4m8xzD2RuEb',
    name: 'ETH/USDC (Raydium CLMM)',
    type: 'clmm',
    priority: 8,
    reason: 'ETH直接套利'
  },
  {
    address: 'ADgJBB5CJnSWE1KYuGjMBaFsLz4BvDvYYFohNqkKpmfq',
    name: 'BTC/USDC (Raydium CLMM)',
    type: 'clmm',
    priority: 8,
    reason: 'BTC直接套利'
  },
  
  // ========== Meteora DLMM（高资本效率）==========
  {
    address: 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq',
    name: 'SOL/USDC (Meteora DLMM)',
    type: 'dlmm',
    priority: 9,
    reason: 'Meteora跨DEX套利，高资本效率'
  },
  {
    address: '5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq',
    name: 'SOL/USDT (Meteora DLMM)',
    type: 'dlmm',
    priority: 9,
    reason: 'Meteora跨DEX套利'
  },
  {
    address: '2onAYHGyxUV4JuYeUpABEGdzJDCRdD7ggEytzcCVJQn8',
    name: 'USDC/USDT (Meteora DLMM)',
    type: 'dlmm',
    priority: 10,
    reason: '稳定币Meteora套利'
  },
  
  // ========== Orca Whirlpool（CLMM）额外池子 ==========
  {
    address: 'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ',
    name: 'USDC/USDT (Orca Whirlpool)',
    type: 'whirlpool',
    priority: 10,
    reason: '稳定币跨DEX套利（Raydium vs Orca）'
  },
  {
    address: '4GpUivZ5Nhru8JKeXqGDmQGxVDuJWZqvTWRjxfp8Hqz2',
    name: 'ETH/SOL (Orca Whirlpool)',
    type: 'whirlpool',
    priority: 7,
    reason: 'ETH跨DEX套利'
  },
  {
    address: 'HqnKWSEmvNJCRRPq5A1JMJqpXbLbvjkb1HKCrPBEj7bx',
    name: 'BTC/SOL (Orca Whirlpool)',
    type: 'whirlpool',
    priority: 7,
    reason: 'BTC跨DEX套利'
  },
  {
    address: 'Es6jMo4TcWFTH9SYqQq9vp7vjLALDNXXU3xKLr3bBzqN',
    name: 'mSOL/SOL (Orca Whirlpool)',
    type: 'whirlpool',
    priority: 8,
    reason: 'mSOL LST跨DEX套利'
  },
  
  // ========== 更多LST池子 ==========
  {
    address: 'H3xhLrSEyDFm6jTw1oCajBx7d3f9qxk8TmT8RbLPvqpL',
    name: 'bSOL/SOL (Raydium V4)',
    type: 'amm_v4',
    priority: 7,
    reason: 'bSOL LST套利'
  },
  {
    address: 'BYcGFKFiToL3RJgc8fxPSFB4jsqKBfNY79K4y62LqKBe',
    name: 'stSOL/SOL (Raydium V4)',
    type: 'amm_v4',
    priority: 7,
    reason: 'stSOL LST套利'
  },
];

const RAYDIUM_CLMM_PROGRAM = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
const ORCA_WHIRLPOOL_PROGRAM = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
const METEORA_DLMM_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const RAYDIUM_V4_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

async function main() {
  console.log('🔍 查找缺失的高价值池子...\n');
  console.log('='.repeat(80));
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const validPools: any[] = [];
  
  console.log(`\n正在验证 ${ADDITIONAL_CANDIDATES.length} 个候选池子...\n`);
  
  for (const candidate of ADDITIONAL_CANDIDATES) {
    console.log(`📍 ${candidate.name}`);
    console.log(`   地址: ${candidate.address}`);
    console.log(`   类型: ${candidate.type} | 优先级: ${candidate.priority}`);
    
    try {
      const pubkey = new PublicKey(candidate.address);
      const accountInfo = await connection.getAccountInfo(pubkey);
      
      if (!accountInfo) {
        console.log(`   ❌ 账户不存在\n`);
        continue;
      }
      
      const size = accountInfo.data.length;
      const owner = accountInfo.owner.toBase58();
      
      let isValid = false;
      let poolType = '';
      
      // 验证类型
      if (candidate.type === 'clmm' && owner === RAYDIUM_CLMM_PROGRAM && size === 1544) {
        isValid = true;
        poolType = 'clmm';
      } else if (candidate.type === 'whirlpool' && owner === ORCA_WHIRLPOOL_PROGRAM && size === 653) {
        isValid = true;
        poolType = 'whirlpool';
      } else if (candidate.type === 'dlmm' && owner === METEORA_DLMM_PROGRAM) {
        isValid = true;
        poolType = 'dlmm';
      } else if (candidate.type === 'amm_v4' && owner === RAYDIUM_V4_PROGRAM) {
        isValid = true;
        poolType = 'amm_v4';
      }
      
      if (isValid) {
        console.log(`   ✅ 验证成功 | 大小: ${size} | Owner: ${owner.substring(0, 20)}...\n`);
        validPools.push({
          ...candidate,
          size,
          owner,
          poolType
        });
      } else {
        console.log(`   ⚠️  类型不匹配 | 大小: ${size} | Owner: ${owner.substring(0, 20)}...\n`);
      }
      
    } catch (error: any) {
      console.log(`   ❌ 验证失败: ${error?.message}\n`);
    }
    
    // 避免速率限制
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // 输出结果
  console.log('='.repeat(80));
  console.log(`\n📊 找到 ${validPools.length} 个可添加的高价值池子\n`);
  
  if (validPools.length > 0) {
    // 按优先级排序
    validPools.sort((a, b) => b.priority - a.priority);
    
    console.log('='.repeat(80));
    console.log('\n🎯 推荐添加（按优先级排序）:\n');
    
    validPools.forEach((pool, idx) => {
      console.log(`${idx + 1}. ${pool.name} (优先级: ${pool.priority})`);
      console.log(`   原因: ${pool.reason}\n`);
    });
    
    console.log('='.repeat(80));
    console.log('\n📝 配置代码:\n');
    
    for (const pool of validPools) {
      console.log(`[[pools]]`);
      console.log(`address = "${pool.address}"`);
      console.log(`name = "${pool.name}"`);
      console.log(`pool_type = "${pool.poolType}"`);
      console.log(`# ${pool.reason}`);
      console.log(`# ✅ 验证: ${pool.size}字节\n`);
    }
  } else {
    console.log('\n⚠️  没有找到可添加的新池子');
    console.log('   可能所有候选地址都无效或不存在');
  }
  
  console.log('='.repeat(80));
}

main().catch(console.error);



