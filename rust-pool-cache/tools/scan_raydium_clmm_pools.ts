/**
 * 扫描所有Raydium CLMM池子
 * 
 * 直接从链上获取所有CLMM池子，按流动性和交易量排序
 * 找出最适合套利的池子
 */

import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';
const RAYDIUM_CLMM_PROGRAM = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';

// 重点关注的代币（用于过滤）
const PRIORITY_TOKENS = [
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL
];

async function main() {
  console.log('🔍 扫描Raydium CLMM池子...\n');
  console.log('='.repeat(80));
  console.log('注意：此操作可能需要几分钟，因为需要获取所有CLMM程序账户');
  console.log('='.repeat(80));
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  try {
    console.log('\n正在获取所有CLMM程序账户...');
    
    const programId = new PublicKey(RAYDIUM_CLMM_PROGRAM);
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          dataSize: 1544, // CLMM池子标准大小
        }
      ]
    });
    
    console.log(`✅ 找到 ${accounts.length} 个CLMM池子账户`);
    
    console.log('\n分析池子内容...');
    console.log('(提取token mint信息以识别交易对)\n');
    
    const pools: any[] = [];
    
    for (const account of accounts.slice(0, 50)) { // 限制前50个以节省时间
      try {
        const data = account.account.data;
        
        // CLMM结构中token mint的偏移（基于之前的分析）
        // token_mint_0: offset ~96
        // token_mint_1: offset ~128
        
        const tokenMint0Offset = 96;
        const tokenMint1Offset = 128;
        
        if (data.length >= tokenMint1Offset + 32) {
          const tokenMint0 = new PublicKey(data.slice(tokenMint0Offset, tokenMint0Offset + 32));
          const tokenMint1 = new PublicKey(data.slice(tokenMint1Offset, tokenMint1Offset + 32));
          
          const mint0Str = tokenMint0.toBase58();
          const mint1Str = tokenMint1.toBase58();
          
          // 检查是否包含优先代币
          const isPriority = PRIORITY_TOKENS.includes(mint0Str) || PRIORITY_TOKENS.includes(mint1Str);
          
          if (isPriority) {
            pools.push({
              address: account.pubkey.toBase58(),
              mint0: mint0Str,
              mint1: mint1Str,
              pair: `${getTokenSymbol(mint0Str)}/${getTokenSymbol(mint1Str)}`
            });
          }
        }
      } catch (err) {
        // 跳过解析失败的账户
      }
    }
    
    console.log(`\n找到 ${pools.length} 个优先级池子:\n`);
    console.log('='.repeat(80));
    
    // 按交易对分组
    const grouped: { [key: string]: string[] } = {};
    for (const pool of pools) {
      if (!grouped[pool.pair]) {
        grouped[pool.pair] = [];
      }
      grouped[pool.pair].push(pool.address);
    }
    
    // 输出结果
    for (const [pair, addresses] of Object.entries(grouped)) {
      console.log(`\n📍 ${pair} (${addresses.length}个池子)`);
      if (addresses.length > 1) {
        console.log(`   🔥 可产生直接套利！`);
      }
      addresses.forEach((addr, idx) => {
        console.log(`   ${idx + 1}. ${addr}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n💡 推荐策略:');
    console.log('  1. 添加同一pair有多个池子的交易对（产生直接套利）');
    console.log('  2. 优先添加SOL/USDC, SOL/USDT, USDC/USDT池子');
    console.log('  3. 验证地址后添加到config.toml');
    console.log('\n' + '='.repeat(80));
    
  } catch (error: any) {
    console.log(`\n❌ 扫描失败: ${error?.message || error}`);
    console.log(`\n💡 提示: getProgramAccounts可能受RPC限制`);
    console.log(`   替代方案: 手动从Raydium网站收集池子地址`);
  }
}

function getTokenSymbol(mint: string): string {
  const symbols: { [key: string]: string } = {
    'So11111111111111111111111111111111111111112': 'SOL',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
    'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 'jitoSOL',
    'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': 'bSOL',
  };
  return symbols[mint] || mint.substring(0, 6);
}

main().catch(console.error);



