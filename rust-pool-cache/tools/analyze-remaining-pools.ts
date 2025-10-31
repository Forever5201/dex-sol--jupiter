/**
 * 深度分析剩余2个问题池子
 * 
 * 透过现象看本质 - 找出真正的根本原因
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';

const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

// Orca Whirlpool Program ID
const WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';

// 问题池子
const PROBLEM_POOLS = [
  {
    name: 'Stabble USD1/USDC #1',
    address: 'Fukxeqx33iqRanxqsAcoGfTqbcJbVdu1aoU3zorSobbT',
    expectedSize: 438,
    actualSize: 338,
    type: 'stabble',
  },
  {
    name: 'Whirlpool USDC/JUP',
    address: 'C1MgLojNLWBKADvu9BHdtgzz1oZX4dZ5zGdGcgvvW8Wz',
    expectedSize: 1400,
    actualSize: 653,
    type: 'whirlpool',
  },
];

async function main() {
  console.log('🔬 深度分析剩余2个问题池子');
  console.log('透过现象看本质 - 找出根本原因\n');
  
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  
  for (const pool of PROBLEM_POOLS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`池子: ${pool.name}`);
    console.log(`地址: ${pool.address}`);
    console.log(`${'='.repeat(80)}\n`);
    
    const pubkey = new PublicKey(pool.address);
    const accountInfo = await connection.getAccountInfo(pubkey);
    
    if (!accountInfo) {
      console.log('❌ 无法获取账户信息');
      continue;
    }
    
    const data = accountInfo.data;
    const owner = accountInfo.owner.toBase58();
    
    console.log(`📊 基础信息:`);
    console.log(`   Owner (Program ID): ${owner}`);
    console.log(`   Data Length: ${data.length} bytes`);
    console.log(`   Lamports: ${accountInfo.lamports}`);
    console.log(`   Executable: ${accountInfo.executable}`);
    console.log(`   Rent Epoch: ${accountInfo.rentEpoch}`);
    
    // 分析discriminator
    const discriminator = data.slice(0, 8);
    console.log(`\n🔑 Discriminator: 0x${discriminator.toString('hex')}`);
    
    // 对于Whirlpool，检查是否匹配官方Program ID
    if (pool.type === 'whirlpool') {
      console.log(`\n🤔 Whirlpool分析:`);
      console.log(`   期望Program ID: ${WHIRLPOOL_PROGRAM_ID}`);
      console.log(`   实际Program ID: ${owner}`);
      
      if (owner === WHIRLPOOL_PROGRAM_ID) {
        console.log(`   ✅ Program ID匹配`);
        console.log(`\n   ⚠️  关键发现:`);
        console.log(`   - Whirlpool Pool账户通常是 ~1400-1544 bytes`);
        console.log(`   - 当前账户只有 653 bytes`);
        console.log(`   - 可能性1: 这是Position账户（用户头寸），不是Pool账户`);
        console.log(`   - 可能性2: 这是旧版本或测试版本的Pool`);
        console.log(`   - 可能性3: 这是Whirlpool Config账户`);
        
        // 尝试识别账户类型
        console.log(`\n   🔍 账户类型识别:`);
        
        // Whirlpool Position账户特征：
        // - 大约400-800字节
        // - 包含position相关数据
        if (data.length >= 32 && data.length < 800) {
          console.log(`   可能是: Position Account（用户头寸账户）`);
          console.log(`   原因: 大小在Position范围内（400-800字节）`);
        }
        
        // 查找token vault addresses
        console.log(`\n   📍 扫描Token Vault地址...`);
        for (let offset = 0; offset < Math.min(data.length - 32, 300); offset += 32) {
          const pubkeyBytes = data.slice(offset, offset + 32);
          const pk = new PublicKey(pubkeyBytes);
          const pkStr = pk.toBase58();
          
          // 只显示有意义的pubkey（非全零且非System Program）
          if (pkStr !== '11111111111111111111111111111111' &&
              pkStr !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
            console.log(`   Offset ${offset}: ${pkStr}`);
          }
        }
      } else {
        console.log(`   ❌ Program ID不匹配！这可能根本不是Whirlpool池子`);
      }
    }
    
    // 对于Stabble，对比两个版本
    if (pool.type === 'stabble') {
      console.log(`\n🤔 Stabble版本对比:`);
      console.log(`   Stabble #1: 338 bytes (当前失败) ❌`);
      console.log(`   Stabble #2: 438 bytes (已修复成功) ✅`);
      console.log(`   差异: ${438 - 338} = 100 bytes`);
      console.log(`\n   💡 分析:`);
      console.log(`   - 100字节差异 = 可能是12个Pubkey字段的差异`);
      console.log(`   - 或者是一些u64配置字段`);
      console.log(`   - 建议: 这可能是V1 vs V2版本`);
    }
    
    // Hex dump前256字节
    console.log(`\n📄 Hex Dump (前256字节):`);
    const bytesToShow = Math.min(data.length, 256);
    for (let i = 0; i < bytesToShow; i += 16) {
      let line = i.toString(16).padStart(8, '0') + '  ';
      
      // Hex
      for (let j = 0; j < 16; j++) {
        if (i + j < bytesToShow) {
          line += data[i + j].toString(16).padStart(2, '0') + ' ';
        } else {
          line += '   ';
        }
        if (j === 7) line += ' ';
      }
      
      // ASCII
      line += ' |';
      for (let j = 0; j < 16 && i + j < bytesToShow; j++) {
        const byte = data[i + j];
        line += (byte >= 32 && byte <= 126) ? String.fromCharCode(byte) : '.';
      }
      line += '|';
      
      console.log(line);
    }
    
    // 扫描u64值
    console.log(`\n💰 扫描储备量候选值:`);
    const u64Candidates: Array<{offset: number, value: bigint}> = [];
    
    for (let offset = 0; offset <= data.length - 8; offset += 8) {
      const value = data.readBigUInt64LE(offset);
      if (value > 100_000_000n && value < 1_000_000_000_000_000n) {
        u64Candidates.push({ offset, value });
      }
    }
    
    u64Candidates.slice(0, 10).forEach(({ offset, value }) => {
      console.log(`   Offset ${offset}: ${value} (${Number(value) / 1e6} USDC)`);
    });
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎯 根本原因总结');
  console.log(`${'='.repeat(80)}\n`);
  
  console.log(`问题1: Stabble #1 (338字节)`);
  console.log(`   本质: 这是Stabble协议的旧版本/简化版本`);
  console.log(`   解决方案: 创建支持338字节的独立deserializer`);
  console.log(`   优先级: 低（Stabble #2已经工作）`);
  
  console.log(`\n问题2: Whirlpool (653字节)`);
  console.log(`   本质: 很可能这不是Pool账户，而是Position/Config账户`);
  console.log(`   解决方案: 需要找到真正的Whirlpool Pool账户地址`);
  console.log(`   优先级: 中（可能配置错误）`);
  
  console.log(`\n💡 专业建议:`);
  console.log(`   1. Whirlpool需要重新查找正确的Pool地址`);
  console.log(`   2. Stabble #1可以暂时禁用，使用#2即可`);
  console.log(`   3. 或者为Stabble添加多版本支持\n`);
}

main().catch(console.error);

