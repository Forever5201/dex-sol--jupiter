/**
 * Jupiter Bot主程序
 * 
 * 基于自托管Jupiter API的套利机器人
 * 设计文档：策略A - 聚合器驱动
 */

import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { OpportunityFinder, ArbitrageOpportunity } from './opportunity-finder';
import { SpamExecutor, SpamConfig } from './executors/spam-executor';
import { JitoExecutor } from '@solana-arb-bot/onchain-bot';
import { JupiterServerManager } from '@solana-arb-bot/jupiter-server';
import { createLogger, JitoTipOptimizer, KeypairManager } from '@solana-arb-bot/core';
import { readFileSync } from 'fs';
import axios from 'axios';

const logger = createLogger('JupiterBot');

/**
 * Jupiter Bot配置
 */
export interface JupiterBotConfig {
  /** Jupiter API URL（如果不使用自托管服务器） */
  jupiterApiUrl?: string;
  /** 是否启动自托管 Jupiter Server */
  startJupiterServer?: boolean;
  /** Jupiter Server 配置（如果 startJupiterServer = true） */
  jupiterServer?: {
    rpcUrl: string;
    port?: number;
    enableCircularArbitrage?: boolean;
  };
  /** 代币列表文件路径 */
  mintsFile: string;
  /** 交易金额（SOL） */
  tradeAmountSol: number;
  /** 最小利润（SOL） */
  minProfitSol: number;
  /** Worker数量 */
  workerCount?: number;
  /** 执行模式 */
  executionMode: 'jito' | 'spam';
  /** Jito配置（如果使用Jito） */
  jito?: {
    blockEngineUrl: string;
    authKeypairPath: string;
    tipLamports: number;
  };
  /** Spam配置（如果使用Spam） */
  spam?: SpamConfig;
  /** 钱包密钥路径 */
  keypairPath: string;
  /** 滑点容差（基点） */
  slippageBps?: number;
}

/**
 * Jupiter Bot主类
 */
export class JupiterBot {
  private config: JupiterBotConfig;
  private connection: Connection;
  private finder: OpportunityFinder;
  private executor: JitoExecutor | SpamExecutor;
  private keypair: Keypair;
  private jupiterServerManager?: JupiterServerManager;
  private isRunning = false;

  private stats = {
    opportunitiesFound: 0,
    tradesAttempted: 0,
    tradesSuccessful: 0,
    tradesFailed: 0,
    totalProfitSol: 0,
    totalLossSol: 0,
    uptime: 0,
  };

  constructor(config: JupiterBotConfig) {
    this.config = config;
    
    // 初始化 RPC 连接
    this.connection = new Connection(
      config.jupiterServer?.rpcUrl || 'https://api.mainnet-beta.solana.com',
      'processed'
    );
    
    // 加载钱包（智能检测：优先使用环境变量，否则使用配置文件路径）
    // 优先级：SOLANA_PRIVATE_KEY > SOLANA_KEYPAIR_PATH > config.keypairPath
    if (process.env.SOLANA_PRIVATE_KEY) {
      logger.info('🔑 Using keypair from environment variable: SOLANA_PRIVATE_KEY');
      this.keypair = KeypairManager.load();
    } else if (process.env.SOLANA_KEYPAIR_PATH) {
      logger.info(`🔑 Using keypair from environment variable: SOLANA_KEYPAIR_PATH=${process.env.SOLANA_KEYPAIR_PATH}`);
      this.keypair = KeypairManager.load();
    } else {
      logger.info(`🔑 Using keypair from config file: ${config.keypairPath}`);
      this.keypair = KeypairManager.load({ filePath: config.keypairPath });
    }
    logger.info(`Wallet loaded: ${this.keypair.publicKey.toBase58()}`);

    // 加载代币列表
    const mints = this.loadMints(config.mintsFile);
    logger.info(`Loaded ${mints.length} mints`);

    // 确定 Jupiter API URL
    const jupiterApiUrl = this.getJupiterApiUrl();

    // 初始化机会发现器
    this.finder = new OpportunityFinder({
      jupiterApiUrl,
      mints,
      amount: config.tradeAmountSol * 1e9, // SOL to lamports
      minProfitLamports: config.minProfitSol * 1e9,
      workerCount: config.workerCount,
      slippageBps: config.slippageBps,
    });

    // 初始化执行器
    this.executor = this.initializeExecutor();

    logger.info(`Jupiter Bot initialized in ${config.executionMode} mode`);
  }

  /**
   * 获取 Jupiter API URL
   */
  private getJupiterApiUrl(): string {
    if (this.config.startJupiterServer) {
      const port = this.config.jupiterServer?.port || 8080;
      return `http://127.0.0.1:${port}`;
    } else if (this.config.jupiterApiUrl) {
      return this.config.jupiterApiUrl;
    } else {
      throw new Error('Either startJupiterServer or jupiterApiUrl must be configured');
    }
  }


  /**
   * 加载代币列表
   */
  private loadMints(path: string): PublicKey[] {
    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      return lines.map(line => new PublicKey(line));
    } catch (error) {
      logger.error(`Failed to load mints from ${path}:`, error);
      throw error;
    }
  }

  /**
   * 初始化执行器
   */
  private initializeExecutor(): JitoExecutor | SpamExecutor {
    if (this.config.executionMode === 'jito') {
      if (!this.config.jito) {
        throw new Error('Jito config required for jito mode');
      }

      // 创建 Jito Tip Optimizer
      const jitoTipOptimizer = new JitoTipOptimizer({
        minTipLamports: 1000,
        maxTipLamports: 100_000_000,
        profitSharePercentage: 0.3,
        competitionMultiplier: 2.0,
        urgencyMultiplier: 1.5,
        useHistoricalLearning: true,
        historicalWeight: 0.4,
      });

      // 修复：使用正确的4参数构造函数
      return new JitoExecutor(
        this.connection,
        this.keypair,
        jitoTipOptimizer,
        {
          blockEngineUrl: this.config.jito.blockEngineUrl,
          authKeypair: this.keypair,
          minTipLamports: this.config.jito.tipLamports,
          maxTipLamports: 100_000_000,
          checkJitoLeader: true,
          confirmationTimeout: 30000,
        }
      );
    } else {
      if (!this.config.spam) {
        throw new Error('Spam config required for spam mode');
      }

      return new SpamExecutor(this.config.spam);
    }
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot already running');
      return;
    }

    logger.info('🚀 Starting Jupiter Bot...');
    this.isRunning = true;

    // 如果需要，启动 Jupiter Server
    if (this.config.startJupiterServer) {
      logger.info('Starting Jupiter Server...');
      
      if (!this.config.jupiterServer?.rpcUrl) {
        throw new Error('jupiterServer.rpcUrl is required when startJupiterServer = true');
      }

      this.jupiterServerManager = new JupiterServerManager({
        rpcUrl: this.config.jupiterServer.rpcUrl,
        port: this.config.jupiterServer.port || 8080,
        enableCircularArbitrage: this.config.jupiterServer.enableCircularArbitrage !== false,
      });

      await this.jupiterServerManager.start();
      logger.info('✅ Jupiter Server started');

      // 等待服务稳定
      await this.sleep(2000);
    }

    // 健康检查
    await this.healthCheck();

    // 启动机会发现器
    await this.finder.start(async (opportunity) => {
      await this.handleOpportunity(opportunity);
    });

    // 定期输出统计
    const statsInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(statsInterval);
        return;
      }

      this.printStats();
    }, 60000); // 每分钟

    logger.info('✅ Jupiter Bot started successfully');
  }

  /**
   * 处理发现的机会
   */
  private async handleOpportunity(opportunity: ArbitrageOpportunity): Promise<void> {
    this.stats.opportunitiesFound++;

    logger.info(
      `Processing opportunity: ${opportunity.profit / 1e9} SOL profit ` +
      `(${opportunity.roi.toFixed(2)}% ROI)`
    );

    try {
      // 获取swap交易
      const transaction = await this.getSwapTransaction(opportunity);

      if (!transaction) {
        logger.warn('Failed to get swap transaction');
        return;
      }

      // 签名交易
      transaction.sign([this.keypair]);

      // 执行交易
      this.stats.tradesAttempted++;
      const result = await this.executeTransaction(transaction);

      if (result.success) {
        this.stats.tradesSuccessful++;
        this.stats.totalProfitSol += opportunity.profit / 1e9;
        
        logger.info(
          `✅ Trade successful! ` +
          `Signature: ${result.signature}, ` +
          `Profit: ${opportunity.profit / 1e9} SOL`
        );
      } else {
        this.stats.tradesFailed++;
        logger.warn(`❌ Trade failed: ${result.errors.join(', ')}`);
      }

    } catch (error: any) {
      this.stats.tradesFailed++;
      logger.error(`Error handling opportunity: ${error.message}`);
    }
  }

  /**
   * 获取swap交易
   */
  private async getSwapTransaction(
    opportunity: ArbitrageOpportunity
  ): Promise<VersionedTransaction | null> {
    try {
      // 先获取quote
      const params = new URLSearchParams({
        inputMint: opportunity.inputMint.toBase58(),
        outputMint: opportunity.outputMint.toBase58(),
        amount: opportunity.inputAmount.toString(),
        slippageBps: (this.config.slippageBps || 50).toString(),
      });

      const quoteResponse = await axios.get(
        `${this.config.jupiterApiUrl}/quote?${params}`,
        { timeout: 5000 }
      );

      // 获取swap交易
      const swapResponse = await axios.post(
        `${this.config.jupiterApiUrl}/swap`,
        {
          quoteResponse: quoteResponse.data,
          userPublicKey: this.keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: false, // ⚡ 闪电贷已处理SOL/wSOL转换，无需Jupiter重复处理（节省40-120字节）
        },
        { timeout: 10000 }
      );

      // 反序列化交易
      const swapTransactionBuf = Buffer.from(
        swapResponse.data.swapTransaction,
        'base64'
      );

      return VersionedTransaction.deserialize(swapTransactionBuf);
    } catch (error: any) {
      logger.error(`Failed to get swap transaction: ${error.message}`);
      return null;
    }
  }

  /**
   * 执行交易
   */
  private async executeTransaction(
    transaction: VersionedTransaction
  ): Promise<any> {
    if (this.config.executionMode === 'jito') {
      // Jito模式需要将VersionedTransaction转换
      return await (this.executor as JitoExecutor).executeVersionedTransaction(
        transaction,
        this.config.minProfitSol
      );
    } else {
      return await (this.executor as SpamExecutor).execute(transaction);
    }
  }

  /**
   * 健康检查
   */
  private async healthCheck(): Promise<void> {
    logger.info('Performing health check...');

    try {
      // 检查Jupiter API
      const jupiterApiUrl = this.getJupiterApiUrl();
      const response = await axios.get(`${jupiterApiUrl}/health`, {
        timeout: 5000,
      });
      logger.info(`✅ Jupiter API healthy: ${response.status}`);
    } catch (error) {
      logger.warn('⚠️  Jupiter API health check failed');
    }

    // 检查执行器
    if (this.executor instanceof SpamExecutor) {
      const rpcHealth = await this.executor.healthCheck();
      const healthyCount = rpcHealth.filter(r => r.healthy).length;
      logger.info(`✅ RPC health: ${healthyCount}/${rpcHealth.length} healthy`);
    }
  }

  /**
   * 休眠辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 输出统计信息
   */
  private printStats(): void {
    const successRate = this.stats.tradesAttempted > 0
      ? (this.stats.tradesSuccessful / this.stats.tradesAttempted * 100).toFixed(1)
      : '0.0';

    const netProfit = this.stats.totalProfitSol - this.stats.totalLossSol;

    logger.info('═══════════════════════════════════════');
    logger.info('📊 Jupiter Bot Statistics');
    logger.info('═══════════════════════════════════════');
    logger.info(`Opportunities Found: ${this.stats.opportunitiesFound}`);
    logger.info(`Trades Attempted: ${this.stats.tradesAttempted}`);
    logger.info(`Trades Successful: ${this.stats.tradesSuccessful}`);
    logger.info(`Trades Failed: ${this.stats.tradesFailed}`);
    logger.info(`Success Rate: ${successRate}%`);
    logger.info(`Total Profit: ${this.stats.totalProfitSol.toFixed(4)} SOL`);
    logger.info(`Net Profit: ${netProfit.toFixed(4)} SOL`);
    logger.info('═══════════════════════════════════════');
  }

  /**
   * 停止机器人
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping Jupiter Bot...');
    this.isRunning = false;

    await this.finder.stop();

    // 如果启动了 Jupiter Server，停止它
    if (this.jupiterServerManager) {
      logger.info('Stopping Jupiter Server...');
      await this.jupiterServerManager.stop();
      logger.info('✅ Jupiter Server stopped');
    }

    this.printStats();
    logger.info('✅ Jupiter Bot stopped');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }
}

// 导出类型
export * from './opportunity-finder';
export * from './executors/spam-executor';
