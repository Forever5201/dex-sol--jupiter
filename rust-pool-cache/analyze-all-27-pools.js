/**
 * 完整分析所有27个配置池子的状态
 * 找出14个缺失池子的真正原因
 */

const { Connection, PublicKey } = require('@solana/web3.js');

const RPC = 'https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683';

// 从config.toml提取的所有27个池子
const ALL_POOLS = [
  // Raydium V4 (13个)
  { address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2", name: "SOL/USDC (Raydium V4)", type: "amm_v4" },
  { address: "7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX", name: "SOL/USDT (Raydium V4)", type: "amm_v4" },
  { address: "77quYg4MGneUdjgXCunt9GgM1usmrxKY31twEy3WHwcS", name: "USDC/USDT (Raydium V4)", type: "amm_v4" },
  { address: "AVs9TA4nWDzfPJE9gGVNJMVhcQy3V9PGazuz33BfG2RA", name: "BTC/USDC (Raydium V4)", type: "amm_v4" },
  { address: "EoNrn8iUhwgJySD1pHu8Qxm5gSQqLK3za4m8xzD2RuEb", name: "ETH/USDC (Raydium V4)", type: "amm_v4" },
  { address: "He3iAEV5rYjv6Xf7PxKro19eVrC3QAcdic5CF2D2obPt", name: "ETH/SOL (Raydium V4)", type: "amm_v4" },
  { address: "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg", name: "RAY/USDC (Raydium V4)", type: "amm_v4" },
  { address: "C6tp2RVZnxBPFbnAsfTjis8BN9tycESAT4SgDQgbbrsA", name: "RAY/SOL (Raydium V4)", type: "amm_v4" },
  { address: "2p7nYbtPBgtmY69NsE8DAW6szpRJn7tQvDnqvoEWQvjY", name: "ORCA/USDC (Raydium V4)", type: "amm_v4" },
  { address: "8kJqxAbqbPXGH8yCEr4C2DqZHCRnKZX8gKGmceYXMJXv", name: "JUP/USDC (Raydium V4)", type: "amm_v4" },
  { address: "Azbpsv9dxggjhfLJvPZhWpMEPb5GZcqRtPiCBKJfZrYQ", name: "BONK/SOL (Raydium V4)", type: "amm_v4" },
  { address: "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx", name: "WIF/SOL (Raydium V4)", type: "amm_v4" },
  { address: "ZfvDXXUhZDzDVsapffUyXHj9ByCoPjP4thL6YXcZ9ixY", name: "mSOL/SOL (Raydium V4)", type: "amm_v4" },
  
  // Raydium CLMM (1个)
  { address: "61R1ndXxvsWXXkWSyNkCxnzwd3zUNB8Q2ibmkiLPC8ht", name: "SOL/USDC (Raydium CLMM)", type: "clmm" },
  
  // Meteora DLMM (1个)
  { address: "BhQEFZCRnWKQ21LEt4DUby7fKynfmLVJcNjfHNqjEF61", name: "JUP/USDC (Meteora DLMM)", type: "meteora_dlmm" },
  
  // AlphaQ (3个)
  { address: "Pi9nzTjPxD8DsRfRBGfKYzmefJoJM8TcXu2jyaQjSHm", name: "USDT/USDC (AlphaQ)", type: "alphaq" },
  { address: "9xPhpwq6GLUkrDBNfXCbnSP9ARAMMyUQqgkrqaDW6NLV", name: "USDC/USD1 (AlphaQ)", type: "alphaq" },
  { address: "6R3LknvRLwPg7c8Cww7LKqBHRDcGioPoj29uURX9anug", name: "USDS/USDC (AlphaQ)", type: "alphaq" },
  
  // Lifinity V2 (2个)
  { address: "DrRd8gYMJu9XGxLhwTCPdHNLXCKHsxJtMpbn62YqmwQe", name: "SOL/USDC (Lifinity V2)", type: "lifinity_v2" },
  { address: "5zvhFRN45j9oePohUQ739Z4UaSrgPoJ8NLaS2izFuX1j", name: "SOL/USDT (Lifinity V2)", type: "lifinity_v2" },
  
  // TesseraV (1个)
  { address: "FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n", name: "USDC/SOL (TesseraV)", type: "tesserav" },
  
  // Stabble (2个)
  { address: "Fukxeqx33iqRanxqsAcoGfTqbcJbVdu1aoU3zorSobbT", name: "USD1/USDC (Stabble)", type: "stabble" },
  { address: "BqLJmoxkcetgwwybit9XksNTuPzeh7SpxkYExbZKmLEC", name: "USD1/USDC (Stabble) #2", type: "stabble" },
  
  // PancakeSwap (1个)
  { address: "22HUWiJaTNph96KQTKZVy2wg8KzfCems5nyW7E5H5J6w", name: "USDC/USDT (PancakeSwap)", type: "pancakeswap" },
  
  // SolFi V2 (2个) - Vault模式
  { address: "65ZHSArs5XxPseKQbB1B4r16vDxMWnCxHMzogDAqiDUc", name: "USDC/USDT (SolFi V2)", type: "solfi_v2", vault_mode: true },
  { address: "FkEB6uvyzuoaGpgs4yRtFtxC4WJxhejNFbUkj5R6wR32", name: "USDC/USDT (SolFi V2) #2", type: "solfi_v2", vault_mode: true },
  
  // GoonFi (1个) - Vault模式
  { address: "4uWuh9fC7rrZKrN8ZdJf69MN1e2S7FPpMqcsyY1aof6K", name: "USDC/SOL (GoonFi)", type: "goonfi", vault_mode: true },
];

async function checkPool(connection, pool) {
  try {
    const pubkey = new PublicKey(pool.address);
    const accountInfo = await connection.getAccountInfo(pubkey);
    
    if (!accountInfo) {
      return {
        ...pool,
        status: '❌ 账户不存在',
        exists: false,
        data_size: 0,
        issue: 'ACCOUNT_NOT_FOUND'
      };
    }
    
    const dataSize = accountInfo.data.length;
    
    // 检查是否符合预期大小
    const expectedSizes = {
      'amm_v4': [752],
      'clmm': [1544],
      'meteora_dlmm': [multiple sizes],
      'alphaq': [672],
      'lifinity_v2': [911],
      'tesserav': [1264],
      'stabble': [338, 438],
      'pancakeswap': [1544],
      'solfi_v2': [1728],
      'goonfi': [unknown],
    };
    
    let sizeMatch = true;
    let expectedSize = '?';
    
    switch(pool.type) {
      case 'amm_v4':
        expectedSize = '752';
        sizeMatch = dataSize === 752;
        break;
      case 'clmm':
        expectedSize = '1544';
        sizeMatch = dataSize === 1544;
        break;
      case 'alphaq':
        expectedSize = '672';
        sizeMatch = dataSize === 672;
        break;
      case 'lifinity_v2':
        expectedSize = '911';
        sizeMatch = dataSize === 911;
        break;
      case 'tesserav':
        expectedSize = '1264';
        sizeMatch = dataSize === 1264;
        break;
      case 'stabble':
        expectedSize = '338 or 438';
        sizeMatch = dataSize === 338 || dataSize === 438;
        break;
      case 'pancakeswap':
        expectedSize = '1544';
        sizeMatch = dataSize === 1544;
        break;
      case 'solfi_v2':
        expectedSize = '1728';
        sizeMatch = dataSize === 1728;
        break;
    }
    
    let status = '✅ 存在';
    let issue = null;
    
    if (!sizeMatch) {
      status = '⚠️ 大小不匹配';
      issue = `SIZE_MISMATCH (期望${expectedSize}, 实际${dataSize})`;
    }
    
    if (pool.vault_mode) {
      status += ' (Vault模式)';
    }
    
    return {
      ...pool,
      status,
      exists: true,
      data_size: dataSize,
      expected_size: expectedSize,
      size_match: sizeMatch,
      issue,
      lamports: accountInfo.lamports,
      owner: accountInfo.owner.toBase58()
    };
  } catch (e) {
    return {
      ...pool,
      status: '❌ 错误',
      exists: false,
      error: e.message,
      issue: 'CHECK_ERROR'
    };
  }
}

async function main() {
  console.log('🔍 完整分析所有27个配置池子\n');
  console.log('=' .repeat(100));
  
  const connection = new Connection(RPC, 'confirmed');
  
  console.log('\n正在检查所有池子...\n');
  
  const results = [];
  for (let i = 0; i < ALL_POOLS.length; i++) {
    const pool = ALL_POOLS[i];
    process.stdout.write(`[${i+1}/${ALL_POOLS.length}] 检查 ${pool.name}...`);
    const result = await checkPool(connection, pool);
    results.push(result);
    console.log(` ${result.status}`);
    await new Promise(r => setTimeout(r, 100)); // 避免rate limit
  }
  
  console.log('\n' + '='.repeat(100));
  console.log('📊 分析结果\n');
  
  // 分类统计
  const existing = results.filter(r => r.exists);
  const notExisting = results.filter(r => !r.exists);
  const sizeMatch = results.filter(r => r.exists && r.size_match);
  const sizeMismatch = results.filter(r => r.exists && !r.size_match);
  const vaultMode = results.filter(r => r.vault_mode);
  
  console.log(`总配置池子: ${ALL_POOLS.length}个`);
  console.log(`账户存在: ${existing.length}个 ✅`);
  console.log(`账户不存在: ${notExisting.length}个 ❌`);
  console.log(`大小匹配: ${sizeMatch.length}个 ✅`);
  console.log(`大小不匹配: ${sizeMismatch.length}个 ⚠️`);
  console.log(`Vault模式: ${vaultMode.length}个 (需要特殊处理)`);
  
  if (notExisting.length > 0) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`❌ 账户不存在的池子 (${notExisting.length}个):\n`);
    notExisting.forEach((p, i) => {
      console.log(`${i+1}. ${p.name}`);
      console.log(`   地址: ${p.address}`);
      console.log(`   问题: 账户在链上不存在`);
      console.log(``);
    });
  }
  
  if (sizeMismatch.length > 0) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`⚠️ 数据大小不匹配的池子 (${sizeMismatch.length}个):\n`);
    sizeMismatch.forEach((p, i) => {
      console.log(`${i+1}. ${p.name}`);
      console.log(`   地址: ${p.address}`);
      console.log(`   期望大小: ${p.expected_size} bytes`);
      console.log(`   实际大小: ${p.data_size} bytes`);
      console.log(`   问题: ${p.issue}`);
      console.log(``);
    });
  }
  
  console.log(`\n${'='.repeat(100)}`);
  console.log(`✅ 正常的池子 (${sizeMatch.length}个):\n`);
  
  // 按类型分组
  const byType = {};
  sizeMatch.forEach(p => {
    if (!byType[p.type]) byType[p.type] = [];
    byType[p.type].push(p);
  });
  
  Object.keys(byType).sort().forEach(type => {
    console.log(`${type}: ${byType[type].length}个`);
    byType[type].forEach(p => {
      console.log(`  - ${p.name} ${p.vault_mode ? '(Vault)' : ''}`);
    });
  });
  
  console.log(`\n${'='.repeat(100)}`);
  console.log(`🎯 问题总结:\n`);
  
  const issues = {};
  results.forEach(r => {
    if (r.issue) {
      if (!issues[r.issue]) issues[r.issue] = [];
      issues[r.issue].push(r);
    }
  });
  
  Object.keys(issues).forEach(issue => {
    console.log(`${issue}: ${issues[issue].length}个池子`);
    issues[issue].forEach(p => {
      console.log(`  - ${p.name}`);
    });
    console.log(``);
  });
  
  console.log(`${'='.repeat(100)}`);
  console.log(`💡 可能导致"14个池子无数据"的原因:\n`);
  console.log(`1. 账户不存在: ${notExisting.length}个`);
  console.log(`2. 数据大小不匹配导致反序列化失败: ${sizeMismatch.length}个`);
  console.log(`3. Vault模式is_active()问题: ${vaultMode.length}个`);
  console.log(`4. 流动性为0: ?个 (需要运行时检查)`);
  console.log(`5. 其他反序列化错误: ?个 (需要查看error_tracker)`);
  console.log(`\n合计已识别问题: ${notExisting.length + sizeMismatch.length + vaultMode.length}个`);
  console.log(`\n如果14 = ${notExisting.length} + ${sizeMismatch.length} + ${vaultMode.length} + X，则X=${14 - notExisting.length - sizeMismatch.length - vaultMode.length}个池子有其他问题`);
  console.log(`${'='.repeat(100)}\n`);
}

main().catch(console.error);



