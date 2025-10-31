#!/usr/bin/env node
/**
 * 测试并行预判策略
 * 模拟并行获取多种策略的报价，对比时间成本和利润差异
 */

import axios, { AxiosInstance } from 'axios';
import { NetworkAdapter } from '@solana-arb-bot/core';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

// 测试参数
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

interface QuoteStrategy {
  name: string;
  maxAccounts: number;
  maxDexes?: number;
  onlyDirectRoutes: boolean;
}

interface QuoteResult {
  strategy: QuoteStrategy;
  success: boolean;
  latency: number;
  outAmount?: string;
  profit?: number;
  routePlan?: any[];
  marketInfos?: any[];
  error?: string;
}

/**
 * 创建 Jupiter Quote API 客户端
 */
function createQuoteClient(): AxiosInstance {
  return NetworkAdapter.createAxios({
    baseURL: 'https://lite-api.jup.ag/swap/v1',
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    validateStatus: (status: number) => status < 500,
  });
}

/**
 * 获取单个策略的报价
 */
async function getQuote(
  client: AxiosInstance,
  inputMint: string,
  outputMint: string,
  amount: number,
  strategy: QuoteStrategy
): Promise<QuoteResult> {
  const startTime = Date.now();
  
  try {
    const params: any = {
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: 50,
      onlyDirectRoutes: strategy.onlyDirectRoutes,
      maxAccounts: strategy.maxAccounts,
    };
    
    const response = await client.get('/quote', { params });
    const latency = Date.now() - startTime;
    
    if (!response.data || !response.data.outAmount) {
      return {
        strategy,
        success: false,
        latency,
        error: 'No route found',
      };
    }
    
    const outAmount = Number(response.data.outAmount);
    const profit = outAmount - amount;
    
    return {
      strategy,
      success: true,
      latency,
      outAmount: response.data.outAmount,
      profit,
      routePlan: response.data.routePlan,
      marketInfos: response.data.marketInfos,
    };
  } catch (error: any) {
    const latency = Date.now() - startTime;
    return {
      strategy,
      success: false,
      latency,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * 测试串行获取（当前方式）
 */
async function testSerialFetch(
  client: AxiosInstance,
  inputMint: string,
  outputMint: string,
  amount: number,
  strategies: QuoteStrategy[]
): Promise<{
  results: QuoteResult[];
  totalTime: number;
  firstSuccessIndex: number;
}> {
  console.log('\n📊 测试1：串行获取（当前方式）');
  console.log('='.repeat(60));
  
  const startTime = Date.now();
  const results: QuoteResult[] = [];
  let firstSuccessIndex = -1;
  
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    console.log(`\n尝试策略 ${i + 1}/${strategies.length}: ${strategy.name}`);
    
    const result = await getQuote(client, inputMint, outputMint, amount, strategy);
    results.push(result);
    
    if (result.success && firstSuccessIndex === -1) {
      firstSuccessIndex = i;
      console.log(`  ✅ 成功！延迟: ${result.latency}ms, 利润: ${(result.profit! / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      break; // 找到第一个成功的就停止
    } else if (!result.success) {
      console.log(`  ❌ 失败: ${result.error}`);
    }
  }
  
  const totalTime = Date.now() - startTime;
  
  return { results, totalTime, firstSuccessIndex };
}

/**
 * 测试并行获取（预判策略）
 */
async function testParallelFetch(
  client: AxiosInstance,
  inputMint: string,
  outputMint: string,
  amount: number,
  strategies: QuoteStrategy[]
): Promise<{
  results: QuoteResult[];
  totalTime: number;
  firstSuccessIndex: number;
}> {
  console.log('\n📊 测试2：并行获取（预判策略）');
  console.log('='.repeat(60));
  
  const startTime = Date.now();
  
  console.log(`\n并行请求 ${strategies.length} 个策略...`);
  const promises = strategies.map(strategy =>
    getQuote(client, inputMint, outputMint, amount, strategy)
  );
  
  const results = await Promise.all(promises);
  const totalTime = Date.now() - startTime;
  
  // 找到第一个成功的（按利润排序）
  let firstSuccessIndex = -1;
  const successfulResults = results.filter(r => r.success);
  
  if (successfulResults.length > 0) {
    // 按利润降序排序
    successfulResults.sort((a, b) => (b.profit || 0) - (a.profit || 0));
    const bestResult = successfulResults[0];
    firstSuccessIndex = results.findIndex(r => r === bestResult);
    
    console.log(`\n✅ 找到 ${successfulResults.length} 个成功的策略`);
    console.log(`最佳策略: ${bestResult.strategy.name}, 利润: ${(bestResult.profit! / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  } else {
    console.log('\n❌ 所有策略都失败');
  }
  
  // 显示所有结果
  results.forEach((result, index) => {
    const status = result.success ? '✅' : '❌';
    const profitStr = result.success
      ? `利润: ${(result.profit! / LAMPORTS_PER_SOL).toFixed(6)} SOL`
      : `错误: ${result.error}`;
    console.log(`  策略 ${index + 1}: ${status} ${result.strategy.name} - 延迟: ${result.latency}ms, ${profitStr}`);
  });
  
  return { results, totalTime, firstSuccessIndex };
}

/**
 * 分析路由复杂度（估算交易大小）
 */
function analyzeRouteComplexity(routePlan: any[]): {
  totalSwaps: number;
  uniqueDexes: string[];
  totalDexes: number;
  estimatedAccounts: number;
} {
  if (!routePlan || routePlan.length === 0) {
    return { totalSwaps: 0, uniqueDexes: [], totalDexes: 0, estimatedAccounts: 0 };
  }
  
  const uniqueDexes = new Set<string>();
  let totalAccounts = 0;
  
  routePlan.forEach((route: any) => {
    const dexLabel = route.swapInfo?.label || 'Unknown';
    uniqueDexes.add(dexLabel);
    
    // 估算每个swap需要的账户数（保守估计）
    // 每个swap通常需要：输入账户、输出账户、池子账户、程序账户等
    totalAccounts += 15; // 平均每个swap约15个账户
  });
  
  return {
    totalSwaps: routePlan.length,
    uniqueDexes: Array.from(uniqueDexes),
    totalDexes: uniqueDexes.size,
    estimatedAccounts: totalAccounts,
  };
}

/**
 * 估算交易大小（Base64编码后）
 * 基于实际的估算公式（参考 flashloan-bot.ts）
 */
function estimateTransactionSize(
  swap1Complexity: any,
  swap2Complexity: any
): number {
  let size = 0;
  
  // 1. 固定头部
  size += 100;
  
  // 2. 签名数组开销
  size += 64; // 签名
  size += 4;  // 签名数组长度
  
  // 3. ComputeBudget 指令（2个）
  size += 2 * 15;
  
  // 4. 闪电贷指令（borrow + repay）
  size += 2 * 15; // 2个指令的基础开销
  size += 14 * 1; // 账户索引（假设14个账户都在ALT中）
  size += 100; // 指令data
  
  // 5. Swap指令（基于路由复杂度估算）
  // 每个swap：基础开销 + 账户开销 + data开销
  const calculateSwapSize = (complexity: any) => {
    let swapSize = 0;
    const accountCount = complexity.estimatedAccounts;
    
    // 每个指令的基础开销
    swapSize += complexity.totalSwaps * 1; // programId索引
    
    // 账户数（压缩率85%）
    const compressedAccounts = Math.floor(accountCount * 0.85);
    const uncompressedAccounts = accountCount - compressedAccounts;
    swapSize += compressedAccounts * 1; // ALT索引
    swapSize += uncompressedAccounts * 32; // 完整地址
    
    // 账户读写标记
    swapSize += accountCount * 1;
    
    // 账户索引数组开销
    swapSize += Math.ceil(accountCount * 0.5);
    
    // 指令data（估算：每个swap约50字节）
    swapSize += complexity.totalSwaps * 50;
    
    return swapSize;
  };
  
  size += calculateSwapSize(swap1Complexity);
  size += calculateSwapSize(swap2Complexity);
  
  // 6. ALT引用（假设4个ALT）
  size += 4 * 35;
  
  // 7. 版本化交易额外开销
  size += 50;
  
  // 8. 安全边际（5%）
  size = Math.ceil(size * 1.05);
  
  // 9. Base64编码（增加33.3%）
  return Math.ceil(size * 1.333);
}

/**
 * 主测试函数
 */
async function main() {
  console.log('🧪 并行预判策略测试');
  console.log('='.repeat(60));
  
  const client = createQuoteClient();
  
  // 测试参数
  const inputMint = SOL_MINT;
  const outputMint = USDC_MINT;
  const amount = 100 * LAMPORTS_PER_SOL; // 100 SOL
  
  console.log(`\n测试参数:`);
  console.log(`  输入代币: SOL (${inputMint.slice(0, 8)}...)`);
  console.log(`  输出代币: USDC (${outputMint.slice(0, 8)}...)`);
  console.log(`  金额: ${amount / LAMPORTS_PER_SOL} SOL`);
  
  // 定义降级策略
  const strategies: QuoteStrategy[] = [
    {
      name: '策略1：最优路由',
      maxAccounts: 28,
      onlyDirectRoutes: false,
    },
    {
      name: '策略2：中等限制',
      maxAccounts: 24,
      onlyDirectRoutes: false,
    },
    {
      name: '策略3：严格限制',
      maxAccounts: 20,
      onlyDirectRoutes: true,
    },
  ];
  
  // 测试1：串行获取
  const serialResult = await testSerialFetch(client, inputMint, outputMint, amount, strategies);
  
  // 测试2：并行获取
  const parallelResult = await testParallelFetch(client, inputMint, outputMint, amount, strategies);
  
  // 对比分析
  console.log('\n📊 对比分析');
  console.log('='.repeat(60));
  
  console.log(`\n⏱️  时间成本:`);
  console.log(`  串行: ${serialResult.totalTime}ms`);
  console.log(`  并行: ${parallelResult.totalTime}ms`);
  console.log(`  节省: ${serialResult.totalTime - parallelResult.totalTime}ms (${((1 - parallelResult.totalTime / serialResult.totalTime) * 100).toFixed(1)}%)`);
  
  console.log(`\n💰 利润对比:`);
  if (serialResult.firstSuccessIndex >= 0) {
    const serialProfit = serialResult.results[serialResult.firstSuccessIndex].profit!;
    console.log(`  串行最佳: ${(serialProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
  }
  
  if (parallelResult.firstSuccessIndex >= 0) {
    const parallelProfit = parallelResult.results[parallelResult.firstSuccessIndex].profit!;
    console.log(`  并行最佳: ${(parallelProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    
    if (serialResult.firstSuccessIndex >= 0) {
      const serialProfit = serialResult.results[serialResult.firstSuccessIndex].profit!;
      const profitDiff = parallelProfit - serialProfit;
      const profitDiffPercent = ((profitDiff / serialProfit) * 100).toFixed(2);
      console.log(`  差异: ${(profitDiff / LAMPORTS_PER_SOL).toFixed(6)} SOL (${profitDiffPercent}%)`);
    }
  }
  
  // 分析路由复杂度
  console.log(`\n🔍 路由复杂度分析:`);
  parallelResult.results.forEach((result, index) => {
    if (result.success && result.routePlan) {
      const complexity = analyzeRouteComplexity(result.routePlan);
      console.log(`\n  策略 ${index + 1}: ${result.strategy.name}`);
      console.log(`    交换次数: ${complexity.totalSwaps}`);
      console.log(`    DEX数量: ${complexity.totalDexes} (${complexity.uniqueDexes.join(', ')})`);
      console.log(`    估算账户数: ${complexity.estimatedAccounts}`);
    }
  });
  
  // 估算交易大小（为每个策略估算）
  console.log(`\n📏 交易大小估算（基于策略1和策略2的路由）:`);
  const successfulResults = parallelResult.results.filter(r => r.success);
  if (successfulResults.length >= 2) {
    const swap1Result = successfulResults[0];
    const swap2Result = successfulResults[1];
    
    if (swap1Result.routePlan && swap2Result.routePlan) {
      const swap1Complexity = analyzeRouteComplexity(swap1Result.routePlan);
      const swap2Complexity = analyzeRouteComplexity(swap2Result.routePlan);
      
      const estimatedSize = estimateTransactionSize(swap1Complexity, swap2Complexity);
      
      console.log(`  策略组合: ${swap1Result.strategy.name} + ${swap2Result.strategy.name}`);
      console.log(`  估算大小: ${estimatedSize} bytes (Base64编码后)`);
      console.log(`  限制: 1644 bytes`);
      console.log(`  状态: ${estimatedSize <= 1644 ? '✅ 符合限制' : '❌ 超限'}`);
      console.log(`  余量: ${1644 - estimatedSize} bytes`);
    }
  } else if (successfulResults.length >= 1) {
    // 如果只有一个成功的，尝试用同一个策略的两个swap
    const result = successfulResults[0];
    if (result.routePlan) {
      const complexity = analyzeRouteComplexity(result.routePlan);
      // 假设两个swap使用相同的复杂度
      const estimatedSize = estimateTransactionSize(complexity, complexity);
      
      console.log(`  策略: ${result.strategy.name} (假设两个swap相同复杂度)`);
      console.log(`  估算大小: ${estimatedSize} bytes (Base64编码后)`);
      console.log(`  限制: 1644 bytes`);
      console.log(`  状态: ${estimatedSize <= 1644 ? '✅ 符合限制' : '❌ 超限'}`);
    }
  }
  
  console.log('\n✅ 测试完成');
}

// 运行测试
main().catch(error => {
  console.error('❌ 测试失败:', error);
  process.exit(1);
});

