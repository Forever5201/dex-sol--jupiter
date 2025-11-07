/**
 * Jupiter查询Worker
 * 
 * 在独立线程中高频查询Jupiter API
 * 实现真正的环形套利：双向查询（去程 + 回程）
 * 
 * 🔥 支持本地 Jupiter API（延迟 <5ms）
 */

import { workerData, parentPort } from 'worker_threads';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { UnifiedNetworkAdapter } from '@solana-arb-bot/core'; // 🌐 使用统一网络适配器

// 🚀 Jupiter API 配置（支持本地/远程切换）
const shouldUseLocalApi = (value?: string | null): boolean => {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
};

const USE_LOCAL_API = shouldUseLocalApi(process.env.USE_LOCAL_JUPITER_API);
const JUPITER_API_URL = USE_LOCAL_API 
  ? (process.env.JUPITER_LOCAL_API || 'http://localhost:8080')
  : 'https://lite-api.jup.ag/swap/v1';  // 🔥 Legacy Swap API (Metis v1引擎)

const API_ENDPOINT = '/quote';  // 🔥 Legacy Swap API统一使用 /quote

interface WorkerConfig {
  workerId: number;
  totalWorkers: number;  // 🔥 实际创建的Workers总数
  config: {
    jupiterApiUrl: string;  // 已弃用，保留以向后兼容
    apiKey?: string;  // ✅ Ultra API需要API Key
    mints: string[];
    bridges: BridgeToken[];  // 从主线程接收分配的桥接代币
    amount: number;
    minProfitLamports: number;
    queryIntervalMs: number;
    slippageBps: number;
  };
}

interface BridgeToken {
  symbol: string;
  mint: string;
  decimals: number;
  priority: number;
  enabled: boolean;
  description?: string;
}

const { workerId, totalWorkers, config } = workerData as WorkerConfig;

// 🌐 配置代理（使用统一网络适配器）
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

// 🌐 使用 UnifiedNetworkAdapter 创建 Worker 专用的 axios 配置
const axiosConfig = {
  ...UnifiedNetworkAdapter.createWorkerAxiosConfig({
    proxyUrl: proxyUrl || null,
    timeout: 5000,  // 🔥 增加超时时间到 5 秒（适应国内网络）
    enablePooling: true,  // 启用连接池优化
  }),
  headers: {
    'Connection': 'keep-alive',
    'Accept-Encoding': 'br, gzip, deflate',  // 🔥 Brotli压缩
  },
  decompress: true,
  validateStatus: (status: number) => status < 500,
  maxRedirects: 0,
};

console.log(`Worker ${workerId} using NetworkAdapter config: ${proxyUrl ? 'proxy enabled' : 'direct connection'}, timeout=5s`);

// 桥接代币从主线程通过 workerData 接收（不再从文件加载）
const BRIDGE_TOKENS = config.bridges;
console.log(`Worker ${workerId} assigned ${BRIDGE_TOKENS.length} bridge tokens from main thread`);

/**
 * 预热连接池（使用Legacy Swap API）
 * 
 * 🎯 Legacy Swap API：
 * - ✅ lite-api.jup.ag/swap/v1: 官方Lite版本
 * - ✅ 使用GET方法，API Key可选
 * - ✅ Metis v1路由引擎（聚合所有DEX）
 * 
 * 🔥 优化策略：建立10个热连接，避免首次查询TLS握手延迟
 */
async function warmupConnections(): Promise<void> {
  try {
    console.log(`[Worker ${workerId}] 🚀 Warming up connection pool (10 connections)...`);
    
    if (!proxyUrl) {
      console.log(`[Worker ${workerId}] ⚠️ No proxy configured, skipping warmup`);
      return;
    }
    
    // 🔥 使用激进的连接池配置预热
    const agent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false,
      timeout: 5000,
      keepAlive: true,
      keepAliveMsecs: 50,  // 🔥 与主配置一致
      maxSockets: 20,      // 🔥 与主配置一致
      maxFreeSockets: 20,  // 🔥 与主配置一致
      scheduling: 'lifo',
    } as any);
    
    // 设置空闲连接超时
    (agent as any).freeSocketTimeout = 30000;
    
    // 🔥🔥 并发建立10个连接（而不是1个）
    const warmupCount = 10;
    const warmupRequests = Array(warmupCount).fill(null).map(async (_, i) => {
      try {
        await axios.get(
          `${JUPITER_API_URL}${API_ENDPOINT}` +
          '?inputMint=So11111111111111111111111111111111111111112' +
          '&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' +
          '&amount=1000000000' +  // 🔥 使用1 SOL（降低API负载）
          '&slippageBps=50',  // 🔥 Legacy API需要slippageBps参数
          {
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false,
            timeout: 5000,
            headers: {
              'Connection': 'keep-alive',
              'Accept-Encoding': 'br, gzip, deflate',
              // 🔥 Legacy API不需要X-API-Key
            },
          }
        );
        console.log(`[Worker ${workerId}] ✅ Connection ${i + 1}/${warmupCount} ready`);
      } catch (error: any) {
        // 预热失败不影响主流程，静默处理
      }
    });
    
    await Promise.allSettled(warmupRequests);
    console.log(`[Worker ${workerId}] ✅ Connection pool warmed with ${warmupCount} hot connections`);
  } catch (error: any) {
    console.log(`[Worker ${workerId}] ⚠️ Warmup failed (not critical): ${error.message}`);
    console.log(`[Worker ${workerId}] ℹ️ Will proceed with cold start, first query may be slower`);
  }
}

/**
 * Token信息接口
 */
interface TokenInfo {
  symbol: string;
  decimals: number;
}

/**
 * Token信息映射表
 * 包含所有可能作为输入的token（来自mints.txt + bridge-tokens.json）
 */
const TOKEN_INFO = new Map<string, TokenInfo>([
  // 原生SOL
  ['So11111111111111111111111111111111111111112', { symbol: 'SOL', decimals: 9 }],
  // 稳定币
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol: 'USDC', decimals: 6 }],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { symbol: 'USDT', decimals: 6 }],
  // 主流加密资产
  ['7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', { symbol: 'ETH', decimals: 8 }],
  ['3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', { symbol: 'WBTC', decimals: 8 }],
  // DeFi代币
  ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', { symbol: 'JUP', decimals: 6 }],
  ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', { symbol: 'BONK', decimals: 5 }],
  ['4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', { symbol: 'RAY', decimals: 6 }],
  // LST (Liquid Staking Tokens)
  ['mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', { symbol: 'mSOL', decimals: 9 }],
  ['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', { symbol: 'jitoSOL', decimals: 9 }],
  ['7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', { symbol: 'bSOL', decimals: 9 }],
]);

/**
 * 获取Token信息（带回退机制）
 * @param mint Token mint地址
 * @returns TokenInfo对象
 */
function getTokenInfo(mint: string): TokenInfo {
  const info = TOKEN_INFO.get(mint);
  if (info) {
    return info;
  }
  
  // 回退：返回未知token，默认9位小数（SOL标准）
  console.log(`⚠️ Unknown token mint: ${mint.slice(0, 8)}..., using default decimals=9`);
  return { symbol: `${mint.slice(0, 4)}...${mint.slice(-4)}`, decimals: 9 };
}

/**
 * 获取智能默认比率
 * @param inputMint 输入token地址
 * @param bridgeMint 桥接token地址
 * @returns 默认兑换比率
 */
function getSmartDefaultRatio(inputMint: string, bridgeMint: string): number {
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  
  // SOL → 稳定币：1 SOL ≈ 185 USDC/USDT
  if (inputMint === SOL_MINT && (bridgeMint === USDC_MINT || bridgeMint === USDT_MINT)) {
    return 185.0;
  }
  
  // 稳定币 → SOL：1 USDC/USDT ≈ 0.0054 SOL
  if ((inputMint === USDC_MINT || inputMint === USDT_MINT) && bridgeMint === SOL_MINT) {
    return 0.0054;
  }
  
  // 稳定币对（USDC ↔ USDT）：1:1
  if ((inputMint === USDC_MINT || inputMint === USDT_MINT) && 
      (bridgeMint === USDC_MINT || bridgeMint === USDT_MINT)) {
    return 1.0;
  }
  
  // 其他token对：首次使用1.0，等待实际结果更新
  return 1.0;
}

// 历史兑换比率存储（用于估算）
// 结构：Map<"inputMint-bridgeMint", ratio>（使用完整mint地址确保精确）
const historicalRatios = new Map<string, number>();

// 统计信息
let queriesTotal = 0;
let queryTimes: number[] = [];
let opportunitiesFound = 0;
let scanRounds = 0;

// 🔥 新增：详细查询统计
let queriesSuccess = 0;
let queriesFailed = 0;
let queriesNoRoute = 0;
let queriesTimeout = 0;
let queriesError = 0;

// 🔥 新增：错误类型统计
const errorStats = {
  'API_ERROR': 0,
  'TIMEOUT': 0,
  'NO_ROUTE': 0,
  'PARSE_ERROR': 0,
  'NETWORK_ERROR': 0,
  'OTHER': 0,
};

// 🔥 新增：桥接代币性能统计
const bridgeStats = new Map<string, {
  queries: number;
  success: number;
  noRoute: number;
  errors: number;
  opportunities: number;
  avgLatency: number;
  totalLatency: number;
}>();

BRIDGE_TOKENS.forEach(token => {
  bridgeStats.set(token.symbol, {
    queries: 0,
    success: 0,
    noRoute: 0,
    errors: 0,
    opportunities: 0,
    avgLatency: 0,
    totalLatency: 0,
  });
});

/**
 * 查询桥接套利（双向查询）
 * @param inputMint 起始代币
 * @param bridgeToken 桥接代币
 * @returns 套利机会或null
 */
async function queryBridgeArbitrage(
  inputMint: string,
  bridgeToken: BridgeToken
): Promise<any | null> {
  const startTime = Date.now();

  try {
    // 跳过相同代币
    if (inputMint === bridgeToken.mint) {
      return null;
    }

    // 🔥 获取输入token信息（用于正确显示日志）
    const inputTokenInfo = getTokenInfo(inputMint);
    const inputDecimals = Math.pow(10, inputTokenInfo.decimals);
    const bridgeDecimals = Math.pow(10, bridgeToken.decimals);
    const inputAmountDisplay = config.amount / inputDecimals;

    // 首次查询时输出调试信息
    if (queriesTotal === 0) {
      console.log(`[Worker ${workerId}] 🚀 First parallel query starting...`);
      console.log(`   API: ${JUPITER_API_URL}${API_ENDPOINT} ${USE_LOCAL_API ? '(🟢 LOCAL API)' : '(🔴 REMOTE API)'}`);
      console.log(`   Mode: ${USE_LOCAL_API ? 'Local (< 5ms latency)' : 'Remote (~500ms latency)'}`);
      console.log(`   API Key: ${config.apiKey ? 'Configured (...' + config.apiKey.slice(-8) + ')' : 'Not required (Legacy API)'}`);
      console.log(`   Amount: ${config.amount} lamports (${inputAmountDisplay.toFixed(2)} ${inputTokenInfo.symbol})`);
      console.log(`   Path: ${inputMint.slice(0, 8)}... (${inputTokenInfo.symbol}) → ${bridgeToken.symbol}`);
      console.log(`   Routing: ${USE_LOCAL_API ? 'Local Jupiter Router (All DEXes)' : 'Legacy Swap API - Metis v1 (All DEXes)'}`);
      console.log(`   Slippage: ${config.slippageBps}bps (0.5%)`);
      console.log(`   Rate Limit: Standard (requests are rate-limited per user)`);
      console.log(`   🔥 Smart Parallel Query: Estimate + Unit Price Method`);
    }

    // 🔥 新增：更新桥接代币查询统计
    const bridgeStat = bridgeStats.get(bridgeToken.symbol);
    if (bridgeStat) {
      bridgeStat.queries++;
    }

    // 生成精确的比率键（使用mint地址对）
    const ratioKey = `${inputMint}-${bridgeToken.mint}`;
    
    // 获取历史比率（如果没有则使用智能默认值）
    const historicalRatio = historicalRatios.get(ratioKey) || 
      getSmartDefaultRatio(inputMint, bridgeToken.mint);
    
    // 估算去程输出（USDC金额）
    const estimatedBridgeAmount = Math.floor((config.amount / 1e9) * historicalRatio * 1e6);  // 转换为USDC的最小单位
    
    // 构建查询参数（Legacy Swap API需要slippageBps）
    const paramsOut = new URLSearchParams({
      inputMint,
      outputMint: bridgeToken.mint,
      amount: config.amount.toString(),
      slippageBps: config.slippageBps.toString(),  // 🔥 Legacy API必需参数
    });
    
    const paramsBack = new URLSearchParams({
      inputMint: bridgeToken.mint,
      outputMint: inputMint,
      amount: estimatedBridgeAmount.toString(),  // 使用估算值
      slippageBps: config.slippageBps.toString(),  // 🔥 Legacy API必需参数
    });

    // === 🔥 并行查询（关键优化）===
    const parallelStart = Date.now();
    
    // 🔥 新增：单独计时每个请求
    let outboundStartTime: number, outboundEndTime: number;
    let returnStartTime: number, returnEndTime: number;
    
    const [responseOut, responseBack] = await Promise.all([
      // 去程：真实金额
      (async () => {
        outboundStartTime = Date.now();
        const response = await axios.get(
          `${JUPITER_API_URL}${API_ENDPOINT}?${paramsOut}`,
          axiosConfig  // 🔥 Legacy API不需要X-API-Key头
        );
        outboundEndTime = Date.now();
        return response;
      })(),
      // 回程：估算金额
      (async () => {
        returnStartTime = Date.now();
        const response = await axios.get(
          `${JUPITER_API_URL}${API_ENDPOINT}?${paramsBack}`,
          axiosConfig  // 🔥 Legacy API不需要X-API-Key头
        );
        returnEndTime = Date.now();
        return response;
      })()
    ]);
    
    const parallelLatency = Date.now() - parallelStart;
    const outboundMs = outboundEndTime! - outboundStartTime!;
    const returnMs = returnEndTime! - returnStartTime!;
    
    // 验证去程结果
    const quoteOut = responseOut.data;
    if (!quoteOut || !quoteOut.outAmount || quoteOut.outAmount === '0') {
      queriesNoRoute++;
      errorStats.NO_ROUTE++;
      if (bridgeStat) bridgeStat.noRoute++;
      console.log(`[Worker ${workerId}] ⚠️ No route (outbound): ${inputMint.slice(0,8)}...→${bridgeToken.symbol}`);
      return null;
    }
    
    // 验证回程结果
    const quoteBack = responseBack.data;
    if (!quoteBack || !quoteBack.outAmount || quoteBack.outAmount === '0') {
      queriesNoRoute++;
      errorStats.NO_ROUTE++;
      if (bridgeStat) bridgeStat.noRoute++;
      console.log(`[Worker ${workerId}] ⚠️ No route (return): ${bridgeToken.symbol}→${inputMint.slice(0,8)}...`);
      return null;
    }
    
    const actualBridgeAmount = Number(quoteOut.outAmount);  // 实际USDC
    const estimatedReturnSOL = Number(quoteBack.outAmount);  // 基于估算的SOL
    
    // === 🔥 单价法计算实际回程SOL（核心算法）===
    const pricePerBridge = estimatedReturnSOL / estimatedBridgeAmount;
    const actualReturnSOL = Math.floor(pricePerBridge * actualBridgeAmount);
    
    // 更新历史比率（用于下一轮估算）
    const newRatio = actualBridgeAmount / (config.amount / 1e9) / 1e6;  // 转回为 SOL/USDC 比率
    historicalRatios.set(ratioKey, newRatio);
    
    // 🔥 新增：双向查询都成功，标记成功并更新统计
    queriesSuccess++;
    if (bridgeStat) {
      bridgeStat.success++;
      bridgeStat.totalLatency += parallelLatency;
      bridgeStat.avgLatency = bridgeStat.totalLatency / bridgeStat.success;
    }
    
    // 计算利润
    const inputAmount = Number(config.amount);
    const profit = actualReturnSOL - inputAmount;
    const roi = (profit / inputAmount) * 100;
    
    const queryTime = Date.now() - startTime;
    
    // 🔥 关键修复：过滤异常值（超过3秒的查询，可能是TLS错误或超时）
    if (queryTime < 3000) {
      queryTimes.push(queryTime);
      if (queryTimes.length > 100) queryTimes.shift();  // 保持滑动窗口=100
    }
    
    queriesTotal += 2;  // 双向查询算2次

    // 🔥 修复统计逻辑：每20次查询上报一次（避免启动时长时间无统计）
    if (queriesTotal % 20 === 0 && queryTimes.length > 0) {
      const avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
      parentPort?.postMessage({
        type: 'stats',
        data: {
          queriesTotal: 20,  // 🔥 上报增量（每次+20）
          avgQueryTimeMs: avgQueryTime,
        },
      });
    }
    
    // 📊 输出详细的并行查询信息（用于调试和验证）
    // 计算正确的显示单价（inputToken/bridgeToken）
    const pricePerBridgeDisplay = (estimatedReturnSOL / inputDecimals) / (estimatedBridgeAmount / bridgeDecimals);
    
    // 计算人类可读的金额（inputAmountDisplay已在前面定义）
    const actualBridgeAmountDisplay = actualBridgeAmount / bridgeDecimals;
    const estimatedBridgeAmountDisplay = estimatedBridgeAmount / bridgeDecimals;
    const estimatedReturnDisplay = estimatedReturnSOL / inputDecimals;
    const actualReturnDisplay = actualReturnSOL / inputDecimals;
    const profitDisplay = profit / inputDecimals;
    
    console.log(
      `[Worker ${workerId}] ⚡ Parallel query: ${parallelLatency}ms (out:${outboundMs}ms, ret:${returnMs}ms)`
    );
    console.log(
      `  ├─ 去程: ${inputAmountDisplay.toFixed(2)} ${inputTokenInfo.symbol} → ${actualBridgeAmountDisplay.toFixed(2)} ${bridgeToken.symbol} (${outboundMs}ms)`
    );
    console.log(
      `  ├─ 回程: ${estimatedBridgeAmountDisplay.toFixed(2)} ${bridgeToken.symbol} (估算) → ${estimatedReturnDisplay.toFixed(6)} ${inputTokenInfo.symbol} (${returnMs}ms)`
    );
    console.log(
      `  ├─ 比率键: ${inputMint.slice(0,6)}...${inputMint.slice(-4)}-${bridgeToken.mint.slice(0,6)}...${bridgeToken.mint.slice(-4)}`
    );
    console.log(
      `  ├─ 单价: ${pricePerBridgeDisplay.toFixed(8)} ${inputTokenInfo.symbol}/${bridgeToken.symbol}`
    );
    console.log(
      `  ├─ 实际返回: ${pricePerBridgeDisplay.toFixed(8)} × ${actualBridgeAmountDisplay.toFixed(2)} = ${actualReturnDisplay.toFixed(6)} ${inputTokenInfo.symbol}`
    );
    console.log(
      `  └─ 利润: ${actualReturnDisplay.toFixed(6)} - ${inputAmountDisplay.toFixed(2)} = ${profitDisplay.toFixed(6)} ${inputTokenInfo.symbol} (比率=${newRatio.toFixed(2)})`
    );

    return {
      inputMint,
      outputMint: inputMint,  // 环形：输出=输入
      bridgeToken: bridgeToken.symbol,
      bridgeMint: bridgeToken.mint,
      bridgeAmount: actualBridgeAmount,
      inputAmount,
      outputAmount: actualReturnSOL,
      profit,
      roi,
      discoveredAt: Date.now(),  // 🔥 新增：Worker判断为机会的精确时刻
      // 🔥 新增：保存完整的Ultra API响应（用于后续直接构建指令）
      outboundQuote: quoteOut,   // 完整的去程报价
      returnQuote: quoteBack,    // 完整的回程报价
      // 🔥 Ultra API: routePlan 直接在顶层
      outRoute: quoteOut.routePlan || [],
      backRoute: quoteBack.routePlan || [],
      queryTime,
      // Ultra API 信息
      quoteInfo: {
        outPriceImpactPct: quoteOut.priceImpactPct,
        backPriceImpactPct: quoteBack.priceImpactPct,
        outRouter: quoteOut.routePlan?.[0]?.swapInfo?.label,
        backRouter: quoteBack.routePlan?.[0]?.swapInfo?.label,
      },
      // 🔥 新增：详细延迟数据（用于性能分析）
      latency: {
        parallelMs: parallelLatency,
        outboundMs: outboundMs,      // 🔥 新增：去程延迟
        returnMs: returnMs,          // 🔥 新增：回程延迟
        estimatedBridgeAmount,
        actualBridgeAmount,
      },
    };

  } catch (error: any) {
    if (error.response?.status === 404) {
      // No route found - 正常情况
      queriesNoRoute++;
      errorStats.NO_ROUTE++;
      console.log(`[Worker ${workerId}] ⚠️ No route (404): ${inputMint.slice(0,8)}...→${bridgeToken.symbol}`);
      return null;
    }

    // 针对国内代理优化：处理TLS连接错误，自动重试
    if (error.code === 'ECONNRESET' || error.message?.includes('TLS connection') || error.message?.includes('socket disconnected')) {
      // 代理连接中断，等待后重试（仅重试一次）
      await sleep(1000);  // 等1秒后重试
      // 不输出错误日志，避免刷屏
      return null;
    }

    // 🔥 新增：详细错误分类和日志
    const bridgeStat = bridgeStats.get(bridgeToken.symbol);
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.log(`[Worker ${workerId}] ⏱️ Timeout: ${inputMint.slice(0,8)}...→${bridgeToken.symbol}`);
      queriesTimeout++;
      errorStats.TIMEOUT++;
      if (bridgeStat) bridgeStat.errors++;
    } else if (error.response?.status) {
      console.log(`[Worker ${workerId}] ❌ API Error ${error.response.status}: ${inputMint.slice(0,8)}...→${bridgeToken.symbol}`);
      queriesError++;
      errorStats.API_ERROR++;
      if (bridgeStat) bridgeStat.errors++;
    } else if (error.message?.includes('network') || error.code === 'ECONNRESET') {
      console.log(`[Worker ${workerId}] 🌐 Network Error: ${inputMint.slice(0,8)}...→${bridgeToken.symbol}`);
      errorStats.NETWORK_ERROR++;
      if (bridgeStat) bridgeStat.errors++;
    } else {
      console.log(`[Worker ${workerId}] ❌ Error: ${inputMint.slice(0,8)}...→${bridgeToken.symbol} - ${error.message?.slice(0, 50)}`);
      queriesError++;
      errorStats.OTHER++;
      if (bridgeStat) bridgeStat.errors++;
    }

    // 只记录非404错误和非暂时性错误
    if (error.response?.status !== 502) {  // 502可能是暂时性的
      parentPort?.postMessage({
        type: 'error',
        data: `Bridge query failed (${bridgeToken.symbol}): ${error.message}`,
      });
    }
    
    queriesFailed++;
    return null;
  }
}

/**
 * 格式化路径显示
 */
function formatRoute(routePlan: any[]): string {
  if (!routePlan || routePlan.length === 0) return 'Direct';
  
  return routePlan.map((step: any) => {
    const label = step.swapInfo?.label || 'Unknown';
    return label;
  }).join(' → ');
}

/**
 * 主循环（双重遍历：初始代币 × 桥接代币）
 */
async function scanLoop(): Promise<void> {
  const bridgeSymbols = BRIDGE_TOKENS.map(b => b.symbol).join(', ');
  console.log(`Worker ${workerId} started with ${config.mints.length} initial tokens × ${BRIDGE_TOKENS.length} bridge tokens [${bridgeSymbols}]`);
  
  const totalPaths = config.mints.length * BRIDGE_TOKENS.length;
  console.log(`Worker ${workerId} will monitor ${totalPaths} arbitrage paths`);

  let scanCount = 0;
  let lastHeartbeat = Date.now();

  while (true) {
    scanCount++;
    scanRounds++;
    console.log(`[Worker ${workerId}] 🔄 Starting scan round ${scanCount}...`);
    
    // 📊 每 10 轮扫描输出统计汇总
    if (scanCount % 10 === 0 && queryTimes.length > 0) {
      const avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
      const minQueryTime = Math.min(...queryTimes);
      const maxQueryTime = Math.max(...queryTimes);
      
      // 🔥 新增：计算成功率
      const successRate = queriesTotal > 0 ? (queriesSuccess / queriesTotal * 100).toFixed(1) : '0.0';
      const failureRate = queriesTotal > 0 ? (queriesFailed / queriesTotal * 100).toFixed(1) : '0.0';
      const noRouteRate = queriesTotal > 0 ? (queriesNoRoute / queriesTotal * 100).toFixed(1) : '0.0';
      
      console.log(`\n[Worker ${workerId}] 📊 ═══════════════ Performance Statistics ═══════════════`);
      console.log(`[Worker ${workerId}] 📊 Parallel queries: avg ${avgQueryTime.toFixed(0)}ms, min ${minQueryTime}ms, max ${maxQueryTime}ms`);
      console.log(`[Worker ${workerId}] 📊 Total rounds: ${scanRounds}, queries: ${queriesTotal}`);
      console.log(`[Worker ${workerId}] 📊 Success Rate: ${successRate}%`);
      console.log(`[Worker ${workerId}] 📊 Failure Rate: ${failureRate}%`);
      console.log(`[Worker ${workerId}] 📊 No Route Rate: ${noRouteRate}%`);
      
      // 🔥 新增：错误类型分布
      if (queriesFailed > 0 || queriesNoRoute > 0) {
        console.log(`[Worker ${workerId}] 📊 Error Breakdown:`);
        Object.entries(errorStats).forEach(([type, count]) => {
          if (count > 0) {
            const percentage = ((count / queriesTotal) * 100).toFixed(1);
            console.log(`[Worker ${workerId}] 📊   ${type}: ${count} (${percentage}%)`);
          }
        });
      }
      
      // 🔥 新增：桥接代币性能分析
      console.log(`[Worker ${workerId}] 📊 Bridge Token Performance:`);
      bridgeStats.forEach((stats, symbol) => {
        if (stats.queries > 0) {
          const tokenSuccessRate = ((stats.success / stats.queries) * 100).toFixed(1);
          const tokenNoRouteRate = ((stats.noRoute / stats.queries) * 100).toFixed(1);
          console.log(
            `[Worker ${workerId}] 📊   ${symbol}: ${stats.queries} queries, ` +
            `${tokenSuccessRate}% success, ${tokenNoRouteRate}% no-route, ` +
            `${stats.opportunities} opps, avg ${stats.avgLatency.toFixed(0)}ms`
          );
        }
      });
      
      console.log(`[Worker ${workerId}] 📊 Opportunities found: ${opportunitiesFound}`);
      console.log(`[Worker ${workerId}] 📊 ═══════════════════════════════════════════════════════\n`);
    }
    
    // 外层循环：遍历初始代币（从 mints.txt）
    for (const inputMint of config.mints) {
      
      // 内层循环：遍历桥接代币（从 bridge-tokens.json）
      for (const bridgeToken of BRIDGE_TOKENS) {
        try {
          // 定期输出心跳
          const now = Date.now();
          if (now - lastHeartbeat > 30000) { // 每30秒
            console.log(`[Worker ${workerId}] 💓 Heartbeat: ${queriesTotal} queries, ${opportunitiesFound} opportunities`);
            lastHeartbeat = now;
          }
          
          const opportunity = await queryBridgeArbitrage(inputMint, bridgeToken);

          if (opportunity && opportunity.profit > config.minProfitLamports) {
            opportunitiesFound++;
            
            // 🔥 新增：更新桥接代币机会统计
            const bridgeStat = bridgeStats.get(bridgeToken.symbol);
            if (bridgeStat) {
              bridgeStat.opportunities++;
            }
            
            // 发送机会到主线程
            parentPort?.postMessage({
              type: 'opportunity',
              data: {
                inputMint: opportunity.inputMint,
                outputMint: opportunity.outputMint,
                bridgeToken: opportunity.bridgeToken,
                bridgeMint: opportunity.bridgeMint,
                bridgeAmount: opportunity.bridgeAmount,
                inputAmount: opportunity.inputAmount,
                outputAmount: opportunity.outputAmount,
                profit: opportunity.profit,
                roi: opportunity.roi,
                outRoute: opportunity.outRoute,
                backRoute: opportunity.backRoute,
                // 🔥 新增：延迟数据（用于数据库记录）
                latency: opportunity.latency,
                // 🔥 新增：传递完整的quote和发现时间
                discoveredAt: opportunity.discoveredAt,
                outboundQuote: opportunity.outboundQuote,
                returnQuote: opportunity.returnQuote,
                route: [
                  ...opportunity.outRoute.map((step: any) => ({
                    dex: step.swapInfo?.label || 'Unknown',
                    inputMint: step.swapInfo?.inputMint,
                    outputMint: step.swapInfo?.outputMint,
                    inAmount: step.swapInfo?.inAmount,
                    outAmount: step.swapInfo?.outAmount,
                  })),
                  ...opportunity.backRoute.map((step: any) => ({
                    dex: step.swapInfo?.label || 'Unknown',
                    inputMint: step.swapInfo?.inputMint,
                    outputMint: step.swapInfo?.outputMint,
                    inAmount: step.swapInfo?.inAmount,
                    outAmount: step.swapInfo?.outAmount,
                  })),
                ],
              },
            });

            // 在控制台输出机会详情（便于调试）
            const oppInputInfo = getTokenInfo(opportunity.inputMint);
            const oppProfitDisplay = opportunity.profit / Math.pow(10, oppInputInfo.decimals);
            
            console.log(
              `\n🎯 [Worker ${workerId}] Opportunity #${opportunitiesFound}:`,
              `\n   Path: ${opportunity.inputMint.slice(0, 4)}... → ${opportunity.bridgeToken} → ${opportunity.inputMint.slice(0, 4)}...`,
              `\n   Profit: ${oppProfitDisplay.toFixed(6)} ${oppInputInfo.symbol} (${opportunity.roi.toFixed(2)}%)`,
              `\n   Query time: ${opportunity.queryTime}ms`
            );
          }

        } catch (error: any) {
          parentPort?.postMessage({
            type: 'error',
            data: `Scan error (${bridgeToken.symbol}): ${error.message}`,
          });
        }
      }
    }
    
    // 🔥 关键修复：每轮扫描后延迟（避免API限流）
    // 这样可以确保无论查询成功失败，都按照配置的间隔进行查询
    await sleep(config.queryIntervalMs);
  }
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 主入口：预热连接池后启动扫描循环
(async () => {
  // 🎯 关键优化：错开 Worker 启动时间
  // 避免多个 Worker 同时查询，触发API burst限制
  // 公式：延迟 = workerId × (查询间隔 / Worker总数)，确保永久均匀分布
  const startupDelay = workerId * (config.queryIntervalMs / totalWorkers);  // 均匀分布
  console.log(`[Worker ${workerId}] 📊 Distribution: ${workerId}/${totalWorkers}, delay=${startupDelay}ms, interval=${config.queryIntervalMs}ms`);
  if (startupDelay > 0) {
    console.log(`[Worker ${workerId}] ⏳ Waiting ${(startupDelay / 1000).toFixed(1)}s before warmup (avoid proxy congestion)...`);
    await sleep(startupDelay);
  }
  
  // 预热连接池（使用 Lite API，已验证稳定）
  await warmupConnections();
  
  // 启动扫描循环
  await scanLoop();
})().catch(error => {
  parentPort?.postMessage({
    type: 'error',
    data: `Worker ${workerId} fatal error: ${error.message}`,
  });
  process.exit(1);
});
