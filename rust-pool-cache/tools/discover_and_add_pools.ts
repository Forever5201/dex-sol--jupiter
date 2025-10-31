/**
 * 智能池子发现和添加工具
 * 
 * 基于以下策略发现高价值池子：
 * 1. 已知的常见Raydium池子地址（来自社区/文档）
 * 2. 通过代币对查找匹配的池子
 * 3. 批量验证并输出配置
 */

import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

// 基于专业知识和公开信息的候选池子
const CANDIDATE_POOLS = [
  // ========== Raydium CLMM高价值池子 ==========
  {
    address: 'HkDq2mC3VHY25uX2aufS8dtHbJsER4HPPG8ARWVqmXAx',
    name: 'SOL/USDT (Raydium CLMM)',
    type: 'clmm',
    expectedSize: 1544,
    priority: 10,
    reason: '与SOL/USDT V4形成直接套利'
  },
  {
    address: '5r878BSWPtoXgnqaeFJi7BCycKZ5CodBB2vS9SeiV8q', 
    name: 'SOL/USDT (Raydium CLMM候选2)',
    type: 'clmm',
    expectedSize: 1544,
    priority: 10,
    reason: '与SOL/USDT V4形成直接套利'
  },
  {
    address: 'BzPzBmCRqcqc5CUJxMdNSZwrKzWAQk5b6dUZBsPJLRQx',
    name: 'USDC/USDT (Raydium CLMM)',
    type: 'clmm',
    expectedSize: 1544,
    priority: 10,
    reason: '稳定币直接套利'
  },
  {
    address: 'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ',
    name: 'USDC/USDT (Raydium CLMM候选2)',
    type: 'clmm',
    expectedSize: 1544,
    priority: 10,
    reason: '稳定币直接套利'
  },
  {
    address: '8sLbNZPe2UJvuPJGtuqm4Z7cdLUV3XNLwxjKNSiWJKW8',
    name: 'SOL/USDC (Raydium CLMM 0.01%)',
    type: 'clmm',
    expectedSize: 1544,
    priority: 9,
    reason: '第3个SOL/USDC池，形成3-way套利'
  },
  
  // ========== Orca Whirlpool (CLMM) ==========
  {
    address: '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm',
    name: 'SOL/USDC (Orca Whirlpool)',
    type: 'whirlpool',
    expectedSize: 653,
    priority: 8,
    reason: '跨DEX套利'
  },
  {
    address: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',
    name: 'SOL/USDT (Orca Whirlpool)',
    type: 'whirlpool',
    expectedSize: 653,
    priority: 8,
    reason: '跨DEX套利'
  },
  
  // ========== 更多LST池子 ==========
  {
    address: 'DdpuCCMn7yjPJX79CpE9i8eVHVbr9rpfHJrMq2X5UsoH',
    name: 'bSOL/SOL (Raydium CLMM)',
    type: 'clmm',
    expectedSize: 1544,
    priority: 7,
    reason: 'bSOL LST套利'
  },
  {
    address: '9Jkzz3v1fLkqfpqRa8dRDjt4C3XGFXnW9ijqJQu8hxqN',
    name: 'jitoSOL/USDC (Raydium CLMM)',
    type: 'clmm',
    expectedSize: 1544,
    priority: 7,
    reason: 'jitoSOL三角套利'
  },
  
  // ========== Meteora DLMM ==========
  {
    address: 'Ew2coQRsRUcd6r5s6xZhBKzM6W7VWxJLz2NkWnVPVPx9',
    name: 'SOL/USDC (Meteora DLMM)',
    type: 'dlmm',
    expectedSize: 12000, // Meteora池子较大
    priority: 6,
    reason: 'Meteora跨DEX套利'
  },
];

const RAYDIUM_CLMM_PROGRAM = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
const ORCA_WHIRLPOOL_PROGRAM = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
const METEORA_DLMM_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';

async function main() {
  console.log('🔍 智能池子发现和验证工具\n');
  console.log('='.repeat(80));
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const validPools: any[] = [];
  const invalidPools: any[] = [];
  
  console.log(`\n正在验证 ${CANDIDATE_POOLS.length} 个候选池子...\n`);
  
  for (const candidate of CANDIDATE_POOLS) {
    console.log(`📍 ${candidate.name}`);
    console.log(`   地址: ${candidate.address}`);
    console.log(`   类型: ${candidate.type} | 优先级: ${candidate.priority}`);
    
    try {
      const pubkey = new PublicKey(candidate.address);
      const accountInfo = await connection.getAccountInfo(pubkey);
      
      if (!accountInfo) {
        console.log(`   ❌ 账户不存在\n`);
        invalidPools.push({ ...candidate, error: '账户不存在' });
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
      } else if (candidate.type === 'whirlpool' && owner === ORCA_WHIRLPOOL_PROGRAM) {
        isValid = true;
        poolType = 'whirlpool';
      } else if (candidate.type === 'dlmm' && owner === METEORA_DLMM_PROGRAM) {
        isValid = true;
        poolType = 'dlmm';
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
        invalidPools.push({ ...candidate, error: `类型不匹配 (size=${size})` });
      }
      
    } catch (error: any) {
      console.log(`   ❌ 验证失败: ${error?.message}\n`);
      invalidPools.push({ ...candidate, error: error?.message });
    }
    
    // 避免速率限制
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // 输出结果
  console.log('='.repeat(80));
  console.log('\n📊 验证结果总结\n');
  console.log(`✅ 有效池子: ${validPools.length}`);
  console.log(`❌ 无效池子: ${invalidPools.length}\n`);
  
  if (validPools.length > 0) {
    // 按优先级排序
    validPools.sort((a, b) => b.priority - a.priority);
    
    console.log('='.repeat(80));
    console.log('\n🎯 推荐添加的池子（按优先级排序）\n');
    
    validPools.forEach((pool, idx) => {
      console.log(`${idx + 1}. ${pool.name} (优先级: ${pool.priority})`);
      console.log(`   地址: ${pool.address}`);
      console.log(`   原因: ${pool.reason}\n`);
    });
    
    console.log('='.repeat(80));
    console.log('\n📝 可直接添加到config.toml的配置:\n');
    console.log('# ============================================');
    console.log('# 新发现的高价值池子（批量添加）');
    console.log('# ============================================\n');
    
    for (const pool of validPools) {
      console.log(`[[pools]]`);
      console.log(`address = "${pool.address}"`);
      console.log(`name = "${pool.name}"`);
      console.log(`pool_type = "${pool.poolType}"`);
      console.log(`# ${pool.reason}`);
      console.log(`# ✅ 验证: ${pool.size}字节, Owner=${pool.owner.substring(0, 20)}...`);
      console.log(``);
    }
  }
  
  if (invalidPools.length > 0) {
    console.log('\n❌ 无法验证的池子:\n');
    invalidPools.forEach((pool, idx) => {
      console.log(`${idx + 1}. ${pool.name}`);
      console.log(`   错误: ${pool.error}\n`);
    });
  }
  
  console.log('='.repeat(80));
  console.log('\n💡 下一步:\n');
  console.log('1. 将验证通过的池子配置复制到 rust-pool-cache/config.toml');
  console.log('2. 更新池子总数统计');
  console.log('3. 启动 Rust Pool Cache 测试');
  console.log('\n='.repeat(80));
}

main().catch(console.error);



