/**
 * 诊断工具 - 分析有问题的池子
 * 
 * 目标：
 * 1. Raydium CLMM (2个) - SOL/USDC, SOL/USDT
 * 2. Meteora DLMM (1个) - JUP/USDC
 * 3. SolFi V2 (2个) - USDC/USDT
 * 4. HumidiFi (3个) - JUP/USDC, USDC/USDT, USD1/USDC
 * 5. GoonFi - 检查重复配置
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';
const connection = new Connection(RPC_URL, 'confirmed');

// 池子配置
const PROBLEM_POOLS = {
  raydium_clmm: [
    { address: '61R1ndXxvsWXXkWSyNkCxnzwd3zUNB8Q2ibmkiLPC8ht', name: 'SOL/USDC (Raydium CLMM)' },
    { address: 'HJiBXL2f4VGZvYprDVgAPRJ4knq6g3vTqRvvPDHxLJSS', name: 'SOL/USDT (Raydium CLMM)' },
  ],
  meteora_dlmm: [
    { address: 'BhQEFZCRnWKQ21LEt4DUby7fKynfmLVJcNjfHNqjEF61', name: 'JUP/USDC (Meteora DLMM)' },
  ],
  solfi_v2: [
    { address: '65ZHSArs5XxPseKQbB1B4r16vDxMWnCxHMzogDAqiDUc', name: 'USDC/USDT (SolFi V2)' },
    { address: 'FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32', name: 'USDC/USDT (SolFi V2) #2' },
  ],
  humidifi: [
    { address: 'hKgG7iEDRFNsJSwLYqz8ETHuZwzh6qMMLow8VXa8pLm', name: 'JUP/USDC (HumidiFi)' },
    { address: '6n9VhCwQ7EwK6NqFDjnHPzEk6wZdRBTfh43RFgHQWHuQ', name: 'USDC/USDT (HumidiFi)' },
    { address: '3QYYvFWgSuGK8bbxMSAYkCqE8QfSuFtByagnZAuekia2', name: 'USD1/USDC (HumidiFi)' },
  ],
  goonfi: [
    { address: '4uWuh9fC7rrZKrN8ZdJf69MN1e2S7FPpMqcsyY1aof6K', name: 'USDC/SOL (GoonFi)' },
  ],
};

async function analyzePool(address: string, name: string, poolType: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 分析：${name}`);
  console.log(`   类型：${poolType}`);
  console.log(`   地址：${address}`);
  console.log('='.repeat(80));

  try {
    const pubkey = new PublicKey(address);
    const accountInfo = await connection.getAccountInfo(pubkey);

    if (!accountInfo) {
      console.log('❌ 账户不存在或无法访问');
      return null;
    }

    console.log(`✅ 账户存在`);
    console.log(`   Owner: ${accountInfo.owner.toBase58()}`);
    console.log(`   Data Length: ${accountInfo.data.length} bytes`);
    console.log(`   Lamports: ${accountInfo.lamports}`);
    console.log(`   Executable: ${accountInfo.executable}`);
    
    // 显示前8字节 (discriminator)
    if (accountInfo.data.length >= 8) {
      const discriminator = accountInfo.data.slice(0, 8);
      console.log(`   Discriminator: 0x${discriminator.toString('hex')}`);
    }

    // 分析数据结构
    console.log(`\n📊 数据分析：`);
    
    if (poolType === 'raydium_clmm') {
      analyzeRaydiumCLMM(accountInfo.data);
    } else if (poolType === 'meteora_dlmm') {
      analyzeMeteoraDLMM(accountInfo.data);
    } else if (poolType === 'solfi_v2') {
      analyzeSolFiV2(accountInfo.data);
    } else if (poolType === 'humidifi') {
      analyzeHumidiFi(accountInfo.data);
    } else if (poolType === 'goonfi') {
      analyzeGoonFi(accountInfo.data);
    }

    // 保存原始数据用于深度分析
    const filename = `analysis-results/${poolType}-${name.replace(/[\/\s]/g, '-')}.bin`;
    fs.mkdirSync('analysis-results', { recursive: true });
    fs.writeFileSync(filename, accountInfo.data);
    console.log(`\n💾 原始数据已保存：${filename}`);

    return {
      address,
      name,
      poolType,
      dataLength: accountInfo.data.length,
      owner: accountInfo.owner.toBase58(),
      discriminator: accountInfo.data.length >= 8 ? accountInfo.data.slice(0, 8).toString('hex') : null,
    };
  } catch (error) {
    console.log(`❌ 错误：${error.message}`);
    return null;
  }
}

function analyzeRaydiumCLMM(data: Buffer) {
  console.log(`   预期大小：~1728 bytes (根据Raydium CLMM文档)`);
  console.log(`   实际大小：${data.length} bytes`);
  console.log(`   差异：${data.length - 1728} bytes`);
  
  if (data.length < 1728) {
    console.log(`   ⚠️ 数据不足，可能协议已升级或数据结构错误`);
  } else if (data.length > 1728) {
    console.log(`   ⚠️ 数据过多，可能有新增字段`);
  } else {
    console.log(`   ✅ 大小匹配`);
  }
  
  // 尝试提取关键字段
  try {
    // Raydium CLMM typically starts with bump (1 byte)
    const bump = data[0];
    console.log(`   Bump: ${bump}`);
    
    // 读取一些pubkey看是否有效
    const readPubkey = (offset: number) => {
      const pubkey = data.slice(offset, offset + 32);
      return new PublicKey(pubkey).toBase58();
    };
    
    console.log(`   AMM Config (offset 1): ${readPubkey(1)}`);
    console.log(`   Owner (offset 33): ${readPubkey(33)}`);
  } catch (e) {
    console.log(`   ❌ 无法解析关键字段：${e.message}`);
  }
}

function analyzeMeteoraDLMM(data: Buffer) {
  console.log(`   预期大小：~904 bytes (8 bytes discriminator + 896 bytes data)`);
  console.log(`   实际大小：${data.length} bytes`);
  
  if (data.length === 904) {
    console.log(`   ✅ 大小完全匹配！`);
  } else {
    console.log(`   差异：${data.length - 904} bytes`);
  }
  
  // Meteora DLMM有8字节discriminator
  if (data.length >= 8) {
    const discriminator = data.slice(0, 8);
    console.log(`   Discriminator: 0x${discriminator.toString('hex')}`);
    
    // 尝试读取数据
    try {
      // Skip discriminator, read parameters
      const offset = 8;
      
      // Read some u16/u32 fields to verify structure
      const baseFactor = data.readUInt16LE(offset);
      const filterPeriod = data.readUInt16LE(offset + 2);
      console.log(`   Base Factor: ${baseFactor}`);
      console.log(`   Filter Period: ${filterPeriod}`);
      
      // Try to read active_id (should be after pubkeys)
      // PoolParameters = 32 bytes, then multiple Pubkeys
      const pubkeyOffset = offset + 32;
      console.log(`   Token X Mint (offset ${pubkeyOffset}): ${new PublicKey(data.slice(pubkeyOffset, pubkeyOffset + 32)).toBase58()}`);
    } catch (e) {
      console.log(`   ❌ 无法解析字段：${e.message}`);
    }
  }
}

function analyzeSolFiV2(data: Buffer) {
  console.log(`   预期大小：1728 bytes`);
  console.log(`   实际大小：${data.length} bytes`);
  
  if (data.length === 1728) {
    console.log(`   ✅ 大小匹配`);
  } else {
    console.log(`   差异：${data.length - 1728} bytes`);
  }
  
  // SolFi V2 结构：5 u64 + 25 Pubkey + 111 u64
  try {
    // Read first few u64 fields
    for (let i = 0; i < 5; i++) {
      const value = data.readBigUInt64LE(i * 8);
      console.log(`   Header Field ${i + 1}: ${value}`);
    }
    
    // Read some pubkeys
    const offset = 5 * 8; // After header u64s
    for (let i = 0; i < 6; i++) {
      const pubkey = new PublicKey(data.slice(offset + i * 32, offset + (i + 1) * 32));
      console.log(`   Pubkey ${i + 1}: ${pubkey.toBase58()}`);
    }
    
    // Read some config fields
    const configOffset = 5 * 8 + 25 * 32;
    console.log(`   Config Fields (first 5):`);
    for (let i = 0; i < 5; i++) {
      const value = data.readBigUInt64LE(configOffset + i * 8);
      console.log(`     [${i}]: ${value}`);
    }
  } catch (e) {
    console.log(`   ❌ 解析错误：${e.message}`);
  }
}

function analyzeHumidiFi(data: Buffer) {
  console.log(`   预期大小：1728 bytes (类似SolFi V2)`);
  console.log(`   实际大小：${data.length} bytes`);
  
  if (data.length === 1728) {
    console.log(`   ✅ 大小匹配`);
    analyzeSolFiV2(data); // Use same analysis
  } else {
    console.log(`   ⚠️ 大小不匹配，需要重新分析结构`);
  }
}

function analyzeGoonFi(data: Buffer) {
  console.log(`   预期大小：856 bytes`);
  console.log(`   实际大小：${data.length} bytes`);
  
  if (data.length === 856) {
    console.log(`   ✅ 大小匹配`);
  } else {
    console.log(`   差异：${data.length - 856} bytes`);
  }
  
  // GoonFi: 15 Pubkey + 47 u64
  try {
    console.log(`   Pubkeys (前6个):`);
    for (let i = 0; i < 6; i++) {
      const pubkey = new PublicKey(data.slice(i * 32, (i + 1) * 32));
      console.log(`     Pubkey ${i + 1}: ${pubkey.toBase58()}`);
    }
    
    const configOffset = 15 * 32;
    console.log(`   Config Fields (前5个):`);
    for (let i = 0; i < 5; i++) {
      const value = data.readBigUInt64LE(configOffset + i * 8);
      console.log(`     [${i}]: ${value}`);
    }
  } catch (e) {
    console.log(`   ❌ 解析错误：${e.message}`);
  }
}

async function main() {
  console.log('🔬 开始诊断问题池子...\n');
  
  const results: any[] = [];
  
  // 1. Raydium CLMM
  console.log('\n' + '█'.repeat(80));
  console.log('█ 1️⃣  RAYDIUM CLMM 池子分析');
  console.log('█'.repeat(80));
  for (const pool of PROBLEM_POOLS.raydium_clmm) {
    const result = await analyzePool(pool.address, pool.name, 'raydium_clmm');
    if (result) results.push(result);
  }
  
  // 2. Meteora DLMM
  console.log('\n' + '█'.repeat(80));
  console.log('█ 2️⃣  METEORA DLMM 池子分析');
  console.log('█'.repeat(80));
  for (const pool of PROBLEM_POOLS.meteora_dlmm) {
    const result = await analyzePool(pool.address, pool.name, 'meteora_dlmm');
    if (result) results.push(result);
  }
  
  // 3. SolFi V2
  console.log('\n' + '█'.repeat(80));
  console.log('█ 3️⃣  SOLFI V2 池子分析');
  console.log('█'.repeat(80));
  for (const pool of PROBLEM_POOLS.solfi_v2) {
    const result = await analyzePool(pool.address, pool.name, 'solfi_v2');
    if (result) results.push(result);
  }
  
  // 4. HumidiFi
  console.log('\n' + '█'.repeat(80));
  console.log('█ 4️⃣  HUMIDIFI 池子分析');
  console.log('█'.repeat(80));
  for (const pool of PROBLEM_POOLS.humidifi) {
    const result = await analyzePool(pool.address, pool.name, 'humidifi');
    if (result) results.push(result);
  }
  
  // 5. GoonFi
  console.log('\n' + '█'.repeat(80));
  console.log('█ 5️⃣  GOONFI 池子分析');
  console.log('█'.repeat(80));
  for (const pool of PROBLEM_POOLS.goonfi) {
    const result = await analyzePool(pool.address, pool.name, 'goonfi');
    if (result) results.push(result);
  }
  
  // 总结
  console.log('\n' + '='.repeat(80));
  console.log('📋 诊断总结');
  console.log('='.repeat(80));
  
  console.log('\n池子数据大小汇总：');
  results.forEach(r => {
    console.log(`  ${r.name.padEnd(40)} ${r.dataLength.toString().padStart(5)} bytes`);
  });
  
  console.log('\n⚠️  需要注意的问题：');
  const clmmPools = results.filter(r => r.poolType === 'raydium_clmm');
  if (clmmPools.length > 0 && clmmPools[0].dataLength !== 1728) {
    console.log(`  1. Raydium CLMM 大小 = ${clmmPools[0].dataLength} bytes (预期 1728 bytes)`);
    console.log(`     → 需要更新反序列化结构`);
  }
  
  const meteoraPools = results.filter(r => r.poolType === 'meteora_dlmm');
  if (meteoraPools.length > 0 && meteoraPools[0].dataLength !== 904) {
    console.log(`  2. Meteora DLMM 大小 = ${meteoraPools[0].dataLength} bytes (预期 904 bytes)`);
    console.log(`     → 需要调整数据结构`);
  }
  
  console.log('\n✅ 诊断完成！所有原始数据已保存到 analysis-results/ 目录');
  console.log('   接下来可以使用 Rust 工具进一步分析二进制数据');
}

main().catch(console.error);











