/**
 * Jupiter机会发现器
 * 
 * 高频查询本地Jupiter API，发现环形套利机会
 * 使用Worker Threads实现并行查询
 */

import { Worker } from 'worker_threads';
import { PublicKey } from '@solana/web3.js';
import { createLogger } from '../../core/src/logger';
import path from 'path';
import os from 'os';
import { readFileSync } from 'fs';
// import { databaseRecorder } from '@solana-arb-bot/core'; // 数据库功能暂时禁用
import { RustPoolCacheClient } from './rust-cache-client';

const logger = createLogger('OpportunityFinder');

/**
 * 桥接代币接口（从 bridge-tokens.json 加载）
 */
interface BridgeToken {
  symbol: string;
  mint: string;
  decimals: number;
  priority: number;
  enabled: boolean;
  description?: string;
}

/**
 * 套利机会接口
 */
export interface ArbitrageOpportunity {
  /** 输入代币 */
  inputMint: PublicKey;
  /** 输出代币（环形套利中等于输入） */
  outputMint: PublicKey;
  /** 桥接代币符号（如 "USDC"） */
  bridgeToken?: string;
  /** 桥接代币地址 */
  bridgeMint?: PublicKey;
  /** 中间桥接金额 */
  bridgeAmount?: number;
  /** 完整的去程报价（Ultra API /v1/order响应） */
  outboundQuote?: any;
  /** 完整的回程报价（Ultra API /v1/order响应） */
  returnQuote?: any;
  /** Worker发现机会的精确时间戳 */
  discoveredAt?: number;
  /** 去程路径详情 */
  outRoute?: any[];
  /** 回程路径详情 */
  backRoute?: any[];
  /** 输入金额 */
  inputAmount: number;
  /** 输出金额 */
  outputAmount: number;
  /** 利润（lamports） */
  profit: number;
  /** ROI百分比 */
  roi: number;
  /** 路由信息 */
  route: RouteInfo[];
  /** 发现时间（Worker判断为机会的时间戳） */
  timestamp: number;
  /** 查询延迟数据（用于性能分析） */
  latency?: {
    outboundMs?: number;  // 去程查询延迟
    returnMs?: number;    // 回程查询延迟
  };
  /** 方案A: 构建质量数据（仅高ROI机会） */
  quality?: any;
}

export interface RouteInfo {
  dex: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
}

/**
 * 配置接口
 */
export interface OpportunityFinderConfig {
  /** Jupiter API URL（已弃用，现硬编码为 Quote API） */
  jupiterApiUrl?: string;
  /** Jupiter API Key（已弃用，Quote API 无需认证） */
  apiKey?: string;
  /** 目标代币列表 */
  mints: PublicKey[];
  /** 每个代币的交易金额（lamports） */
  amount: number;
  /** 最小利润阈值（lamports） */
  minProfitLamports: number;
  /** Worker线程数量 */
  workerCount?: number;
  /** 查询间隔（ms） */
  queryIntervalMs?: number;
  /** 滑点容差（基点） */
  slippageBps?: number;
  /** 监控服务实例（可选） */
  monitoring?: any;
  /** 数据库功能启用（可选） */
  databaseEnabled?: boolean;
}

/**
 * Worker消息类型
 */
interface WorkerMessage {
  type: 'opportunity' | 'error' | 'stats';
  data: any;
}

/**
 * Jupiter机会发现器
 */
export class OpportunityFinder {
  private config: Required<OpportunityFinderConfig>;
  private workers: Worker[] = [];
  private isRunning = false;
  private monitoring?: any;
  private databaseEnabled: boolean;
  private actualWorkerCount = 0;  // 🔥 实际创建的Workers总数
  private rustCache: RustPoolCacheClient;  // 🦀 Rust Pool Cache 客户端
  private stats = {
    queriesTotal: 0,
    opportunitiesFound: 0,
    avgQueryTimeMs: 0,
  };

  constructor(config: OpportunityFinderConfig) {
    this.monitoring = config.monitoring;
    this.databaseEnabled = config.databaseEnabled || false;
    this.config = {
      ...config,
      jupiterApiUrl: config.jupiterApiUrl || 'https://api.jup.ag/ultra',  // 使用Ultra API
      apiKey: config.apiKey || '',  // Ultra API需要API Key
      workerCount: config.workerCount || Math.min(os.cpus().length, 8),
      queryIntervalMs: config.queryIntervalMs || 1500,  // 🔥 修复默认值：从10ms改为1500ms
      slippageBps: config.slippageBps || 50,
      monitoring: config.monitoring,
      databaseEnabled: this.databaseEnabled,
    };

    // 🦀 初始化 Rust Pool Cache 客户端
    const rustCacheUrl = process.env.RUST_CACHE_URL || 'http://localhost:3001';
    const rustCacheEnabled = process.env.USE_RUST_CACHE !== 'false';
    this.rustCache = new RustPoolCacheClient(rustCacheUrl, rustCacheEnabled);

    logger.info(
      `Opportunity Finder initialized: ${this.config.workerCount} workers, ` +
      `${this.config.mints.length} mints, ` +
      `min profit ${this.config.minProfitLamports} lamports, ` +
      `using Quote API (https://quote-api.jup.ag/v6)`
    );

    if (rustCacheEnabled) {
      logger.info(`🦀 Rust Pool Cache enabled: ${rustCacheUrl}`);
    }

    if (this.databaseEnabled) {
      logger.info('Database recording enabled for opportunities');
    }
  }

  /**
   * 启动机会发现器
   */
  async start(onOpportunity: (opp: ArbitrageOpportunity) => void): Promise<void> {
    if (this.isRunning) {
      logger.warn('Opportunity Finder already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting Opportunity Finder...');

    // 🦀 检查 Rust Pool Cache 可用性
    const rustCacheAvailable = await this.rustCache.isAvailable();
    if (rustCacheAvailable) {
      logger.info('✅ Rust Pool Cache is available and ready');
      const stats = await this.rustCache.getStats();
      if (stats) {
        logger.info(`   Cached pools: ${stats.cached_pools}, Pairs: ${stats.cached_pairs.join(', ')}`);
      }
    } else {
      logger.warn('⚠️  Rust Pool Cache is not available, using Jupiter API only');
    }

    // 读取桥接代币配置
    let bridgeTokens: BridgeToken[] = [];
    try {
      const bridgeTokensPath = path.join(process.cwd(), 'bridge-tokens.json');
      const rawData = readFileSync(bridgeTokensPath, 'utf-8');
      bridgeTokens = JSON.parse(rawData)
        .filter((t: BridgeToken) => t.enabled)  // 只加载启用的
        .sort((a: BridgeToken, b: BridgeToken) => a.priority - b.priority);  // 按优先级排序
      
      logger.info(`Loaded ${bridgeTokens.length} enabled bridge tokens from config`);
    } catch (error: any) {
      logger.error(`Failed to load bridge tokens:`, error.message);
      throw new Error('Cannot start without bridge tokens configuration');
    }

    // 🎯 检测是否启用专项分工模式（通过环境变量）
    const isDedicatedMode = process.env.DEDICATED_WORKER_MODE === 'true';
    const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

    if (isDedicatedMode) {
      logger.info('🎯 Dedicated Worker Mode enabled');
      
      // 验证必要的桥接代币
      const usdtBridge = bridgeTokens.find(b => b.symbol === 'USDT');
      const usdcBridge = bridgeTokens.find(b => b.symbol === 'USDC');
      
      if (!usdtBridge || !usdcBridge) {
        logger.error('❌ Dedicated mode requires both USDT and USDC to be enabled');
        throw new Error('USDT and USDC must be enabled in bridge-tokens.json for dedicated mode');
      }
      
      if (this.config.workerCount < 2) {
        logger.warn(`⚠️  workerCount is ${this.config.workerCount}, but dedicated mode needs 2. Adjusting to 2.`);
        this.config.workerCount = 2;
      }
      
      // 执行专项分工创建
      await this.createDedicatedWorkers(SOL_MINT, usdtBridge, usdcBridge, onOpportunity);
      
      // 跳过默认的Worker创建逻辑
      return;
    }

    // 🔥 关键修复：先计算实际会创建的Workers总数
    const bridgesPerWorker = Math.ceil(bridgeTokens.length / this.config.workerCount);
    let totalWorkersToCreate = 0;
    for (let i = 0; i < this.config.workerCount; i++) {
      const startIdx = i * bridgesPerWorker;
      const endIdx = Math.min(startIdx + bridgesPerWorker, bridgeTokens.length);
      const workerBridges = bridgeTokens.slice(startIdx, endIdx);
      if (workerBridges.length > 0) {
        totalWorkersToCreate++;
      }
    }
    logger.info(`🔥 Will create ${totalWorkersToCreate} workers (config: ${this.config.workerCount}, bridges: ${bridgeTokens.length})`);

    // 创建Workers（所有Workers收到相同的totalWorkers值）
    for (let i = 0; i < this.config.workerCount; i++) {
      const startIdx = i * bridgesPerWorker;
      const endIdx = Math.min(startIdx + bridgesPerWorker, bridgeTokens.length);
      const workerBridges = bridgeTokens.slice(startIdx, endIdx);

      if (workerBridges.length === 0) continue;

      // 所有初始代币都传给每个worker（传递固定的totalWorkersToCreate）
      await this.startWorker(i, this.config.mints, workerBridges, onOpportunity, totalWorkersToCreate);
      this.actualWorkerCount++;
    }

    logger.info(`✅ Created ${this.actualWorkerCount} workers`);

    // 定期输出统计信息
    const statsInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(statsInterval);
        return;
      }

      logger.info(
        `Stats: ${this.stats.queriesTotal} queries, ` +
        `${this.stats.opportunitiesFound} opportunities, ` +
        `avg ${this.stats.avgQueryTimeMs.toFixed(1)}ms per query`
      );
    }, 60000); // 每分钟
  }

  /**
   * 创建专项分工的Workers
   * Worker 0: SOL → USDT → SOL
   * Worker 1: SOL → USDC → SOL
   */
  private async createDedicatedWorkers(
    solMint: PublicKey,
    usdtBridge: BridgeToken,
    usdcBridge: BridgeToken,
    onOpportunity: (opp: ArbitrageOpportunity) => void
  ): Promise<void> {
    logger.info('🚀 Creating dedicated workers...');
    
    // 🔑 读取每个Worker的专属API Key（环境变量优先，后备使用配置文件）
    const apiKeyWorker0 = process.env.JUPITER_API_KEY_WORKER_0 || this.config.apiKey;
    const apiKeyWorker1 = process.env.JUPITER_API_KEY_WORKER_1 || this.config.apiKey;
    
    // 显示Key分配信息（脱敏）
    logger.info(`🔑 Worker 0 API Key: ${apiKeyWorker0 ? '...' + apiKeyWorker0.slice(-8) : 'Not configured'}`);
    logger.info(`🔑 Worker 1 API Key: ${apiKeyWorker1 ? '...' + apiKeyWorker1.slice(-8) : 'Not configured'}`);
    
    if (apiKeyWorker0 === apiKeyWorker1) {
      logger.warn('⚠️  Both workers using the same API Key (quota will be shared)');
    } else {
      logger.info('✅ Workers using separate API Keys (independent quotas)');
    }
    
    // Worker 0: SOL → USDT → SOL (使用专属Key)
    await this.startWorker(
      0,
      [solMint],           // 只传SOL
      [usdtBridge],        // 只传USDT
      onOpportunity,
      2,                    // 固定2个Worker
      apiKeyWorker0        // 🔑 专属API Key
    );
    this.actualWorkerCount++;
    logger.info('✅ Worker 0 created: SOL → USDT → SOL');
    
    // Worker 1: SOL → USDC → SOL (使用专属Key)
    await this.startWorker(
      1,
      [solMint],           // 只传SOL
      [usdcBridge],        // 只传USDC
      onOpportunity,
      2,                    // 固定2个Worker
      apiKeyWorker1        // 🔑 专属API Key
    );
    this.actualWorkerCount++;
    logger.info('✅ Worker 1 created: SOL → USDC → SOL');
    
    logger.info(`✅ Created ${this.actualWorkerCount} dedicated workers`);
    
    // 定期输出统计（与原逻辑相同）
    const statsInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(statsInterval);
        return;
      }
      
      logger.info(
        `Stats: ${this.stats.queriesTotal} queries, ` +
        `${this.stats.opportunitiesFound} opportunities, ` +
        `avg ${this.stats.avgQueryTimeMs.toFixed(1)}ms per query`
      );
    }, 60000);
  }

  /**
   * 启动单个Worker
   */
  private async startWorker(
    workerId: number,
    mints: PublicKey[],
    bridges: BridgeToken[],
    onOpportunity: (opp: ArbitrageOpportunity) => void,
    totalWorkers: number,  // 🔥 新增：实际创建的Workers总数
    customApiKey?: string  // 🔑 新增：Worker专属API Key（可选）
  ): Promise<void> {
    // 尝试加载编译后的 .js 文件，如果不存在则使用 .ts
    let workerPath = path.join(__dirname, 'workers', 'query-worker.js');
    const fs = await import('fs');
    
    if (!fs.existsSync(workerPath)) {
      // 开发模式：使用 tsx 加载 TypeScript
      workerPath = path.join(__dirname, 'workers', 'query-worker.ts');
      
      // 使用 tsx 作为 loader
      const { Worker: TsxWorker } = await import('worker_threads');
      const worker = new TsxWorker(workerPath, {
        execArgv: ['--require', 'tsx/cjs'],
        workerData: {
          workerId,
          totalWorkers,  // 🔥 传递实际Workers总数
          config: {
            jupiterApiUrl: this.config.jupiterApiUrl,  // Ultra API URL
            apiKey: customApiKey || this.config.apiKey,  // 🔑 使用专属Key或默认Key
            mints: mints.map(m => m.toBase58()),
            bridges: bridges,  // 传递分配的桥接代币
            amount: this.config.amount,
            minProfitLamports: this.config.minProfitLamports,
            queryIntervalMs: this.config.queryIntervalMs,
            slippageBps: this.config.slippageBps,
          },
        },
      });
      
      this.setupWorkerListeners(worker, workerId, mints, bridges, onOpportunity);
      this.workers.push(worker);
      return;
    }

    const worker = new Worker(workerPath, {
      workerData: {
        workerId,
        totalWorkers,  // 🔥 传递实际Workers总数
        config: {
          jupiterApiUrl: this.config.jupiterApiUrl,  // Ultra API URL
          apiKey: customApiKey || this.config.apiKey,  // 🔑 使用专属Key或默认Key
          mints: mints.map(m => m.toBase58()),
          bridges: bridges,  // 传递分配的桥接代币
          amount: this.config.amount,
          minProfitLamports: this.config.minProfitLamports,
          queryIntervalMs: this.config.queryIntervalMs,
          slippageBps: this.config.slippageBps,
        },
      },
    });
    
    this.setupWorkerListeners(worker, workerId, mints, bridges, onOpportunity);
    this.workers.push(worker);
  }

  /**
   * 设置Worker事件监听器
   */
  private setupWorkerListeners(
    worker: Worker,
    workerId: number,
    mints: PublicKey[],
    bridges: BridgeToken[],
    onOpportunity: (opp: ArbitrageOpportunity) => void
  ): void {

    worker.on('message', async (message: WorkerMessage) => {
      switch (message.type) {
        case 'opportunity':
          await this.handleOpportunity(message.data, onOpportunity);
          break;
        case 'error':
          logger.error(`Worker ${workerId} error: ${message.data}`);
          break;
        case 'stats':
          this.updateStats(message.data);
          break;
      }
    });

    worker.on('error', (error) => {
      logger.error(`Worker ${workerId} error:`, error);
      // 重启worker
      setTimeout(() => {
        if (this.isRunning) {
          this.startWorker(workerId, mints, bridges, onOpportunity, this.actualWorkerCount);
        }
      }, 5000);
    });

    worker.on('exit', (code) => {
      if (code !== 0 && this.isRunning) {
        logger.warn(`Worker ${workerId} exited with code ${code}, restarting...`);
        setTimeout(() => {
          this.startWorker(workerId, mints, bridges, onOpportunity, this.actualWorkerCount);
        }, 5000);
      }
    });

    logger.info(`Worker ${workerId} started with ${mints.length} mints`);
  }

  /**
   * 处理发现的机会
   */
  private async handleOpportunity(
    data: any,
    onOpportunity: (opp: ArbitrageOpportunity) => void
  ): Promise<void> {
    try {
      const opportunity: ArbitrageOpportunity = {
        inputMint: new PublicKey(data.inputMint),
        outputMint: new PublicKey(data.outputMint),
        bridgeToken: data.bridgeToken,
        bridgeMint: data.bridgeMint ? new PublicKey(data.bridgeMint) : undefined,
        bridgeAmount: data.bridgeAmount,
        outRoute: data.outRoute,
        backRoute: data.backRoute,
        inputAmount: data.inputAmount,
        outputAmount: data.outputAmount,
        profit: data.profit,
        roi: data.roi,
        route: data.route,
        timestamp: data.discoveredAt || Date.now(),  // 使用Worker的发现时间
        latency: data.latency,  // 传递延迟数据
        // 🔥 新增：传递Worker的缓存quote和发现时间
        outboundQuote: data.outboundQuote,  // Worker的完整去程报价
        returnQuote: data.returnQuote,      // Worker的完整回程报价
        discoveredAt: data.discoveredAt,    // Worker发现机会的精确时间
      };

      this.stats.opportunitiesFound++;

      // 发送通知（如果启用）
      if (this.monitoring) {
        this.monitoring.alertOpportunityFound({
          inputMint: data.inputMint,
          profit: data.profit,
          roi: data.roi,
          bridgeToken: data.bridgeToken,
          bridgeMint: data.bridgeMint,
          inputAmount: data.inputAmount,
          outputAmount: data.outputAmount,
        }).catch((err: any) => {
          logger.error('Failed to send opportunity alert:', err);
        });
      }

      // 记录到数据库（如果启用）
      // 数据库功能暂时禁用
      /*
      if (this.databaseEnabled) {
        try {
          await databaseRecorder.recordOpportunity({
            inputMint: data.inputMint,
            outputMint: data.outputMint,
            bridgeToken: data.bridgeToken,
            bridgeMint: data.bridgeMint,
            inputAmount: BigInt(data.inputAmount),
            outputAmount: BigInt(data.outputAmount),
            bridgeAmount: data.bridgeAmount ? BigInt(data.bridgeAmount) : undefined,
            expectedProfit: BigInt(data.profit),
            expectedRoi: data.roi,
            executed: false,
            filtered: false,
            metadata: {
              route: data.route,
              discoveredBy: 'jupiter-worker',
              timestamp: opportunity.timestamp,
            },
          });
          logger.debug(`Opportunity recorded to database: ${data.profit / 1e9} SOL`);
        } catch (error) {
          logger.error('Failed to record opportunity to database:', error);
          // 不抛出错误，避免影响正常流程
        }
      }
      */

      // 增强的日志输出，显示桥接代币信息
      if (opportunity.bridgeToken) {
        logger.info(
          `🎯 Opportunity found: ${opportunity.inputMint.toBase58().slice(0, 4)}... → ${opportunity.bridgeToken} → ${opportunity.inputMint.toBase58().slice(0, 4)}... ` +
          `| Profit: ${(opportunity.profit / 1e9).toFixed(6)} SOL (${opportunity.roi.toFixed(2)}% ROI)`
        );
      } else {
        logger.info(
          `🎯 Opportunity found: ${opportunity.inputMint.toBase58().slice(0, 8)}... ` +
          `profit ${opportunity.profit} lamports (${opportunity.roi.toFixed(2)}% ROI)`
        );
      }

      onOpportunity(opportunity);
    } catch (error) {
      logger.error('Failed to handle opportunity:', error);
    }
  }

  /**
   * 更新统计信息
   */
  private updateStats(data: any): void {
    this.stats.queriesTotal += data.queriesTotal || 0;
    
    // 🔥 修复：直接使用worker上报的真实平均值，不使用EWMA（避免累积误差）
    if (data.avgQueryTimeMs) {
      this.stats.avgQueryTimeMs = data.avgQueryTimeMs;
    }
  }

  /**
   * 停止机会发现器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping Opportunity Finder...');
    this.isRunning = false;

    // 终止所有worker
    await Promise.all(
      this.workers.map(worker => 
        worker.terminate().catch(err => 
          logger.error('Error terminating worker:', err)
        )
      )
    );

    this.workers = [];
    logger.info('Opportunity Finder stopped');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }
}
