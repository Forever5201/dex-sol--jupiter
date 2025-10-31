/**
 * 查找真正的Whirlpool Pool地址
 * 
 * 通过Orca API或链上数据查找USDC/JUP对的Pool
 */

import { Connection, PublicKey } from '@solana/web3.js';

const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';
const WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';

// USDC和JUP的mint地址
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

// 已知的一些Whirlpool pools用于参考
const KNOWN_POOLS = [
  {
    address: '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm',
    pair: 'SOL/USDC',
    note: '主要SOL/USDC池'
  },
  {
    address: 'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ',
    pair: 'SOL/USDT', 
    note: '主要SOL/USDT池'
  }
];

async function main() {
  console.log('🔍 查找真正的Whirlpool USDC/JUP Pool\n');
  
  const connection = new Connection(RPC_ENDPOINT, 'confirmed');
  
  // 方案1: 测试已知的Whirlpool Pools
  console.log('方案1: 测试已知Whirlpool Pools作为参考\n');
  
  for (const pool of KNOWN_POOLS) {
    console.log(`测试: ${pool.pair} - ${pool.address}`);
    
    try {
      const pubkey = new PublicKey(pool.address);
      const accountInfo = await connection.getAccountInfo(pubkey);
      
      if (accountInfo) {
        console.log(`  ✅ 账户存在`);
        console.log(`     Program ID: ${accountInfo.owner.toBase58()}`);
        console.log(`     Data Length: ${accountInfo.data.length} bytes`);
        console.log(`     Discriminator: 0x${accountInfo.data.slice(0, 8).toString('hex')}`);
        
        // 这是真Pool的标准！
        if (accountInfo.data.length > 1000) {
          console.log(`     ✅ 这是真正的Pool账户（${accountInfo.data.length}字节）\n`);
        }
      }
    } catch (error) {
      console.log(`  ❌ 错误: ${error}\n`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // 方案2: 建议查找路径
  console.log('\n' + '='.repeat(80));
  console.log('💡 如何找到真正的USDC/JUP Whirlpool Pool:');
  console.log('='.repeat(80) + '\n');
  
  console.log('方法1: 使用Orca官方网站');
  console.log('  1. 访问 https://www.orca.so/pools');
  console.log('  2. 搜索 "USDC-JUP" 或 "JUP-USDC"');
  console.log('  3. 点击池子，在URL或页面中找到pool地址\n');
  
  console.log('方法2: 使用Solscan');
  console.log('  1. 访问 https://solscan.io');
  console.log('  2. 搜索Whirlpool Program: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
  console.log('  3. 查找Accounts标签');
  console.log('  4. 过滤Token Pair: USDC + JUP\n');
  
  console.log('方法3: 使用getProgramAccounts RPC调用');
  console.log('  （可能被限流，需要付费RPC）\n');
  
  console.log('🎯 验证标准:');
  console.log('  ✅ Program ID = whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
  console.log('  ✅ Data Length ≈ 1400-1544 bytes (Pool)');
  console.log('  ✅ Discriminator = Pool discriminator');
  console.log('  ✅ 包含USDC和JUP的mint addresses\n');
  
  console.log('❌ 当前地址是错误的:');
  console.log(`   ${KNOWN_POOLS[0]?.address || 'C1MgLojNLWBKADvu9BHdtgzz1oZX4dZ5zGdGcgvvW8Wz'}`);
  console.log('   - 只有653字节');
  console.log('   - 很可能是Position账户');
  console.log('   - 不适合套利交易\n');
}

main().catch(console.error);




