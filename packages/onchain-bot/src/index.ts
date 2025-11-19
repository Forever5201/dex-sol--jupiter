/**
 * On-Chain Bot 主程序
 * 
 * 直接链上扫描套利机器人
 * 通过批量获取池子数据，实时计算价差，发现并执行套利机会
 */

// 加载环境变量（必须在最开始）
import dotenv from 'dotenv';
dotenv.config();

import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  ConnectionPool,
  KeypairManager,
  TransactionBuilder,
  ConfigLoader,
  createEconomicsSystem,
  createLogger,
  PriorityFeeEstimator
} from '@solana-arb-bot/core';
import type { CostConfig, RiskCheckConfig, ArbitrageOpportunity } from '@solana-arb-bot/core';
import { MarketScanner, Market } from './market-scanner';
import { ArbitrageEngine } from './arbitrage-engine';
import { SpamExecutor } from './executors/spam-executor';
import { JitoExecutor } from './executors/jito-executor';
import { SimulationExecutor } from './executors/simulation-executor';
import TOML from 'toml';
import fs from 'fs';

// 导出执行器以供其他包使用
export { JitoExecutor } from './executors/jito-executor';
export { SpamExecutor } from './executors/spam-executor';

const logger = createLogger('OnChainBot');

/**
 * Bot 配置接口
 */
interface BotConfig {
  bot: {
    name: string;
    network: string;
    dry_run: boolean;
  };
  rpc: {
    urls: string[];
    commitment: string;
    min_time: number;
    max_concurrent: number;
  };
  markets: {
    config_file: string;
    scan_interval_ms: number;
  };
  arbitrage: {
    min_spread_percent: number;
    min_liquidity: number;
    trade_amount: number;
    max_slippage: number;
  };
  execution: {
    mode: 'spam' | 'jito' | 'simulation';
    skip_preflight: boolean;
    max_retries: number;
    jito_block_engine_url?: string;
    check_jito_leader?: boolean;
    min_tip_lamports?: number;
    max_tip_lamports?: number;
    confirmation_timeout_ms?: number;
  };
  economics: {
    capital_size: 'small' | 'medium' | 'large';
    signature_count: number;
    compute_units: number;
    compute_unit_price: number;
    min_profit_lamports: number;
    min_roi: number;
    max_priority_fee: number;
    max_jito_tip: number;
    max_slippage: number;
    min_liquidity_usd: number;
    max_consecutive_failures: number;
    max_hourly_loss_lamports: number;
    min_success_rate: number;
    cooldown_period: number;
  };
  keypair: {
    path: string;
    min_balance_sol: number;
  };
  monitoring: {
    enabled: boolean;
    metrics_interval: number;
  };
  // ✅ 新增：闪电贷配置
  flashloan?: {
    enabled: boolean;
    protocol: 'solend' | 'mango' | 'marginfi';
    max_borrow_amount: number;
    min_net_profit: number;
    fee_rate: number;
    auto_calculate_amount: boolean;
  };
  // ✅ 新增：Jupiter 配置
  jupiter?: {
    enabled: boolean;
    api_url: string;
    slippage_bps: number;
    only_direct_routes: boolean;
    max_routes: number;
  };
}

/**
 * On-Chain Bot 类
 */
class OnChainBot {
  private config: BotConfig;
  private connectionPool!: ConnectionPool;
  private keypair!: Keypair;
  private scanner!: MarketScanner;
  private arbitrageEngine!: ArbitrageEngine;
  private spamExecutor?: SpamExecutor;
  private jitoExecutor?: JitoExecutor;
  private simulationExecutor?: SimulationExecutor;
  private economics!: ReturnType<typeof createEconomicsSystem>;
  private priorityFeeEstimator!: PriorityFeeEstimator;
  private executionMode: 'spam' | 'jito' | 'simulation';

  private isRunning: boolean = false;
  private scanCount: number = 0;
  private opportunityCount: number = 0;
  private executionCount: number = 0;

  constructor(configPath: string) {
    logger.info(`Initializing On-Chain Bot with config: ${configPath}`);
    
    // 加载全局配置
    ConfigLoader.loadGlobalConfig();
    
    // 加载模块配置
    this.config = ConfigLoader.loadModuleConfig<BotConfig>(configPath);
    
    // 设置执行模式
    this.executionMode = this.config.execution.mode || 'spam';
    
    logger.info(`Bot name: ${this.config.bot.name}`);
    logger.info(`Network: ${this.config.bot.network}`);
    logger.info(`Execution mode: ${this.executionMode.toUpperCase()}`);
    logger.info(`Dry run: ${this.config.bot.dry_run}`);
  }

  /**
   * 初始化所有组件
   */
  async initialize(): Promise<void> {
    logger.info('Initializing components...');

    try {
      // 1. 创建RPC连接池
      logger.info(`Initializing RPC pool with ${this.config.rpc.urls.length} endpoints...`);
      this.connectionPool = new ConnectionPool({
        endpoints: this.config.rpc.urls,
        commitment: this.config.rpc.commitment as any,
        minTime: this.config.rpc.min_time,
        maxConcurrent: this.config.rpc.max_concurrent,
      });

      // 2. 加载密钥对（智能检测：优先使用环境变量，否则使用配置文件路径）
      // 优先级：SOLANA_PRIVATE_KEY > SOLANA_KEYPAIR_PATH > config.keypair.path
      if (process.env.SOLANA_PRIVATE_KEY) {
        logger.info('🔑 Using keypair from environment variable: SOLANA_PRIVATE_KEY');
        this.keypair = KeypairManager.load();
      } else if (process.env.SOLANA_KEYPAIR_PATH) {
        logger.info(`🔑 Using keypair from environment variable: SOLANA_KEYPAIR_PATH=${process.env.SOLANA_KEYPAIR_PATH}`);
        this.keypair = KeypairManager.load();
      } else {
      logger.info(`Loading keypair from ${this.config.keypair.path}...`);
      this.keypair = KeypairManager.loadFromFile(this.config.keypair.path);
      }
      
      // 检查余额
      const balance = await KeypairManager.getBalance(
        this.connectionPool.getBestConnection(),
        this.keypair
      );
      logger.info(`Wallet: ${this.keypair.publicKey.toBase58()}`);
      logger.info(`Balance: ${balance.toFixed(6)} SOL`);
      
      if (balance < this.config.keypair.min_balance_sol) {
        logger.warn(`Balance is low! Minimum recommended: ${this.config.keypair.min_balance_sol} SOL`);
      }

      // 3. 加载市场配置
      logger.info(`Loading markets from ${this.config.markets.config_file}...`);
      const marketsContent = fs.readFileSync(this.config.markets.config_file, 'utf-8');
      const marketsConfig = TOML.parse(marketsContent);
      const markets: Market[] = marketsConfig.markets || [];
      logger.info(`Loaded ${markets.length} markets`);

      // 4. 创建市场扫描器
      this.scanner = new MarketScanner(this.connectionPool, {
        markets,
        scanIntervalMs: this.config.markets.scan_interval_ms,
      });

      // 5. 创建套利引擎
      this.arbitrageEngine = new ArbitrageEngine({
        minSpreadPercent: this.config.arbitrage.min_spread_percent,
        minLiquidity: this.config.arbitrage.min_liquidity,
        tradeAmount: this.config.arbitrage.trade_amount,
      });

      // 6. 创建经济模型系统（必须在执行器之前）
      logger.info('Initializing economics system...');
      this.economics = createEconomicsSystem({
        circuitBreaker: {
          maxConsecutiveFailures: this.config.economics.max_consecutive_failures,
          maxHourlyLoss: this.config.economics.max_hourly_loss_lamports,
          minSuccessRate: this.config.economics.min_success_rate,
          cooldownPeriod: this.config.economics.cooldown_period,
          autoRecovery: true,
        },
      });

      // 7. 初始化优先费估算器
      logger.info('Initializing Priority Fee Estimator...');
      this.priorityFeeEstimator = new PriorityFeeEstimator(
        this.connectionPool.getBestConnection(),
        1_000_000 // 默认100万计算单元，稍后会根据协议调整
      );
      logger.info('✅ Priority Fee Estimator initialized');

      // 8. 创建执行器（根据模式）
      if (this.executionMode === 'jito') {
        logger.info('Initializing Jito executor...');

        if (!this.config.execution.jito_block_engine_url) {
          throw new Error('Jito mode requires jito_block_engine_url in config');
        }

        this.jitoExecutor = new JitoExecutor(
          this.connectionPool.getBestConnection(),
          this.keypair,
          this.economics.jitoTipOptimizer,
          {
            blockEngineUrl: this.config.execution.jito_block_engine_url,
            authKeypair: this.keypair,
            maxRetries: this.config.execution.max_retries,
            checkJitoLeader: this.config.execution.check_jito_leader,
            minTipLamports: this.config.execution.min_tip_lamports,
            maxTipLamports: this.config.execution.max_tip_lamports,
            confirmationTimeout: this.config.execution.confirmation_timeout_ms,
          }
        );

        logger.info('✅ Jito executor initialized');
      } else if (this.executionMode === 'simulation') {
        logger.info('Initializing Simulation executor...');

        this.simulationExecutor = new SimulationExecutor(
          this.connectionPool.getBestConnection(),
          {
            enabled: true,
            logComputeUnits: true,
            logProfit: true,
            verifySignatures: false,
          }
        );

        logger.info('✅ Simulation executor initialized');
      } else {
        logger.info('Initializing Spam executor...');

        this.spamExecutor = new SpamExecutor(this.connectionPool, {
          skipPreflight: this.config.execution.skip_preflight,
          maxRetries: this.config.execution.max_retries,
        });

        logger.info('✅ Spam executor initialized');
      }

      // 8. 初始化Jupiter客户端
      if (this.config.jupiter?.enabled) {
        logger.info('Initializing Jupiter Swap client...');
        TransactionBuilder.initializeJupiter(
          this.connectionPool.getBestConnection(),
          this.config.jupiter.api_url
        );
        logger.info(`✅ Jupiter enabled (API: ${this.config.jupiter.api_url})`);
      } else {
        logger.info('✅ Using direct DEX swaps (Jupiter disabled)');
      }
      
      // 9. 显示闪电贷状态
      if (this.config.flashloan?.enabled) {
        logger.info(`⚡ FlashLoan enabled (Protocol: ${this.config.flashloan.protocol}, Max: ${this.config.flashloan.max_borrow_amount / 1e9} SOL)`);
      } else {
        logger.info('💰 FlashLoan disabled (using own capital)');
      }

      logger.info('✅ All components initialized successfully');
    } catch (error) {
      logger.error(`Initialization failed: ${error}`);
      throw error;
    }
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    logger.info('🚀 Starting On-Chain Bot...');
    this.isRunning = true;

    // 启动监控（如果启用）
    if (this.config.monitoring.enabled) {
      this.startMonitoring();
    }

    // 主循环
    await this.mainLoop();
  }

  /**
   * 主循环
   */
  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // 检查熔断器
        if (!this.economics.circuitBreaker.canAttempt()) {
          const remaining = this.economics.circuitBreaker.getRemainingCooldown();
          logger.warn(`Circuit breaker is open, waiting ${Math.ceil(remaining / 1000)}s...`);
          await this.sleep(remaining);
          continue;
        }

        // 执行扫描周期
        await this.scanCycle();

        // 等待下一个周期
        await this.sleep(this.config.markets.scan_interval_ms);
      } catch (error) {
        logger.error(`Error in main loop: ${error}`);
        await this.sleep(1000);
      }
    }
  }

  /**
   * 单次扫描周期
   */
  private async scanCycle(): Promise<void> {
    this.scanCount++;
    const cycleStart = Date.now();

    // 1. 扫描市场
    const prices = await this.scanner.scanMarkets();
    
    if (prices.length === 0) {
      logger.warn('No price data available');
      return;
    }

    // 2. 发现套利机会
    const opportunities = this.arbitrageEngine.findArbitrageOpportunities(
      prices,
      this.scanner['markets'] // 访问私有属性（TypeScript会警告但能运行）
    );

    if (opportunities.length === 0) {
      logger.debug('No arbitrage opportunities found');
      return;
    }

    this.opportunityCount += opportunities.length;
    logger.info(`📊 Found ${opportunities.length} arbitrage opportunities`);

    // 3. 评估并执行机会
    for (const opportunity of opportunities) {
      await this.evaluateAndExecute(opportunity);
      
      // 如果熔断器触发，退出循环
      if (!this.economics.circuitBreaker.canAttempt()) {
        break;
      }
    }

    const cycleLatency = Date.now() - cycleStart;
    logger.debug(`Scan cycle completed in ${cycleLatency}ms`);
  }

  /**
   * 评估并执行套利机会
   * @param opportunity 套利机会
   */
  private async evaluateAndExecute(opportunity: ArbitrageOpportunity): Promise<void> {
    try {
      // 1. 验证机会
      const validation = this.economics.riskManager.validateOpportunity(opportunity);
      if (!validation.valid) {
        logger.debug(`Opportunity invalid: ${validation.reason}`);
        return;
      }

      // 2. 构建成本配置
      const costConfig: CostConfig = {
        signatureCount: this.config.economics.signature_count,
        computeUnits: this.config.economics.compute_units,
        computeUnitPrice: this.config.economics.compute_unit_price,
        // ✅ 从配置读取闪电贷设置
        useFlashLoan: this.config.flashloan?.enabled || false,
        flashLoanAmount: this.config.flashloan?.enabled ? this.config.flashloan.max_borrow_amount : undefined,
      };

      // 3. 计算Jito小费（如果使用Jito模式）
      let jitoTip = 0;
      if (this.executionMode === 'jito') {
        // 评估竞争强度
        const competition = this.jitoExecutor?.assessCompetition(
          opportunity.poolLiquidity || 0,
          opportunity.grossProfit
        ) || 0.5;

        // 计算最优小费
        jitoTip = await this.economics.jitoTipOptimizer.calculateOptimalTip(
          opportunity.grossProfit,
          competition,
          0.7, // 默认紧迫性
          this.config.economics.capital_size
        );
      }

      // 更新成本配置以包含优先费
      const priorityFeeBasedCost = {
        ...costConfig,
        computeUnitPrice: priorityFeeEstimate.feePerCU // Use the estimated priority fee
      };

      const costs = this.economics.costCalculator.calculateTotalCost(priorityFeeBasedCost, jitoTip);

      // 4. 利润分析
      const analysis = this.economics.profitAnalyzer.analyzeProfitability(
        opportunity,
        priorityFeeBasedCost,
        jitoTip
      );

      logger.info(
        `💰 ${opportunity.tokenPair}: Gross=${(analysis.grossProfit / 1e9).toFixed(6)} SOL, ` +
        `Net=${(analysis.netProfit / 1e9).toFixed(6)} SOL, ROI=${analysis.roi.toFixed(1)}%` +
        (this.executionMode === 'jito' ? `, Tip=${(jitoTip / 1e9).toFixed(6)} SOL` : '')
      );

      // 5. 风险检查
      const riskConfig: RiskCheckConfig = {
        minProfitThreshold: this.config.economics.min_profit_lamports,
        maxGasPrice: this.config.economics.max_priority_fee,
        maxJitoTip: this.config.economics.max_jito_tip,
        maxSlippage: this.config.economics.max_slippage,
        minLiquidity: this.config.economics.min_liquidity_usd,
        minROI: this.config.economics.min_roi,
      };

      const riskCheck = this.economics.riskManager.preExecutionCheck(
        opportunity,
        analysis,
        riskConfig
      );

      if (!riskCheck.passed) {
        logger.debug(`Risk check failed: ${riskCheck.reason}`);
        return;
      }

      logger.info(`✅ Opportunity passed all checks: ${opportunity.tokenPair}`);

      // 6. 执行交易（或干运行）
      if (this.config.bot.dry_run) {
        logger.info('🧪 DRY RUN - Transaction not sent');
        // 模拟成功
        this.economics.circuitBreaker.recordTransaction({
          success: true,
          profit: analysis.netProfit,
          timestamp: Date.now(),
        });
        this.executionCount++;
      } else {
        await this.executeArbitrage(opportunity, analysis.netProfit, jitoTip);
      }
    } catch (error) {
      logger.error(`Failed to evaluate opportunity: ${error}`);
    }
  }

  /**
   * 执行套利交易
   * @param opportunity 套利机会
   * @param expectedProfit 预期利润
   * @param jitoTip Jito小费（如果使用Jito模式）
   */
  private async executeArbitrage(
    opportunity: ArbitrageOpportunity,
    expectedProfit: number,
    jitoTip: number = 0
  ): Promise<void> {
    try {
      logger.info(`🚀 Executing arbitrage: ${opportunity.tokenPair}`);

      // 从scanner中获取市场信息以确定池子类型
      const market1 = this.scanner.findMarket(opportunity.inputMint, opportunity.outputMint);
      const market2 = this.scanner.findMarket(opportunity.outputMint, opportunity.inputMint);

      // 如果找不到市场，尝试通过机会中的路由信息获取
      if (!market1 || !market2) {
        logger.warn(`Could not find market info for token pair: ${opportunity.tokenPair}`);
        return;
      }

      // 获取价格数据以构建交易
      const priceData1 = this.scanner.getPrice(market1.poolAddress);
      const priceData2 = this.scanner.getPrice(market2.poolAddress);

      if (!priceData1 || !priceData2) {
        logger.warn(`Missing price data for markets: ${market1.poolAddress}, ${market2.poolAddress}`);
        return;
      }

      // 使用Builder Factory来选择适当的交易构建器
      const { BuilderFactory } = await import('./builders/builder-factory');
      const builder1 = BuilderFactory.getBuilder(priceData1);
      const builder2 = BuilderFactory.getBuilder(priceData2);

      if (!builder1 || !builder2) {
        logger.warn(`Could not find appropriate builders for markets: ${priceData1?.dex} -> ${priceData2?.dex}`);
        return;
      }

      // 使用优先费估算器获取当前优先费
      logger.info('Estimating priority fee...');
      const priorityFeeEstimate = await this.priorityFeeEstimator.estimateOptimalFee(
        opportunity.grossProfit,
        'high' // 对于套利交易使用高优先级
      );

      logger.info(
        `Priority fee estimate: ${priorityFeeEstimate.feePerCU} micro-lamports/CU, ` +
        `Total: ${priorityFeeEstimate.totalFee} lamports`
      );

      // 计算最小输出金额（考虑滑点）
      const minOutput1 = opportunity.inputAmount * (1 - this.config.arbitrage.max_slippage);
      const minOutput2 = opportunity.expectedOutput * (1 - this.config.arbitrage.max_slippage);

      // 构建两个Swap交易
      const { default: BN } = await import('bn.js');
      const inputAmount = new BN(opportunity.inputAmount);
      const minOutputAmount1 = new BN(minOutput1);
      const minOutputAmount2 = new BN(minOutput2);

      // 构建第一笔交易
      logger.info('Building first swap transaction...');
      const swap1Tx = await builder1.buildSwap(
        priceData1,
        inputAmount,
        minOutputAmount1,
        this.keypair.publicKey,
        priorityFeeEstimate.feePerCU // Pass the priority fee
      );

      // 设置计算单元限制和价格
      const { ComputeBudgetProgram } = await import('@solana/web3.js');
      const computeUnitLimitIx1 = ComputeBudgetProgram.setComputeUnitLimit({
        units: builder1.getComputeUnitLimit(priceData1),
      });

      const computeUnitPriceIx1 = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeeEstimate.feePerCU,
      });

      logger.info('Building second swap transaction...');
      const swap2Tx = await builder2.buildSwap(
        priceData2,
        new BN(opportunity.expectedOutput),
        new BN(opportunity.inputAmount), // Minimum expected to return to original amount
        this.keypair.publicKey,
        priorityFeeEstimate.feePerCU // Pass the priority fee
      );

      // 设置计算单元限制和价格
      const computeUnitLimitIx2 = ComputeBudgetProgram.setComputeUnitLimit({
        units: builder2.getComputeUnitLimit(priceData2),
      });

      const computeUnitPriceIx2 = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeeEstimate.feePerCU,
      });

      // 将指令转换为版本化交易
      const { TransactionBuilder } = await import('@solana-arb-bot/core');
      const connection = this.connectionPool.getBestConnection();

      // 构建第一笔版本化交易（包含优先费指令）
      const swap1VersionedTx = await TransactionBuilder.createVersionedTransaction(
        connection,
        [computeUnitLimitIx1, computeUnitPriceIx1, swap1Tx],
        this.keypair.publicKey
      );

      // 构建第二笔版本化交易（包含优先费指令）
      const swap2VersionedTx = await TransactionBuilder.createVersionedTransaction(
        connection,
        [computeUnitLimitIx2, computeUnitPriceIx2, swap2Tx],
        this.keypair.publicKey
      );

      logger.info('✅ Transactions built successfully');

      // 2. 执行交易（根据模式）
      let result;

      if (this.executionMode === 'simulation' && this.simulationExecutor) {
        logger.info('🧪 Simulating arbitrage execution...');

        // 执行模拟
        const simulationResults = await this.simulationExecutor.simulateBundle(
          [swap1VersionedTx, swap2VersionedTx],
          this.keypair.publicKey
        );

        // 检查模拟结果
        const allSuccessful = simulationResults.every(r => r.success);
        if (allSuccessful) {
          logger.info(`✅ Simulation Success (Profit: ${(expectedProfit / 1e9).toFixed(6)} SOL, CU: ${simulationResults[0]?.computeUnits || 0})`);

          // 如果有第二笔交易的计算单元数据，也打印出来
          if (simulationResults[1]?.computeUnits) {
            logger.info(`✅ Simulation Success (Profit: ${(expectedProfit / 1e9).toFixed(6)} SOL, CU: ${simulationResults[1]?.computeUnits || 0})`);
          }

          result = {
            success: true,
            signature: 'simulated_success'
          };
        } else {
          logger.error('❌ Simulation Failed');
          simulationResults.forEach((r, i) => {
            if (!r.success) {
              logger.error(`❌ Simulation failed for transaction ${i + 1}: ${r.error}`);
            }
          });

          result = {
            success: false,
            error: simulationResults.map(r => r.error).filter(Boolean).join('; ')
          };
        }
      } else if (this.executionMode === 'jito' && this.jitoExecutor) {
        logger.info(`🚀 Executing via Jito (Tip: ${(jitoTip / 1e9).toFixed(6)} SOL)`);

        // 评估竞争强度
        const competition = this.jitoExecutor.assessCompetition(
          opportunity.poolLiquidity || 0,
          opportunity.grossProfit
        );

        // 执行第一笔交易
        result = await this.jitoExecutor.executeVersionedTransaction(
          swap1VersionedTx,
          expectedProfit,
          competition,
          0.8 // 高紧迫性
        );

        if (!result.success) {
          logger.error(`❌ Swap 1 failed: ${result.error}`);
          throw new Error(`Swap 1 failed: ${result.error}`);
        }

        logger.info(`✅ Swap 1 landed! Signature: ${result.signature}`);

        // 等待确认（简单等待，生产环境应该监听确认）
        await this.sleep(2000);

        // 执行第二笔交易
        result = await this.jitoExecutor.executeVersionedTransaction(
          swap2VersionedTx,
          expectedProfit,
          competition,
          0.9 // 更高紧迫性
        );

      } else if (this.spamExecutor) {
        logger.info('🚀 Executing via RPC Spam');

        // Spam模式：执行第一笔
        result = await this.spamExecutor.executeVersionedTransaction(
          swap1VersionedTx,
          expectedProfit
        );

        if (!result.success) {
          logger.error(`❌ Swap 1 failed: ${result.error}`);
          throw new Error(`Swap 1 failed: ${result.error}`);
        }

        logger.info(`✅ Swap 1 confirmed! Signature: ${result.signature}`);

        // 等待确认
        await this.sleep(2000);

        // 执行第二笔
        result = await this.spamExecutor.executeVersionedTransaction(
          swap2VersionedTx,
          expectedProfit
        );
      } else {
        throw new Error('No executor available');
      }

      // 3. 记录结果
      this.economics.circuitBreaker.recordTransaction(result);
      this.executionCount++;

      if (result.success) {
        logger.info(`✅ Arbitrage executed successfully! Signature: ${result.signature}`);
      } else {
        logger.error(`❌ Arbitrage execution failed: ${result.error}`);
      }
    } catch (error) {
      logger.error(`Execution error: ${error}`);

      // 记录失败
      this.economics.circuitBreaker.recordTransaction({
        success: false,
        cost: 50_000,
        timestamp: Date.now(),
        error: String(error),
      });
    }
  }

  /**
   * 停止机器人
   */
  stop(): void {
    logger.info('🛑 Stopping On-Chain Bot...');
    this.isRunning = false;
    this.connectionPool.destroy();
    logger.info('Bot stopped');
  }

  /**
   * 启动监控
   */
  private startMonitoring(): void {
    const interval = this.config.monitoring.metrics_interval * 1000;

    setInterval(() => {
      this.printMetrics();
    }, interval);

    logger.info(`Monitoring started (interval: ${interval}ms)`);
  }

  /**
   * 打印指标
   */
  private printMetrics(): void {
    const metrics = this.economics.circuitBreaker.getMetrics();
    const health = this.economics.circuitBreaker.getHealthScore();
    const cacheStats = this.scanner.getCacheStats();
    
    // 获取执行器统计
    let executorStats: any = {};
    if (this.executionMode === 'jito' && this.jitoExecutor) {
      executorStats = this.jitoExecutor.getStats();
    } else if (this.spamExecutor) {
      executorStats = this.spamExecutor.getStats();
    }

    logger.info('');
    logger.info('========== 性能指标 ==========');
    logger.info(`扫描次数: ${this.scanCount}`);
    logger.info(`发现机会: ${this.opportunityCount}`);
    logger.info(`执行次数: ${this.executionCount}`);
    logger.info('');
    logger.info(`成功率: ${(metrics.successRate * 100).toFixed(1)}%`);
    logger.info(`连续失败: ${metrics.consecutiveFailures}`);
    logger.info(`净利润: ${(metrics.netProfit / 1e9).toFixed(6)} SOL`);
    logger.info(`健康分数: ${health}/100`);
    logger.info('');
    
    // 显示执行器统计
    if (this.executionMode === 'jito') {
      logger.info(`执行模式: JITO`);
      logger.info(`Bundle成功率: ${executorStats.successRate?.toFixed(1)}%`);
      logger.info(`总小费支出: ${(executorStats.totalTipSpent / 1e9)?.toFixed(6)} SOL`);
      logger.info(`平均小费: ${(executorStats.averageTipPerBundle / 1e9)?.toFixed(6)} SOL`);
    } else {
      logger.info(`执行模式: RPC SPAM`);
      logger.info(`健康RPC: ${executorStats.healthyRPCs}/${executorStats.totalRPCs}`);
    }
    
    logger.info(`缓存命中: ${(cacheStats.cacheRate * 100).toFixed(1)}%`);
    logger.info('=============================');
    logger.info('');
  }

  /**
   * Sleep 辅助函数
   * @param ms 毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 主函数
 */
async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  let configPath = 'packages/onchain-bot/config.example.toml';
  let simulateMode = false;

  // 方式1：直接传配置文件路径（第一个参数）
  if (args.length > 0 && !args[0].startsWith('-')) {
    configPath = args[0];
  }

  // 方式2：使用 --config 或 -c 参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' || args[i] === '-c') {
      configPath = args[i + 1];
      i++;
    } else if (args[i] === '--simulate' || args[i] === '-s') {
      simulateMode = true;
    }
  }

  logger.info('🎯 ========== On-Chain Arbitrage Bot ==========');
  logger.info(`Version: 1.0.0 MVP`);
  logger.info(`Config: ${configPath}`);
  logger.info(`Simulate Mode: ${simulateMode}`);
  logger.info('');

  try {
    // 创建并初始化Bot
    const bot = new OnChainBot(configPath);

    // 如果使用模拟模式，覆盖配置中的执行模式
    if (simulateMode) {
      (bot as any).executionMode = 'simulation';
      logger.info('🔧 Execution mode set to SIMULATION via CLI flag');
    }

    await bot.initialize();

    // 处理退出信号
    process.on('SIGINT', () => {
      logger.info('');
      logger.info('Received SIGINT, shutting down gracefully...');
      bot.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      bot.stop();
      process.exit(0);
    });

    // 启动Bot
    await bot.start();
  } catch (error) {
    logger.fatal(`Fatal error: ${error}`);
    process.exit(1);
  }
}

// 执行主函数
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export default OnChainBot;


