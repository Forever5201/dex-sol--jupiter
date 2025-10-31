/**
 * 从Raydium API获取真实的池子地址
 * 
 * 使用Raydium官方API而不是猜测地址
 */

async function main() {
  console.log('🔍 从Raydium API获取真实池子地址...\n');
  
  try {
    // Raydium的公开API
    const response = await fetch('https://api.raydium.io/v2/main/pairs');
    const data = await response.json();
    
    console.log(`📊 获取到 ${data.length} 个Raydium池子\n`);
    
    // 按流动性排序并过滤高价值池子
    const highValuePairs = data
      .filter((pair: any) => {
        const liquidity = parseFloat(pair.liquidity || 0);
        const volume24h = parseFloat(pair.volume_24h || 0);
        
        // 筛选条件：流动性>$100K 或 24h交易量>$500K
        return liquidity > 100000 || volume24h > 500000;
      })
      .sort((a: any, b: any) => {
        const liqA = parseFloat(a.liquidity || 0);
        const liqB = parseFloat(b.liquidity || 0);
        return liqB - liqA;
      });
    
    console.log(`✅ 筛选出 ${highValuePairs.length} 个高价值池子\n`);
    console.log('='.repeat(80));
    
    // 重点关注的交易对
    const priorityPairs = [
      'SOL-USDC',
      'SOL-USDT',
      'USDC-USDT',
      'SOL-mSOL',
      'SOL-jitoSOL',
      'SOL-bSOL',
      'mSOL-USDC',
      'jitoSOL-USDC'
    ];
    
    console.log('\n🎯 重点交易对池子：\n');
    
    for (const pairName of priorityPairs) {
      const matches = highValuePairs.filter((p: any) => 
        p.name === pairName || p.name === pairName.split('-').reverse().join('-')
      );
      
      if (matches.length > 0) {
        console.log(`\n${pairName}:`);
        matches.forEach((pool: any, idx: number) => {
          console.log(`  ${idx + 1}. ${pool.ammId || pool.market}`);
          console.log(`     类型: ${pool.version || 'Unknown'}`);
          console.log(`     流动性: $${(parseFloat(pool.liquidity) / 1_000_000).toFixed(2)}M`);
          console.log(`     24h交易量: $${(parseFloat(pool.volume_24h) / 1_000_000).toFixed(2)}M`);
        });
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n💡 接下来：将这些地址添加到验证脚本进行验证\n');
    
  } catch (error: any) {
    console.error('❌ 错误:', error.message);
    console.log('\n⚠️  Raydium API可能需要代理或已改变。');
    console.log('   备选方案：直接从 https://raydium.io/pools/ 手动获取');
  }
}

main().catch(console.error);



