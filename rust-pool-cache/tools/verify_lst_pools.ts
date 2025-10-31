/**
 * 验证找到的LST池子地址
 */

import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

const RAYDIUM_V4_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const RAYDIUM_CLMM_PROGRAM = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';

interface PoolVerification {
  address: string;
  name: string;
  exists: boolean;
  size: number;
  owner: string;
  poolType: string;
  isValid: boolean;
  note: string;
}

// 从Raydium找到的LST池子
const LST_POOLS = [
  {
    address: '8EzbUfvcRT1Q6RL462ekGkgqbxsPmwC5FMLQZhSPMjJ3',
    name: 'SOL-mSOL',
    expectedType: 'CLMM',
    liquidity: '$10.3M',
    volume24h: '$7.4M',
  },
  {
    address: 'GNfeVT5vSWgLYtzveexZJ2Ki9NBtTTzoHAd9oGvoJKW8',
    name: 'mSOL-USDC',
    expectedType: 'CLMM',
    liquidity: '$619K',
    volume24h: '$814K',
  },
  {
    address: '2uoKbPEidR7KAMYtY4x7xdkHXWqYib5k4CutJauSL3Mc',
    name: 'SOL-JitoSOL',
    expectedType: 'CLMM',
    liquidity: '$6.7M',
    volume24h: '$6.1M',
  },
];

async function main() {
  console.log('🔍 验证LST池子地址...\n');
  console.log('='.repeat(80));
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const results: PoolVerification[] = [];
  
  for (const pool of LST_POOLS) {
    console.log(`\n验证: ${pool.name}`);
    console.log(`地址: ${pool.address}`);
    console.log(`流动性: ${pool.liquidity} | 24h交易量: ${pool.volume24h}`);
    console.log('-'.repeat(80));
    
    try {
      const pubkey = new PublicKey(pool.address);
      const accountInfo = await connection.getAccountInfo(pubkey);
      
      if (!accountInfo) {
        console.log('  ❌ 账户不存在');
        results.push({
          address: pool.address,
          name: pool.name,
          exists: false,
          size: 0,
          owner: '',
          poolType: 'Unknown',
          isValid: false,
          note: '账户不存在',
        });
        continue;
      }
      
      const size = accountInfo.data.length;
      const owner = accountInfo.owner.toBase58();
      
      console.log(`  ✅ 账户存在`);
      console.log(`  📏 账户大小: ${size} 字节`);
      console.log(`  👤 Owner: ${owner}`);
      
      let poolType = 'Unknown';
      let isValid = false;
      let note = '';
      
      // 判断池子类型
      if (owner === RAYDIUM_CLMM_PROGRAM) {
        poolType = 'Raydium CLMM';
        if (size === 1544) { // CLMM池子标准大小
          isValid = true;
          note = '✅ Raydium CLMM池子，支持集中流动性';
        } else {
          note = `⚠️  大小${size}不是标准CLMM大小1544，需要进一步验证`;
        }
      } else if (owner === RAYDIUM_V4_PROGRAM) {
        if (size === 752) {
          poolType = 'Raydium AMM V4';
          isValid = true;
          note = '✅ Raydium AMM V4池子';
        } else {
          poolType = 'Raydium (非标准)';
          note = `⚠️  大小${size}不是标准AMM V4大小752`;
        }
      } else {
        note = `⚠️  未知的Owner程序`;
      }
      
      console.log(`  🏷️  类型: ${poolType}`);
      console.log(`  ${isValid ? '✅' : '⚠️'}  ${note}`);
      
      results.push({
        address: pool.address,
        name: pool.name,
        exists: true,
        size,
        owner,
        poolType,
        isValid,
        note,
      });
      
    } catch (error: any) {
      console.log(`  ❌ 验证失败: ${error?.message || error}`);
      results.push({
        address: pool.address,
        name: pool.name,
        exists: false,
        size: 0,
        owner: '',
        poolType: 'Unknown',
        isValid: false,
        note: `验证失败: ${error?.message || error}`,
      });
    }
  }
  
  // 输出总结
  console.log('\n' + '='.repeat(80));
  console.log('📊 验证总结\n');
  
  const valid = results.filter(r => r.isValid);
  const invalid = results.filter(r => !r.isValid);
  
  console.log(`✅ 有效池子: ${valid.length}/${results.length}`);
  console.log(`⚠️  需要注意: ${invalid.length}/${results.length}\n`);
  
  if (valid.length > 0) {
    console.log('📝 可以添加到config.toml的池子:\n');
    for (const pool of valid) {
      const configType = pool.poolType === 'Raydium CLMM' ? 'clmm' : 'amm_v4';
      console.log(`[[pools]]`);
      console.log(`address = "${pool.address}"`);
      console.log(`name = "${pool.name} (Raydium CLMM)"`);
      console.log(`pool_type = "${configType}"`);
      console.log(``);
    }
  }
  
  console.log('='.repeat(80));
}

main().catch(console.error);



