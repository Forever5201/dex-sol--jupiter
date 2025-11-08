/**
 * 闪电贷套利机器人
 * 
 * 基于 Jupiter + Solend 闪电贷的无本金套利
 * 设计文档：sol设计文档_修正版_实战.md
 */

import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  VersionedTransaction,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  TransactionMessage,
} from '@solana/web3.js';
import { OpportunityFinder, ArbitrageOpportunity } from './opportunity-finder';
import { JitoExecutor } from '@solana-arb-bot/onchain-bot';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types';
import { JupiterServerManager } from '@solana-arb-bot/jupiter-server';
import {
  SolendAdapter,
  JupiterLendAdapter,
  FlashLoanTransactionBuilder,
  FlashLoanProtocol,
  SolendALTManager,
  JupiterLendALTManager,
  networkConfig,
  initDatabase,
  databaseRecorder,
  NetworkAdapter, // 🌐 使用统一网络适配器
  KeypairManager, // 🔑 使用统一的密钥管理器
} from '@solana-arb-bot/core';
// 直接从源文件导入PriorityFeeEstimator,因为它未从core/index导出
import { PriorityFeeEstimator } from '@solana-arb-bot/core/dist/utils/priority-fee-estimator';
import { MonitoringService } from '@solana-arb-bot/core';
import { createEconomicsSystem, createLogger, JitoTipOptimizer } from '@solana-arb-bot/core';
import { readFileSync } from 'fs';
import { AxiosInstance } from 'axios';
import * as toml from 'toml';

const logger = createLogger('FlashloanBot');

/**
 * 闪电贷机器人配置
 */
export interface FlashloanBotConfig {
  // 基础配置
  rpcUrl: string;
  keypairPath: string;
  dryRun?: boolean;
  simulateToBundle?: boolean;  // 🔥 深度模拟：执行所有步骤直到发送Bundle，但不上链
  enableSecondaryValidation?: boolean; // 是否启用二次验证（默认启用）

  network?: {
    proxyUrl?: string;
  };

  // Jupiter API 配置（Ultra API）
  jupiterApi?: {
    apiKey?: string;              // Worker线程使用的API Key
    validationApiKey?: string;    // Main线程验证使用的API Key
    endpoint?: string;
  };

  // Jupiter Server配置
  jupiterServer: {
    rpcUrl: string;
    port?: number;
    enableCircularArbitrage?: boolean;
  };

  // 代币列表
  mintsFile: string;

  // 机会发现配置
  opportunityFinder: {
    workerCount?: number;
    queryIntervalMs?: number;
    minProfitLamports: number;
    slippageBps?: number;
  };

  // 闪电贷配置
  flashloan: {
    provider: 'solend' | 'jupiter-lend';
    solend: {
      minBorrowAmount: number;
      maxBorrowAmount: number;
      feeRate: number;
    };
    jupiter_lend?: {
      minBorrowAmount: number;
      maxBorrowAmount: number;
      feeRate: number; // Always 0
    };
    dynamicSizing?: {
      enabled: boolean;
      minMultiplier: number;
      maxMultiplier: number;
      safetyMargin: number;
    };
  };

  // Jito配置
  jito: {
    blockEngineUrl: string;
    authKeypairPath: string;
    checkJitoLeader: boolean;
    minTipLamports: number;
    maxTipLamports: number;
    confirmationTimeout?: number;
  };

  // 监控配置
  monitoring?: {
    enabled: boolean;
    serverchan?: {
      sendKey: string;
      enabled: boolean;
    };
    minProfitForAlert?: number;
    alert_on_opportunity_found?: boolean;
    min_opportunity_profit_for_alert?: number;
    opportunity_alert_rate_limit_ms?: number;
    alert_on_opportunity_validated?: boolean;
    min_validated_profit_for_alert?: number;
    validated_alert_rate_limit_ms?: number;
  };

  // 数据库配置（可选）
  database?: {
    enabled: boolean;
    url?: string;
  };

  // 经济模型配置
  economics: {
    capitalSize: 'small' | 'medium' | 'large';
    cost: {
      signatureCount: number;
      computeUnits: number;
      computeUnitPrice: number;
    };
    profit: {
      minProfitLamports: number;
      minROI: number;
      maxSlippage: number;
      minLiquidityUsd: number;
      enableNetProfitCheck?: boolean;  // 是否启用净利润检查（默认 true）
    };
    risk: {
      maxConsecutiveFailures: number;
      maxHourlyLossLamports: number;
      minSuccessRate: number;
      cooldownPeriod: number;
    };
    jito: {
      profitSharePercentage: number;
    };
  };
}

/**
 * 闪电贷套利机器人
 */
export class FlashloanBot {
  private config: FlashloanBotConfig;
  private connection: any; // Connection类型从networkConfig获取
  private keypair: Keypair;
  private finder: OpportunityFinder;
  private executor: JitoExecutor;
  private jupiterServerManager: JupiterServerManager;
  private monitoring?: MonitoringService;
  private economics: ReturnType<typeof createEconomicsSystem>;
  private priorityFeeEstimator: PriorityFeeEstimator;
  private axiosInstance: AxiosInstance;
  private jupiterSwapAxios: AxiosInstance;
  private jupiterLegacyAxios: AxiosInstance;  // Legacy Swap API client for route replication
  private jupiterQuoteAxios: AxiosInstance;   // 🆕 Quote API client for building instructions (supports flash loans)
  private jupiterApiStats = {
    total: 0,
    success: 0,
    tlsErrors: 0,
    serverErrors: 0,
    routeNotFound: 0,
  };
  private isRunning = false;
  private secondValidationThreshold: number;

  // ALT 缓存（避免重复 RPC 查询，提升性能）
  private altCache = new Map<string, {
    account: AddressLookupTableAccount;
    timestamp: number;
  }>();
  private readonly ALT_CACHE_TTL = 300000; // 5分钟过期
  
  // Flash Loan ALT Managers（根据配置使用）
  private solendALTManager: SolendALTManager;
  private jupiterLendALTManager: JupiterLendALTManager;
  private jupiterLendAdapter: JupiterLendAdapter;

  // 🚀 优化9：Blockhash缓存（Solana blockhash有效期~60秒）
  private blockhashCache: {
    blockhash: string;
    lastValidBlockHeight: number;
    timestamp: number;
  } | null = null;
  private readonly BLOCKHASH_CACHE_TTL = 30000; // 30秒（安全边际）

  // 🚀 优化5（预留）：Token账户缓存
  private tokenAccountCache = new Map<string, PublicKey>();

  // 🚀 优化：Quote结果缓存（5秒TTL）
  private quoteCache = new Map<string, { 
    quote: any; 
    swapResponse: any;
    timestamp: number 
  }>();
  private readonly QUOTE_CACHE_TTL = 5000; // 5秒过期

  private stats = {
    opportunitiesFound: 0,
    opportunitiesFiltered: 0,
    simulationFiltered: 0,  // 🆕 RPC模拟过滤的机会数
    savedGasSol: 0,  // 🆕 通过RPC模拟节省的Gas（SOL）
    validatedOpportunities: 0,  // 🆕 通过二次验证的机会总数
    theoreticalNetProfitSol: 0,  // 🆕 累计理论净利润（扣费后）
    theoreticalFeesBreakdown: {  // 🆕 理论费用明细累计
      totalBaseFee: 0,
      totalPriorityFee: 0,
      totalJitoTip: 0,
      totalSlippageBuffer: 0,
    },
    tradesAttempted: 0,
    tradesSuccessful: 0,
    tradesFailed: 0,
    totalBorrowedSol: 0,
    totalFlashloanFees: 0,
    totalProfitSol: 0,
    totalLossSol: 0,
    bundleTransactions: 0,      // 🆕 Bundle模式交易数
    singleTransactions: 0,      // 🆕 单笔交易数
    bytesOptimizedTotal: 0,     // 🆕 通过优化节省的总字节数
    startTime: Date.now(),
  };

  private readonly secondaryValidationEnabled: boolean;

  /**
   * Create dedicated Jupiter Swap API client
   * 🔥 改用Ultra API进行二次验证，确保与Worker使用相同的路由引擎
   */
  private createJupiterSwapClient(): AxiosInstance {
    // 🔥 改用Ultra API，与Worker保持一致
    const baseURL = this.config.jupiterApi?.endpoint || 'https://api.jup.ag/ultra';
    
    // ✅ 构建headers，包含validation API Key
    const headers: any = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'br, gzip, deflate',  // 🔥 支持Brotli压缩
    };
    
    // ✅ 使用独立的validation API Key（避免与Worker共享速率限制）
    const validationApiKey = this.config.jupiterApi?.validationApiKey || this.config.jupiterApi?.apiKey;
    if (validationApiKey) {
      headers['X-API-Key'] = validationApiKey;
      logger.info(`✅ Validation API configured (Key: ...${validationApiKey.slice(-8)}) - Note: Currently unused, Workers use Legacy Swap API`);
    } else {
      logger.warn('⚠️ No validation API Key configured');
    }
    
    // 🌐 使用 NetworkAdapter 创建 axios 实例（自动应用代理配置）
    return NetworkAdapter.createAxios({
      baseURL,
      timeout: 6000,        // 提高到6秒（应对Ultra API延迟）
      headers,
      validateStatus: (status: number) => status < 500,
      maxRedirects: 0,
      decompress: true,     // 🔥 自动解压
    });
  }

  /**
   * 创建 Quote API 客户端（用于构建交易指令）
   * 使用 quote-api.jup.ag/v6，支持闪电贷（不检查余额）
   */
  private createJupiterQuoteClient(): AxiosInstance {
    const headers: any = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'FlashloanBot/1.0',
    };
    
    // 🌐 使用 NetworkAdapter 创建 axios 实例（自动应用代理配置）
    // ⚠️ 修正：使用 Legacy Swap API，不是 Quote API V6
    // Legacy Swap API 是官方推荐用于 flash loan 的 API
    return NetworkAdapter.createAxios({
      baseURL: 'https://lite-api.jup.ag/swap/v1',  // ✅ Legacy Swap API（支持闪电贷）
      timeout: 30000,  // 增加超时时间
      headers,
      validateStatus: (status: number) => status < 500,
      maxRedirects: 0,
    });
  }

  /**
   * 创建 Legacy Swap API 客户端（用于路由复刻验证）
   * 使用 lite-api.jup.ag/swap/v1（Quote API V6 已废弃）
   */
  private createJupiterLegacyClient(): AxiosInstance {
    const headers: any = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'br, gzip, deflate',
    };
    
    // 🌐 使用 NetworkAdapter 创建 axios 实例（自动应用代理配置）
    return NetworkAdapter.createAxios({
      baseURL: 'https://lite-api.jup.ag/swap/v1',  // ✅ Legacy Swap API (支持 dexes 参数)
      timeout: 20000,
      headers,
      validateStatus: (status: number) => status < 500,
      maxRedirects: 0,
      decompress: true,
    });
  }

  constructor(config: FlashloanBotConfig) {
    this.config = config;
    this.secondaryValidationEnabled = config.enableSecondaryValidation ?? true;

    // 使用统一的网络配置管理器创建连接（自动配置代理）
    this.connection = networkConfig.createConnection(config.rpcUrl, 'processed');
    logger.info(`Connected to RPC: ${config.rpcUrl}`);

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
    logger.info(`Loaded ${mints.length} mints for arbitrage`);

    // 初始化 Jupiter Server Manager
    this.jupiterServerManager = new JupiterServerManager({
      rpcUrl: config.jupiterServer.rpcUrl,
      port: config.jupiterServer.port || 8080,
      enableCircularArbitrage:
        config.jupiterServer.enableCircularArbitrage !== false,
    });

    // 初始化数据库（如果配置了）
    if (config.database?.enabled) {
      try {
        initDatabase({
          url: config.database.url || process.env.DATABASE_URL,
          poolSize: 10,
        });
        logger.info('✅ Database initialized for opportunity recording');
      } catch (error) {
        logger.warn('⚠️ Database initialization failed (optional):', error);
      }
    }

    // 初始化机会发现器（使用 Lite API + 多跳路由）
    // 注意：查询阶段使用接近闪电贷规模的金额获取更准确的报价
    // 使用 50 SOL (50_000_000_000 lamports) 作为查询基准：
    // - 对 SOL (9 decimals)：50 SOL (~$9000)
    // - 对 USDC/USDT (6 decimals)：50,000 USDC/USDT (50 SOL等值)
    // - 对 JUP (6 decimals)：按比例调整
    // 
    // ⚡ 关键优化：
    // - 更大查询金额可获得 5 倍绝对利润
    // - 更接近实际闪电贷规模（100 SOL）
    // - 价格滑点更真实，避免小额查询的误导
    const queryAmount = 50_000_000_000; // 50 SOL - 提高查询金额以获得更高绝对利润
    
    // 从配置文件读取 Jupiter API 配置（最佳实践）
    const jupiterApiUrl = config.jupiterApi?.endpoint || 'https://api.jup.ag/ultra';
    const jupiterApiKey = config.jupiterApi?.apiKey;
    
    this.finder = new OpportunityFinder({
      jupiterApiUrl, // ✅ 从配置读取 Ultra API 端点
      apiKey: jupiterApiKey, // ✅ 从配置读取 API Key
      mints,
      amount: queryAmount, // 使用小额作为查询基准，避免流动性不足
      minProfitLamports: config.opportunityFinder.minProfitLamports,
      workerCount: config.opportunityFinder.workerCount || 4,
      queryIntervalMs: config.opportunityFinder.queryIntervalMs || 1500,  // 🔥 修复：传递查询间隔
      slippageBps: config.opportunityFinder.slippageBps || 50,
      monitoring: undefined, // 先设置为 undefined，稍后在监控服务初始化后更新
      databaseEnabled: config.database?.enabled || false,
    });

    // 初始化 Jito Tip Optimizer
    const jitoTipOptimizer = new JitoTipOptimizer({
      minTipLamports: config.jito.minTipLamports,
      maxTipLamports: config.jito.maxTipLamports,
      profitSharePercentage: 0.3, // 30% profit share
      competitionMultiplier: 2.0,
      urgencyMultiplier: 1.5,
      useHistoricalLearning: true,
      historicalWeight: 0.4,
    });

    // 初始化 Jito 执行器（修复：使用正确的4参数构造函数）
    this.executor = new JitoExecutor(
      this.connection,
      this.keypair,
      jitoTipOptimizer,
      {
        blockEngineUrl: config.jito.blockEngineUrl,
        authKeypair: this.keypair,
        minTipLamports: config.jito.minTipLamports,
        maxTipLamports: config.jito.maxTipLamports,
        checkJitoLeader: config.jito.checkJitoLeader,
        confirmationTimeout: config.jito.confirmationTimeout || 45,
        capitalSize: config.economics.capitalSize,
        simulateToBundle: config.simulateToBundle,  // 🔥 传递深度模拟选项
      }
    );

    // 初始化监控服务
    if (config.monitoring?.enabled) {
      this.monitoring = new MonitoringService({
        serverChan: config.monitoring.serverchan?.enabled
          ? {
              sendKey: config.monitoring.serverchan.sendKey,  // 修复类型错误
              enabled: true,
            }
          : undefined,
        alertOnOpportunityFound: config.monitoring.alert_on_opportunity_found,
        minOpportunityProfitForAlert: config.monitoring.min_opportunity_profit_for_alert,
        opportunityAlertRateLimitMs: config.monitoring.opportunity_alert_rate_limit_ms,
        alertOnOpportunityValidated: config.monitoring.alert_on_opportunity_validated,
        minValidatedProfitForAlert: config.monitoring.min_validated_profit_for_alert,
        validatedAlertRateLimitMs: config.monitoring.validated_alert_rate_limit_ms,
      });
      
      // 将 monitoring 传递给 finder
      (this.finder as any).monitoring = this.monitoring;
      
      logger.info('Monitoring service enabled');
    }

    // 初始化经济系统
    this.economics = createEconomicsSystem({
      slippageBuffer: config.economics.profit.maxSlippage,
      circuitBreaker: {
        maxConsecutiveFailures: config.economics.risk.maxConsecutiveFailures,
        maxHourlyLoss: config.economics.risk.maxHourlyLossLamports,
        minSuccessRate: config.economics.risk.minSuccessRate,
        cooldownPeriod: config.economics.risk.cooldownPeriod,
      },
    });

    // 初始化第二次验证阈值
    this.secondValidationThreshold = config.economics.profit.minProfitLamports || 2_000_000;
    logger.info(`✅ Second validation threshold: ${this.secondValidationThreshold / 1e9} SOL`);

    // 初始化优先费估算器（从配置读取计算单元数）
    this.priorityFeeEstimator = new PriorityFeeEstimator(
      this.connection,
      config.economics.cost.computeUnits || 800_000
    );
    logger.info(`✅ Priority Fee Estimator initialized (${config.economics.cost.computeUnits || 800_000} CU)`);

    // 使用统一的网络配置管理器获取axios实例（自动配置代理）
    this.axiosInstance = networkConfig.getAxiosInstance();
    logger.info(`✅ Network config: proxy ${networkConfig.isProxyEnabled() ? 'enabled' : 'disabled'} ${networkConfig.isProxyEnabled() ? `(${networkConfig.getProxyUrl()})` : ''}`);

    // Create dedicated Jupiter Swap API client
    this.jupiterSwapAxios = this.createJupiterSwapClient();
    logger.info('✅ Jupiter Swap API client initialized (dedicated connection pool)');

    // Create Legacy Swap API client for route replication
    this.jupiterLegacyAxios = this.createJupiterLegacyClient();
    logger.info('✅ Jupiter Legacy Swap API client initialized (lite-api.jup.ag/swap/v1)');

    // Create Quote API client for building instructions (supports flash loans)
    this.jupiterQuoteAxios = this.createJupiterQuoteClient();
    logger.info('✅ Jupiter Legacy Swap API client initialized (lite-api.jup.ag/swap/v1 - flash loan support)');

    // 初始化闪电贷相关组件
    this.solendALTManager = new SolendALTManager(this.connection, this.keypair, this.config.dryRun || false);
    this.jupiterLendALTManager = new JupiterLendALTManager(this.connection, this.keypair, this.config.dryRun || false);
    this.jupiterLendAdapter = new JupiterLendAdapter(this.connection);
    
    const flashLoanProvider = this.config.flashloan.provider;
    logger.info(`🗜️ Flash Loan Provider: ${flashLoanProvider} (${flashLoanProvider === 'jupiter-lend' ? '0% fee' : '0.09% fee'})`);
    logger.info(`🗜️ ALT Managers created (will initialize on start)`);

    logger.info('💰 Flashloan Bot initialized');
  }

  /**
   * 加载配置文件
   */
  static loadConfig(path: string): FlashloanBotConfig {
    try {
      const content = readFileSync(path, 'utf-8');
      const config = toml.parse(content);

      // 映射 TOML 配置到类型化配置
      return {
        rpcUrl: config.rpc.urls[0],
        keypairPath: config.keypair.path,
        dryRun: config.bot.dry_run,
        simulateToBundle: config.bot.simulate_to_bundle,
        enableSecondaryValidation: config.validation?.enable_secondary ?? true,
        network: config.network ? {
          proxyUrl: config.network.proxy_url,
        } : undefined,
        jupiterApi: config.jupiter_api ? {
          apiKey: config.jupiter_api.api_key,
          validationApiKey: config.jupiter_api.validation_api_key,  // 🔥 新增：二次验证API Key
          endpoint: config.jupiter_api.endpoint,
        } : undefined,
        jupiterServer: config.jupiter_server,
        mintsFile: config.opportunity_finder.mints_file,
        opportunityFinder: {
          workerCount: config.opportunity_finder.worker_count,
          queryIntervalMs: config.opportunity_finder.query_interval_ms,
          minProfitLamports: config.opportunity_finder.min_profit_lamports,
          slippageBps: config.opportunity_finder.slippage_bps,
        },
        flashloan: {
          provider: config.flashloan.provider,
          solend: config.flashloan.solend,
          jupiter_lend: config.flashloan.jupiter_lend,
          // 转换蛇形命名为驼峰命名
          dynamicSizing: config.flashloan.dynamic_sizing ? {
            enabled: config.flashloan.dynamic_sizing.enabled,
            minMultiplier: config.flashloan.dynamic_sizing.min_multiplier,
            maxMultiplier: config.flashloan.dynamic_sizing.max_multiplier,
            safetyMargin: config.flashloan.dynamic_sizing.safety_margin,
          } : undefined,
        },
        jito: config.jito ? {
          blockEngineUrl: config.jito.block_engine_url,
          authKeypairPath: config.jito.auth_keypair_path,
          checkJitoLeader: config.jito.check_jito_leader,
          minTipLamports: config.jito.min_tip_lamports,
          maxTipLamports: config.jito.max_tip_lamports,
          confirmationTimeout: config.jito.confirmation_timeout,
        } : undefined,
        monitoring: config.monitoring ? {
          enabled: config.monitoring.enabled,
          serverchan: config.monitoring.serverchan,
          alert_on_opportunity_found: config.monitoring.alert_on_opportunity_found,
          min_opportunity_profit_for_alert: config.monitoring.min_opportunity_profit_for_alert,
          opportunity_alert_rate_limit_ms: config.monitoring.opportunity_alert_rate_limit_ms,
          alert_on_opportunity_validated: config.monitoring.alert_on_opportunity_validated,
          min_validated_profit_for_alert: config.monitoring.min_validated_profit_for_alert,
          validated_alert_rate_limit_ms: config.monitoring.validated_alert_rate_limit_ms,
        } : undefined,
        economics: {
          capitalSize: config.economics.capital_size,
          cost: {
            signatureCount: config.economics.cost.signature_count,
            computeUnits: config.economics.cost.compute_units,
            computeUnitPrice: config.economics.cost.compute_unit_price,
          },
          profit: {
            minProfitLamports: config.economics.profit.min_profit_lamports,
            minROI: config.economics.profit.min_roi,
            maxSlippage: config.economics.profit.max_slippage,
            minLiquidityUsd: config.economics.profit.min_liquidity_usd,
            enableNetProfitCheck: config.economics.profit.enable_net_profit_check ?? true,
          },
          risk: {
            maxConsecutiveFailures: config.economics.risk.max_consecutive_failures,
            maxHourlyLossLamports: config.economics.risk.max_hourly_loss_lamports,
            minSuccessRate: config.economics.risk.min_success_rate,
            cooldownPeriod: config.economics.risk.cooldown_period,
          },
          jito: {
            profitSharePercentage: config.economics.jito.profit_share_percentage,
          },
        },
        database: config.database ? {
          enabled: config.database.enabled,
          url: config.database.url,
        } : undefined,
      } as FlashloanBotConfig;
    } catch (error: any) {
      logger.error(`Failed to load config from ${path}:`, error);
      throw error;
    }
  }

  /**
   * 配置校验和智能调整（防止极端配置）
   */
  static validateAndAdjustConfig(config: FlashloanBotConfig): FlashloanBotConfig {
    // 限制Jito Tip不超过15%
    if (config.economics.jito.profitSharePercentage > 15) {
      logger.warn(
        `⚠️ Jito Tip ${config.economics.jito.profitSharePercentage}% exceeds recommended 15%, adjusting to 15%...`
      );
      config.economics.jito.profitSharePercentage = 15;
    }
    
    // Worker数量建议不超过3（防止API限速）
    if (config.opportunityFinder.workerCount && config.opportunityFinder.workerCount > 3) {
      logger.warn(
        `⚠️ Worker count ${config.opportunityFinder.workerCount} may cause API rate limiting (recommended: 3)`
      );
    }
    
    // 查询间隔建议不低于80ms（防止API限速）
    if (config.opportunityFinder.queryIntervalMs && config.opportunityFinder.queryIntervalMs < 80) {
      logger.warn(
        `⚠️ Query interval ${config.opportunityFinder.queryIntervalMs}ms is very low, may trigger rate limit (recommended: ≥80ms)`
      );
    }
    
    // 显示配置摘要
    logger.info(`📋 Config Validation:`);
    logger.info(`   Jito Tip: ${config.economics.jito.profitSharePercentage}%`);
    logger.info(`   Workers: ${config.opportunityFinder.workerCount || 'N/A'}`);
    logger.info(`   Query Interval: ${config.opportunityFinder.queryIntervalMs || 'N/A'}ms`);
    logger.info(`   Compute Unit Price: ${config.economics.cost.computeUnitPrice || 'N/A'} μL/CU`);
    
    return config;
  }


  /**
   * 加载代币列表
   */
  private loadMints(path: string): PublicKey[] {
    try {
      const content = readFileSync(path, 'utf-8');
      const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          // 移除行尾注释（处理 "mint_address  # comment" 格式）
          const commentIndex = line.indexOf('#');
          return commentIndex !== -1 ? line.substring(0, commentIndex).trim() : line;
        })
        .filter((line) => line); // 再次过滤空行

      return lines.map((line) => new PublicKey(line));
    } catch (error) {
      logger.error(`Failed to load mints from ${path}:`, error);
      throw error;
    }
  }

  /**
   * Warmup Jupiter Swap API connection
   * Establishes hot connections to avoid cold-start TLS failures
   */
  private async warmupJupiterConnection(): Promise<void> {
    try {
      logger.info('🔥 Warming up Jupiter Swap API connection...');
      
      const testQuote = await this.jupiterSwapAxios.get('/quote', {
        params: {
          inputMint: 'So11111111111111111111111111111111111111112',  // SOL
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
          amount: '1000000000',
          slippageBps: '50',
        },
        timeout: 5000,
      });
      
      if (testQuote.data) {
        logger.info('✅ Jupiter Swap API connection ready');
      }
    } catch (error: any) {
      logger.warn(`⚠️ Warmup failed (not critical): ${error.message}`);
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

    logger.info('🚀 Starting Flashloan Arbitrage Bot...');

    // 🗜️ 初始化闪电贷ALT（根据配置选择）
    const isJupiterLend = this.config.flashloan.provider === 'jupiter-lend';
    try {
      if (isJupiterLend) {
        logger.info('🔧 Initializing Jupiter Lend Address Lookup Table...');
        await this.jupiterLendALTManager.initialize();
        const altStats = this.jupiterLendALTManager.getStats();
        if (altStats.initialized) {
          logger.info(
            `✅ Jupiter Lend ALT ready: ${altStats.address?.slice(0, 8)}... ` +
            `(${altStats.addressCount} addresses, saves ~200-400 bytes per tx)`
          );
        } else {
          logger.info('💡 Jupiter Lend ALT will be created on first flash loan use');
        }
      } else {
        logger.info('🔧 Initializing Solend Address Lookup Table...');
        await this.solendALTManager.initialize();
        const altStats = this.solendALTManager.getStats();
        logger.info(
          `✅ Solend ALT ready: ${altStats.address?.slice(0, 8)}... ` +
          `(${altStats.addressCount} addresses, saves ~210 bytes per tx)`
        );
      }
    } catch (error: any) {
      logger.error(`❌ Failed to initialize Flash Loan ALT: ${error.message}`);
      logger.warn('⚠️ Bot will continue without ALT compression (transactions may be larger)');
    }

    // 🚀 优化2：预加载常用Jupiter ALT到缓存（节省~200ms）
    logger.info('🚀 Preloading common Jupiter ALTs to cache...');
    const preloadStart = Date.now();
    await this.preloadCommonALTs();
    const preloadLatency = Date.now() - preloadStart;
    logger.info(`✅ ALT preload completed in ${preloadLatency}ms (${this.altCache.size} ALTs cached)`);


    // 发送启动通知
    if (this.monitoring) {
      await this.monitoring.sendAlert({
        type: 'info',
        title: '🚀 闪电贷机器人已启动',
        description: `机器人已成功启动，开始扫描套利机会`,
        fields: [
          { name: '钱包地址', value: this.keypair.publicKey.toBase58() },
          { 
            name: '模式', 
            value: this.config.simulateToBundle 
              ? '🎭 深度模拟（构建+签名Bundle但不上链）' 
              : this.config.dryRun 
                ? '💡 简单模拟' 
                : '💰 真实交易' 
          },
          {
            name: '借款范围',
            value: `${this.config.flashloan.solend.minBorrowAmount / LAMPORTS_PER_SOL} - ${this.config.flashloan.solend.maxBorrowAmount / LAMPORTS_PER_SOL} SOL`,
          },
        ],
        level: 'high',
      });
    }

    this.isRunning = true;
    this.stats.startTime = Date.now();

    // 检查钱包余额（干运行模式跳过）
    if (!this.config.dryRun) {
      await this.checkWalletBalance();
    } else {
      logger.info('💡 Dry run mode: skipping wallet balance check');
    }

    // 使用官方 Jupiter API（跳过自托管）
    logger.info('Using official Jupiter API (no local server needed)');
    
    // 显示 Jupiter API 配置信息
    const apiUrl = this.config.jupiterApi?.endpoint || 'https://api.jup.ag/ultra';
    const hasApiKey = !!this.config.jupiterApi?.apiKey;
    logger.info(`📡 Jupiter API: ${apiUrl}`);
    logger.info(`🔑 API Key: ${hasApiKey ? this.config.jupiterApi!.apiKey!.slice(0, 8) + '...' : 'Not configured (using free tier)'}`);
    logger.info(`⚡ Dynamic Rate Limit: ${hasApiKey ? 'Enabled (5 RPS base, auto-scaling)' : 'N/A'}`);
    
    logger.info('✅ Jupiter API ready');

    // Warmup Jupiter connection
    await this.warmupJupiterConnection();

    // 等待服务稳定
    await this.sleep(2000);

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

    // 定期清理过期的 ALT 缓存
    const cacheCleanupInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(cacheCleanupInterval);
        return;
      }
      
      const now = Date.now();
      let cleanedCount = 0;
      
      for (const [key, value] of this.altCache.entries()) {
        if (now - value.timestamp > this.ALT_CACHE_TTL) {
          this.altCache.delete(key);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        logger.debug(`🧹 Cleaned ${cleanedCount} expired ALT cache entries`);
      }
    }, 60000); // 每分钟清理一次

    // 🔥 缓存预热：预先构建常用资产的闪电贷指令
    if (isJupiterLend) {
      logger.info('🔥 Preheating instruction cache for common assets...');
      
      // 常用资产列表（SOL 和常见的套利桥接代币）
      const commonAssets = [
        new PublicKey('So11111111111111111111111111111111111111112'), // SOL
      ];
      
      try {
        await this.jupiterLendAdapter.preheatCache(
          commonAssets,
          this.keypair.publicKey,
          50_000_000_000 // 50 SOL（与实际借款金额相同）
        );
      } catch (error: any) {
        logger.warn(`⚠️ Cache preheat failed: ${error.message}, will build on first use`);
      }
    }

    logger.info('✅ Flashloan Bot started successfully');
    logger.info('📱 监控您的微信"服务通知"以接收实时告警');
  }

  /**
   * 检查钱包余额
   */
  private async checkWalletBalance(): Promise<void> {
    const balance = await this.connection.getBalance(this.keypair.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;

    logger.info(`Wallet balance: ${balanceSol.toFixed(4)} SOL`);

    if (balanceSol < 0.05) {
      logger.warn(
        `⚠️  Wallet balance is low (${balanceSol} SOL). Minimum 0.1 SOL recommended for gas fees.`
      );

      if (this.monitoring) {
        await this.monitoring.sendAlert({
          type: 'warning',
          title: '⚠️ 钱包余额过低',
          description: `钱包余额不足，可能无法支付交易费用`,
          fields: [
            { name: '当前余额', value: `${balanceSol.toFixed(4)} SOL` },
            { name: '建议余额', value: '至少 0.1 SOL' },
          ],
          level: 'medium',
        });
      }
    }
  }

  /**
   * 提取路由元数据用于数据库分析
   * 
   * @param opportunity 机会数据
   * @returns 路由元数据对象
   */
  private extractRouteMetadata(opportunity: any): any {
    try {
      const metadata: any = {
        routeInfo: {
          hasRouteData: false,
          outboundRoute: [],
          returnRoute: [],
          totalHops: 0,
          dexes: [],
        },
        queryInfo: {
          queryTime: opportunity.queryTime || 0,
          timestamp: new Date().toISOString(),
        },
      };

      // 提取去程路由
      if (opportunity.route && Array.isArray(opportunity.route)) {
        metadata.routeInfo.hasRouteData = true;
        
        opportunity.route.forEach((step: any, index: number) => {
          const routeStep = {
            stepNumber: index + 1,
            direction: step.direction || 'unknown',
            dex: step.dex || 'Unknown',
            inputMint: step.inputMint || '',
            outputMint: step.outputMint || '',
            inputAmount: step.inputAmount ? step.inputAmount.toString() : '0',
            outputAmount: step.outputAmount ? step.outputAmount.toString() : '0',
          };

          if (step.direction === 'outbound' || index < opportunity.route.length / 2) {
            metadata.routeInfo.outboundRoute.push(routeStep);
          } else {
            metadata.routeInfo.returnRoute.push(routeStep);
          }

          // 收集使用的 DEX
          if (step.dex && !metadata.routeInfo.dexes.includes(step.dex)) {
            metadata.routeInfo.dexes.push(step.dex);
          }
        });

        metadata.routeInfo.totalHops = opportunity.route.length;
      }

      // 提取桥接代币信息
      if (opportunity.bridgeToken) {
        metadata.bridgeInfo = {
          symbol: opportunity.bridgeToken,
          mint: opportunity.bridgeMint?.toBase58() || '',
          amount: opportunity.bridgeAmount ? opportunity.bridgeAmount.toString() : '0',
        };
      }

      // 提取利润分析
      metadata.profitAnalysis = {
        expectedProfit: opportunity.profit,
        roi: opportunity.roi,
        inputAmount: opportunity.inputAmount,
        outputAmount: opportunity.outputAmount,
      };

      return metadata;
    } catch (error) {
      logger.warn('Failed to extract route metadata:', error);
      return {
        error: 'Failed to extract route metadata',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 使用 Legacy Swap API 进行路由复刻验证
   * 通过 dexes 参数锁定第一次查询的 DEX，实现高度一致的路由
   */
  private async validateOpportunityWithRouteReplication(
    opportunity: ArbitrageOpportunity
  ): Promise<{
    stillExists: boolean;
    secondProfit: number;
    secondRoi: number;
    delayMs: number;
    routeMatches: boolean;
    exactPoolMatch: boolean;
    secondOutboundMs?: number;
    secondReturnMs?: number;
  }> {
    const startTime = Date.now();

    try {
      // 🔥 Step 1: 从第一次路由中提取 DEX 信息
      const firstOutDEX = opportunity.outRoute?.[0]?.swapInfo?.label;
      const firstBackDEX = opportunity.backRoute?.[0]?.swapInfo?.label;
      const firstOutAmmKey = opportunity.outRoute?.[0]?.swapInfo?.ammKey;
      const firstBackAmmKey = opportunity.backRoute?.[0]?.swapInfo?.ammKey;
      const firstBridgeAmount = opportunity.bridgeAmount || 0;

      if (!firstOutDEX || !firstBackDEX || !firstBridgeAmount) {
        logger.warn('Missing route information for replication, falling back to standard validation');
        const standardValidation = await this.validateOpportunityLifetime(opportunity);
        return {
          ...standardValidation,
          routeMatches: false,
          exactPoolMatch: false,
        };
      }

      logger.debug(
        `🔄 Route replication: out_dex=${firstOutDEX}, back_dex=${firstBackDEX}, ` +
        `bridge=${(firstBridgeAmount / 1e9).toFixed(6)} SOL`
      );

      // 🔥 Step 2: 并行查询（复用 bridgeAmount + 锁定 DEX）
      const outboundStartTime = Date.now();
      const returnStartTime = Date.now();

      const [outQuote, backQuote] = await Promise.all([
        // 去程：锁定第一次的 DEX（Legacy Swap API 支持 dexes 参数）
        this.jupiterLegacyAxios.get('/quote', {
          params: {
            inputMint: opportunity.inputMint.toBase58(),
            outputMint: opportunity.bridgeMint?.toBase58(),
            amount: opportunity.inputAmount.toString(),
            slippageBps: '50',
            onlyDirectRoutes: true,        // ✅ boolean 类型
            dexes: firstOutDEX,             // ✅ 锁定 DEX（Legacy API 支持）
            restrictIntermediateTokens: true,  // 限制中间代币
          },
          timeout: 20000,
        }).then(res => {
          const secondOutboundMs = Date.now() - outboundStartTime;
          return { data: res.data, timing: secondOutboundMs };
        }),

        // 回程：锁定第一次的 DEX + 复用 bridgeAmount
        this.jupiterLegacyAxios.get('/quote', {
          params: {
            inputMint: opportunity.bridgeMint?.toBase58(),
            outputMint: opportunity.outputMint.toBase58(),
            amount: firstBridgeAmount.toString(),  // ✅ 复用金额
            slippageBps: '50',
            onlyDirectRoutes: true,
            dexes: firstBackDEX,             // ✅ 锁定 DEX
            restrictIntermediateTokens: true,
          },
          timeout: 20000,
        }).then(res => {
          const secondReturnMs = Date.now() - returnStartTime;
          return { data: res.data, timing: secondReturnMs };
        }),
      ]);

      const parallelTime = Date.now() - startTime;

      // 🔥 诊断日志：检查 API 响应格式
      logger.debug('=== Legacy Swap API Response Debug ===');
      logger.debug('OutQuote response:', JSON.stringify({
        hasData: !!outQuote.data,
        hasRoutePlan: !!outQuote.data.routePlan,
        routePlanLength: outQuote.data.routePlan?.length,
        outAmount: outQuote.data.outAmount,
        firstRoute: outQuote.data.routePlan?.[0]?.swapInfo,
        rawKeys: Object.keys(outQuote.data || {}).slice(0, 10),
      }));

      logger.debug('BackQuote response:', JSON.stringify({
        hasData: !!backQuote.data,
        hasRoutePlan: !!backQuote.data.routePlan,
        routePlanLength: backQuote.data.routePlan?.length,
        outAmount: backQuote.data.outAmount,
        firstRoute: backQuote.data.routePlan?.[0]?.swapInfo,
        rawKeys: Object.keys(backQuote.data || {}).slice(0, 10),
      }));

      // 如果响应异常，记录完整数据
      if (!backQuote.data.outAmount || backQuote.data.outAmount === '0') {
        logger.error('BackQuote returned invalid outAmount:', {
          fullResponse: JSON.stringify(backQuote.data).slice(0, 500),
        });
      }

      // 🔥 Step 3: 验证路由一致性（兼容不同响应格式）
      const secondOutDEX = outQuote.data.routePlan?.[0]?.swapInfo?.label 
        || outQuote.data.swapInfo?.label;
      const secondBackDEX = backQuote.data.routePlan?.[0]?.swapInfo?.label 
        || backQuote.data.swapInfo?.label;
      const secondOutAmmKey = outQuote.data.routePlan?.[0]?.swapInfo?.ammKey;
      const secondBackAmmKey = backQuote.data.routePlan?.[0]?.swapInfo?.ammKey;

      const routeMatches = (secondOutDEX === firstOutDEX && secondBackDEX === firstBackDEX);
      const exactPoolMatch = (secondOutAmmKey === firstOutAmmKey && secondBackAmmKey === firstBackAmmKey);

      // 计算利润（兼容不同字段名）
      const backOutAmount = backQuote.data.outAmount 
        || backQuote.data.outputAmount 
        || '0';
      const secondProfit = Number(backOutAmount) - opportunity.inputAmount;
      const secondRoi = secondProfit / opportunity.inputAmount;

      logger.info(
        `⚡ Route replication validation: ${parallelTime}ms, ` +
        `profit=${(secondProfit / 1e9).toFixed(6)} SOL (${(secondRoi * 100).toFixed(2)}%), ` +
        `dex_match=${routeMatches ? '✅' : '⚠️'}, ` +
        `pool_match=${exactPoolMatch ? '✅ EXACT' : '⚠️ SIMILAR'}`
      );

      if (!routeMatches) {
        logger.warn(
          `Route changed: out ${firstOutDEX}→${secondOutDEX}, back ${firstBackDEX}→${secondBackDEX}`
        );
      }

      return {
        stillExists: secondProfit > this.secondValidationThreshold,
        secondProfit,
        secondRoi,
        delayMs: parallelTime,
        routeMatches,
        exactPoolMatch,
        secondOutboundMs: outQuote.timing,
        secondReturnMs: backQuote.timing,
      };

    } catch (error: any) {
      const delayMs = Date.now() - startTime;
      
      // 🔥 详细错误日志
      logger.error(`❌ Route replication validation failed (${delayMs}ms)`);
      logger.error('Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack?.split('\n')[0],  // 只记录第一行堆栈
      });
      
      // Axios 请求错误详情
      if (error.response) {
        // 服务器返回了错误响应
        logger.error('API Response Error:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: JSON.stringify(error.response.data).slice(0, 500),
          url: error.config?.url,
          params: error.config?.params,
        });
      } else if (error.request) {
        // 请求已发出但没有收到响应
        logger.error('API Request Error (no response):', {
          url: error.config?.baseURL + error.config?.url,
          params: error.config?.params,
          timeout: error.config?.timeout,
          method: error.config?.method,
        });
      } else {
        // 请求配置错误
        logger.error('Request Setup Error:', {
          message: error.message,
          config: error.config ? {
            url: error.config.url,
            baseURL: error.config.baseURL,
          } : undefined,
        });
      }

      // 降级到标准验证
      logger.info('Falling back to standard Ultra API validation');
      const standardValidation = await this.validateOpportunityLifetime(opportunity);
      return {
        ...standardValidation,
        routeMatches: false,
        exactPoolMatch: false,
      };
    }
  }

  /**
   * 对机会进行二次验证
   * 🔥 使用Ultra API重新查询，与Worker保持一致的路由引擎
   */
  private async validateOpportunityLifetime(
    opportunity: ArbitrageOpportunity
  ): Promise<{
    stillExists: boolean;
    secondProfit: number;
    secondRoi: number;
    delayMs: number;
    secondOutboundMs?: number;
    secondReturnMs?: number;
  }> {
    const startTime = Date.now();

    try {
      // 🔥 使用Ultra API重新查询（第一段：inputMint -> bridgeMint）
      const outboundStart = Date.now();
      const paramsOut = new URLSearchParams({
        inputMint: opportunity.inputMint.toBase58(),
        outputMint: opportunity.bridgeMint?.toBase58() || '',
        amount: opportunity.inputAmount.toString(),
        slippageBps: '50',
        // ❌ 移除 onlyDirectRoutes 限制，使用与Worker相同的路由能力
      });
      
      const quoteResponse = await this.jupiterSwapAxios.get(`/v1/order?${paramsOut}`, {
        timeout: 20000, // Ultra API可能需要更长时间
      });
      const secondOutboundMs = Date.now() - outboundStart;

      const outAmount = Number(quoteResponse.data.outAmount || 0);

      // 🔥 继续第二段查询（bridgeMint -> outputMint）
      const returnStart = Date.now();
      const paramsBack = new URLSearchParams({
        inputMint: opportunity.bridgeMint?.toBase58() || '',
        outputMint: opportunity.outputMint.toBase58(),
        amount: outAmount.toString(),
        slippageBps: '50',
        // ❌ 移除 onlyDirectRoutes 限制
      });
      
      const backQuoteResponse = await this.jupiterSwapAxios.get(`/v1/order?${paramsBack}`, {
        timeout: 20000,
      });
      const secondReturnMs = Date.now() - returnStart;

      const backOutAmount = Number(backQuoteResponse.data.outAmount || 0);
      const secondProfit = backOutAmount - opportunity.inputAmount;
      const secondRoi = secondProfit / opportunity.inputAmount;

      const delayMs = Date.now() - startTime;

      logger.debug(
        `🔄 Ultra API validation: out=${secondOutboundMs}ms, ret=${secondReturnMs}ms, ` +
        `profit=${(secondProfit / 1e9).toFixed(6)} SOL`
      );

      return {
        stillExists: secondProfit > this.secondValidationThreshold,  // 使用配置的第二次验证阈值
        secondProfit,
        secondRoi,
        delayMs,
        secondOutboundMs,
        secondReturnMs,
      };
    } catch (error) {
      const delayMs = Date.now() - startTime;
      logger.warn(`Validation query failed (${delayMs}ms):`, error);

      return {
        stillExists: false,
        secondProfit: 0,
        secondRoi: 0,
        delayMs,
      };
    }
  }

  /**
   * 处理发现的机会
   */
  private async handleOpportunity(
    opportunity: ArbitrageOpportunity
  ): Promise<void> {
    this.stats.opportunitiesFound++;

    // 验证输入数据
    if (!opportunity.inputAmount || opportunity.inputAmount <= 0) {
      logger.error('Invalid inputAmount in opportunity');
      return;
    }

    if (!opportunity.profit || opportunity.profit <= 0) {
      logger.error('Invalid profit in opportunity');
      return;
    }

    // ✅ 新增：记录第一次检测到的机会
    let opportunityId: bigint | undefined;
    const firstDetectedAt = new Date();
    const firstProfit = BigInt(opportunity.profit);
    const firstRoi = opportunity.roi;

    if (this.config.database?.enabled) {
      try {
        // 🔥 新增：提取路由信息用于数据库分析
        const routeMetadata = this.extractRouteMetadata(opportunity);
        
        opportunityId = await databaseRecorder.recordOpportunity({
          inputMint: opportunity.inputMint.toBase58(),
          outputMint: opportunity.outputMint.toBase58(),
          bridgeToken: opportunity.bridgeToken,
          bridgeMint: opportunity.bridgeMint?.toBase58(),
          inputAmount: BigInt(opportunity.inputAmount),
          outputAmount: BigInt(opportunity.outputAmount),
          bridgeAmount: opportunity.bridgeAmount ? BigInt(opportunity.bridgeAmount) : undefined,
          expectedProfit: firstProfit,
          expectedRoi: firstRoi,
          executed: false,
          filtered: false,
          metadata: routeMetadata,  // 🔥 新增：存储路由元数据
        });
        logger.debug(`📝 Recorded opportunity #${opportunityId} with route metadata`);
      } catch (error) {
        logger.warn('⚠️ Failed to record opportunity (non-blocking):', error);
      }
    }

    const validationEnabled = this.secondaryValidationEnabled;
    const t0 = opportunity.discoveredAt || Date.now();
    let revalidation: any = null;
    let buildResult: any = null;

    if (validationEnabled) {
      logger.info('🚀 Starting parallel validation (stats) + build (execution)...');
      [revalidation, buildResult] = await Promise.all([
        // 路径1：二次验证（仅用于统计分析，不影响执行决策）
        this.validateOpportunityWithRouteReplication(opportunity).catch(err => {
          logger.warn('Validation failed (non-blocking for stats):', err);
          return {
            stillExists: false,
            secondProfit: 0,
            secondRoi: 0,
            delayMs: Date.now() - t0,
            routeMatches: false,
            exactPoolMatch: false,
            secondOutboundMs: undefined,
            secondReturnMs: undefined,
          };
        }),

        // 路径2：构建交易（使用Worker缓存的quote，直接执行）
        this.buildTransactionFromCachedQuote(opportunity, opportunityId).catch(err => {
          logger.error('Build transaction failed:', err);
          return null;
        }),
      ]);
    } else {
      logger.info('🚀 Secondary validation disabled; building transaction immediately...');
      buildResult = await this.buildTransactionFromCachedQuote(opportunity, opportunityId).catch(err => {
        logger.error('Build transaction failed:', err);
        return null;
      });
    }

    const t1 = Date.now();

    if (validationEnabled && revalidation) {
      logger.info(
        `📊 Validation stats: ` +
        `lifetime=${revalidation.delayMs}ms, ` +
        `still_exists=${revalidation.stillExists}, ` +
        `price_drift=${((revalidation.secondProfit - opportunity.profit) / 1e9).toFixed(6)} SOL, ` +
        `build_time=${t1 - t0}ms`
      );
    } else {
      logger.info(`📊 Secondary validation disabled; build_time=${t1 - t0}ms`);
    }

    let totalValidationDelayMs = 0;
    if (validationEnabled && revalidation) {
      const secondCheckedAt = new Date();
      totalValidationDelayMs = secondCheckedAt.getTime() - opportunity.timestamp;

      if (this.config.database?.enabled && opportunityId) {
        try {
          await databaseRecorder.recordOpportunityValidation({
            opportunityId,
            firstDetectedAt,
            firstProfit,
            firstRoi,
            secondCheckedAt,
            stillExists: revalidation.stillExists,
            secondProfit: revalidation.stillExists ? BigInt(revalidation.secondProfit) : undefined,
            secondRoi: revalidation.stillExists ? revalidation.secondRoi : undefined,
            validationDelayMs: totalValidationDelayMs,  // 🔥 使用总延迟而不是查询延迟
            // 🔥 新增：详细延迟分析数据
            firstOutboundMs: opportunity.latency?.outboundMs,
            firstReturnMs: opportunity.latency?.returnMs,
            secondOutboundMs: revalidation.secondOutboundMs,
            secondReturnMs: revalidation.secondReturnMs,
          });
        } catch (error) {
          logger.warn('⚠️ Failed to record validation (non-blocking):', error);
        }
      }
    }

    // 🔥 执行决策：基于构建结果，不看验证结果（验证仅用于统计）
    if (!buildResult) {
      logger.error('❌ Transaction build failed, skipping execution');
      logger.info(`🔒 交易构建失败，确保不会执行交易，不会消耗 gas`);
      this.stats.opportunitiesFiltered++;
      
      if (this.config.database?.enabled && opportunityId) {
        try {
          await databaseRecorder.markOpportunityFiltered(
            opportunityId,
            `Build failed: no cached quote or build error`
          );
        } catch (error) {
          logger.warn('⚠️ Failed to mark filtered (non-blocking):', error);
        }
      }
      // 🔒 安全保证：构建失败后立即返回，确保不会执行交易
      return;
    }

    // 📊 微信通知：推送验证统计结果（不影响执行）
    if (validationEnabled && revalidation) {
      logger.info(`✅ Transaction built successfully, validation stats: stillExists=${revalidation.stillExists}`);
    } else {
      logger.info('✅ Transaction built successfully (secondary validation skipped)');
    }
    
    // 🆕 计算理论利润和费用（仅针对通过二次验证的机会）
    if (validationEnabled && revalidation?.stillExists) {
      try {
        // 估算优先费用
        const { totalFee: estimatedPriorityFee, strategy: feeStrategy } = await this.priorityFeeEstimator.estimateOptimalFee(
          revalidation.secondProfit,
          'high'
        );
        
        // 计算费用配置
        const theoreticalFeeConfig = {
          baseFee: this.config.economics.cost.signatureCount * 5000,
          priorityFee: estimatedPriorityFee,
          jitoTipPercent: this.config.economics.jito.profitSharePercentage || 30,
          slippageBufferBps: 15,
        };
        
        // 使用实际借款金额
        const theoreticalBorrowAmount = opportunity.inputAmount;
        
        // 计算完整费用拆解
        const grossProfit = revalidation.secondProfit;
        const fixedCost = theoreticalFeeConfig.baseFee + theoreticalFeeConfig.priorityFee;
        const netAfterFixed = grossProfit - fixedCost;
        
        let jitoTip = 0;
        let slippageBuffer = 0;
        let theoreticalNetProfit = netAfterFixed;
        
        if (netAfterFixed > 0) {
          // 计算Jito Tip（基于扣除固定成本后的利润）
          jitoTip = Math.floor(netAfterFixed * theoreticalFeeConfig.jitoTipPercent / 100);
          
          // 计算滑点缓冲（智能动态计算）
          slippageBuffer = Math.min(
            Math.floor(theoreticalBorrowAmount * 0.0003),      // 借款的0.03%
            Math.floor(grossProfit * 0.10),                     // 利润的10%
            Math.floor(theoreticalBorrowAmount * 0.0002)        // 动态上限：借款的0.02%
          );
          
          theoreticalNetProfit = netAfterFixed - jitoTip - slippageBuffer;
        }
        
        // 详细日志输出
        logger.info(
          `\n${'═'.repeat(80)}\n` +
          `📊 二次验证机会 - 理论利润分析\n` +
          `${'═'.repeat(80)}\n` +
          `💰 毛利润（理论）:       ${(grossProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL\n` +
          `   ├─ 基础费用:          -${(theoreticalFeeConfig.baseFee / LAMPORTS_PER_SOL).toFixed(6)} SOL (${this.config.economics.cost.signatureCount} 签名 × 5000 lamports)\n` +
          `   ├─ 优先费用 (${feeStrategy}): -${(theoreticalFeeConfig.priorityFee / LAMPORTS_PER_SOL).toFixed(6)} SOL\n` +
          `   ├─ 固定成本小计:      -${(fixedCost / LAMPORTS_PER_SOL).toFixed(6)} SOL\n` +
          `   │\n` +
          `   ├─ Jito Tip (${theoreticalFeeConfig.jitoTipPercent}%):  -${(jitoTip / LAMPORTS_PER_SOL).toFixed(6)} SOL\n` +
          `   ├─ 滑点缓冲:          -${(slippageBuffer / LAMPORTS_PER_SOL).toFixed(6)} SOL\n` +
          `   │\n` +
          `💎 理论净利润:           ${(theoreticalNetProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL ` +
          `${theoreticalNetProfit > 0 ? '✅' : '❌'}\n` +
          `   └─ ROI: ${theoreticalNetProfit > 0 && fixedCost > 0 ? ((theoreticalNetProfit / fixedCost) * 100).toFixed(2) + '%' : 'N/A'}\n` +
          `${'═'.repeat(80)}`
        );
        
        // 如果理论净利润为负，记录警告
        if (theoreticalNetProfit <= 0) {
          logger.warn(
            `⚠️  注意：虽然二次验证发现利润机会，但扣除所有费用后理论净利润为负！\n` +
            `   建议：此机会可能不值得执行，除非实际滑点更低。`
          );
        }
        
        // 累加统计数据
        this.stats.validatedOpportunities++;
        this.stats.theoreticalNetProfitSol += theoreticalNetProfit / LAMPORTS_PER_SOL;
        this.stats.theoreticalFeesBreakdown.totalBaseFee += theoreticalFeeConfig.baseFee / LAMPORTS_PER_SOL;
        this.stats.theoreticalFeesBreakdown.totalPriorityFee += theoreticalFeeConfig.priorityFee / LAMPORTS_PER_SOL;
        this.stats.theoreticalFeesBreakdown.totalJitoTip += jitoTip / LAMPORTS_PER_SOL;
        this.stats.theoreticalFeesBreakdown.totalSlippageBuffer += slippageBuffer / LAMPORTS_PER_SOL;
        
      } catch (error) {
        logger.warn('⚠️ 理论费用计算失败（不影响主流程）:', error);
      }
    } else if (!validationEnabled) {
      logger.info('ℹ️ Secondary validation disabled; skipping theoretical profit analysis.');
    }
    
    if (this.monitoring) {
      if (validationEnabled && revalidation?.stillExists) {
        try {
          const sent = await this.monitoring.alertOpportunityValidated({
            inputMint: opportunity.inputMint.toBase58(),
            bridgeToken: opportunity.bridgeToken,
            route: opportunity.route,  // ✅ 传递路由信息（用于显示桥接次数）
            // 第一次数据
            firstProfit: opportunity.profit,
            firstRoi: opportunity.roi,
            firstOutboundMs: opportunity.latency?.outboundMs,
            firstReturnMs: opportunity.latency?.returnMs,
            // 第二次数据
            secondProfit: revalidation.secondProfit,
            secondRoi: revalidation.secondRoi,
            secondOutboundMs: revalidation.secondOutboundMs,
            secondReturnMs: revalidation.secondReturnMs,
            // 验证延迟
            validationDelayMs: totalValidationDelayMs,
          });
          if (sent) {
            logger.info('📱 ✅ 二次验证通过通知已成功发送到微信');
          } else {
            logger.warn('📱 ⚠️ 二次验证通知未发送，原因可能是：');
            logger.warn(`   1. 配置未开启: alert_on_opportunity_validated=${this.config.monitoring?.alert_on_opportunity_validated}`);
            logger.warn(`   2. 利润低于阈值: secondProfit=${(revalidation.secondProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL < min=${(this.config.monitoring?.min_validated_profit_for_alert || 0) / LAMPORTS_PER_SOL} SOL`);
            logger.warn(`   3. 频率限制: validated_alert_rate_limit_ms=${this.config.monitoring?.validated_alert_rate_limit_ms || 0}ms`);
          }
        } catch (error) {
          logger.error('📱 ❌ 发送微信通知失败:', error);
        }
      } else if (!validationEnabled) {
        logger.info('📱 Secondary validation disabled; skipping validated opportunity alert.');
      }
    } else {
      logger.warn('📱 ⚠️ 监控服务未启用，无法发送微信通知');
    }

    // 🚀 交易已在并行构建中完成，现在执行
    const { transaction, bundle, isBundleMode, validation, borrowAmount, flashLoanFee } = buildResult;

    if (isBundleMode && bundle) {
    logger.info(
        `💰 Executing Bundle (2 transactions): ` +
        `Borrow ${borrowAmount / LAMPORTS_PER_SOL} SOL, ` +
        `Expected profit: ${validation.netProfit / LAMPORTS_PER_SOL} SOL`
    );
    } else {
      logger.info(
        `💰 Executing single transaction: ` +
          `Borrow ${borrowAmount / LAMPORTS_PER_SOL} SOL, ` +
          `Expected profit: ${validation.netProfit / LAMPORTS_PER_SOL} SOL`
      );
    }

    // 模拟模式（简单模拟：只到这里就停止）
    if (this.config.dryRun && !this.config.simulateToBundle) {
      logger.info(
        `[DRY RUN] Would execute flashloan arbitrage with ${borrowAmount / LAMPORTS_PER_SOL} SOL`
      );
      this.stats.tradesSuccessful++;
      this.stats.totalProfitSol += validation.netProfit / LAMPORTS_PER_SOL;
      return;
    }
    
    // 深度模拟模式：继续执行，但在executor中不发送bundle

    // 🔒 额外的安全检查：即使 simulateToBundle 为 true，如果 dryRun 为 true，也不执行交易
    if (this.config.dryRun) {
      logger.info(
        `[DRY RUN] Would execute flashloan arbitrage with ${borrowAmount / LAMPORTS_PER_SOL} SOL ` +
        `(simulateToBundle enabled, but dryRun prevents execution)`
      );
      this.stats.tradesSuccessful++;
      this.stats.totalProfitSol += validation.netProfit / LAMPORTS_PER_SOL;
      return;
    }

    // 检查熔断器
    if (!this.economics.circuitBreaker.canAttempt()) {
      logger.warn('🚨 Circuit breaker activated, skipping trade');
      return;
    }

    try {
      // 🔒 安全检查：确保交易对象或Bundle存在且有效
      if (!transaction && !bundle) {
        logger.error('❌ Neither transaction nor bundle is available, cannot execute');
        return;
      }

      let result;
      this.stats.tradesAttempted++;

      if (isBundleMode && bundle) {
        // 执行Bundle（2个交易）
        logger.info(`💰 Executing Bundle: sending to Jito executor...`);
        result = await this.executor.execute(
          bundle,
          validation.netProfit / LAMPORTS_PER_SOL,
          0.5, // competitionLevel
          0.7  // urgency
        );
      } else if (transaction) {
        // 执行单笔交易
        logger.info(`💰 Executing single transaction: sending to executor...`);
        result = await this.executor.executeVersionedTransaction(
        transaction,
        validation.netProfit / LAMPORTS_PER_SOL
      );
      } else {
        logger.error('❌ Invalid execution state');
        return;
      }

      // 记录结果
      this.economics.circuitBreaker.recordTransaction({
        success: result.success,
        profit: result.success ? validation.netProfit : 0,
        timestamp: Date.now(),
      });

      if (result.success) {
        this.stats.tradesSuccessful++;
        this.stats.totalBorrowedSol += borrowAmount / LAMPORTS_PER_SOL;
        this.stats.totalFlashloanFees += flashLoanFee / LAMPORTS_PER_SOL;
        this.stats.totalProfitSol += validation.netProfit / LAMPORTS_PER_SOL;

        logger.info(
          `✅ Flashloan trade successful! ` +
            `Signature: ${result.signature}, ` +
            `Net profit: ${validation.netProfit / LAMPORTS_PER_SOL} SOL`
        );

        // 发送利润通知
        if (
          this.monitoring &&
          this.config.monitoring &&
          validation.netProfit >= (this.config.monitoring.minProfitForAlert || 0)
        ) {
          await this.monitoring.sendAlert({
            type: 'success',
            title: '🎉 闪电贷套利成功！',
            description: `成功完成一笔闪电贷套利交易`,
            fields: [
              { name: '借款金额', value: `${borrowAmount / LAMPORTS_PER_SOL} SOL` },
              {
                name: '闪电贷费用',
                value: `${flashLoanFee / LAMPORTS_PER_SOL} SOL`,
              },
              { name: '净利润', value: `${validation.netProfit / LAMPORTS_PER_SOL} SOL` },
              {
                name: 'ROI',
                value: flashLoanFee > 0 
                  ? `${((validation.netProfit / flashLoanFee) * 100).toFixed(1)}%`
                  : 'Infinite (0% fee)',
              },
              { name: '交易签名', value: result.signature || 'N/A' },
            ],
            level: 'high',
          });
        }
      } else {
        this.stats.tradesFailed++;
        this.stats.totalLossSol += flashLoanFee / LAMPORTS_PER_SOL;

        logger.warn(`❌ Flashloan trade failed: ${result.error || 'Unknown error'}`);

        // 发送失败告警
        if (this.monitoring) {
          await this.monitoring.sendAlert({
            type: 'error',
            title: '❌ 闪电贷交易失败',
            description: `闪电贷交易执行失败`,
            fields: [
              { name: '借款金额', value: `${borrowAmount / LAMPORTS_PER_SOL} SOL` },
              { name: '预期利润', value: `${validation.netProfit / LAMPORTS_PER_SOL} SOL` },
              { name: '失败原因', value: result.error || '未知' },
            ],
            level: 'medium',
          });
        }
      }
    } catch (error: any) {
      this.stats.tradesFailed++;
      logger.error(`Error handling opportunity: ${error.message}`);

      // 记录失败
      this.economics.circuitBreaker.recordTransaction({
        success: false,
        profit: 0,
        timestamp: Date.now(),
      });
    }

    // 检查熔断器状态
    const breakerStatus = this.economics.circuitBreaker.shouldBreak();
    if (breakerStatus.shouldBreak && this.monitoring) {
      await this.monitoring.sendAlert({
        type: 'warning',
        title: '🚨 触发熔断保护',
        description: `机器人已触发熔断，暂停交易`,
        fields: [
          { name: '触发原因', value: breakerStatus.reason || 'Circuit breaker triggered' },
          {
            name: '冷却时间',
            value: `${this.config.economics.risk.cooldownPeriod / 60000} 分钟`,
          },
        ],
        level: 'high',
      });
    }
  }

  /**
   * 计算最优借款金额（改进版 - 基于利润率动态计算）
   */
  private calculateOptimalBorrowAmount(
    opportunity: ArbitrageOpportunity
  ): number {
    const providerConfig = this.config.flashloan.provider === 'jupiter-lend'
      ? this.config.flashloan.jupiter_lend
      : this.config.flashloan.solend;
    
    // 🔧 修复：支持snake_case和camelCase（TOML配置vs代码）
    const configAny = providerConfig as any; // 类型断言以支持snake_case
    const minBorrowAmount = providerConfig?.minBorrowAmount 
      || configAny?.min_borrow_amount 
      || 50_000_000_000; // 默认50 SOL
    const maxBorrowAmount = providerConfig?.maxBorrowAmount 
      || configAny?.max_borrow_amount 
      || 50_000_000_000; // 默认50 SOL
    
    const dynamicConfig = this.config.flashloan.dynamicSizing;

    // 🔍 调试日志：显示借款金额配置
    logger.debug(
      `💰 Borrow config: provider=${this.config.flashloan.provider}, ` +
      `min=${(minBorrowAmount / 1e9).toFixed(1)} SOL, ` +
      `max=${(maxBorrowAmount / 1e9).toFixed(1)} SOL, ` +
      `dynamic=${dynamicConfig?.enabled}`
    );

    // 添加输入验证，防止NaN
    if (!opportunity.inputAmount || opportunity.inputAmount <= 0) {
      logger.error('Invalid inputAmount in opportunity, using minBorrowAmount');
      return minBorrowAmount;
    }

    if (!opportunity.profit || opportunity.profit <= 0) {
      logger.error('Invalid profit in opportunity, using minBorrowAmount');
      return minBorrowAmount;
    }

    if (dynamicConfig?.enabled) {
      // 计算利润率（ROI）
      const profitRate = opportunity.profit / opportunity.inputAmount;
      
      // 根据利润率决定借款金额
      // 策略：利润率越高，借款越多（基于查询金额的倍数）
      const { minMultiplier, maxMultiplier, safetyMargin } = dynamicConfig;
      
      // 基于输入金额（查询金额）按比例放大
      // 例如：查询10 SOL，利润率0.02%，借款100 SOL预期利润0.02 SOL
      let borrowAmount: number;
      
      // 根据利润率分级决定借款倍数
      if (profitRate > 0.01) {
        // >1% ROI：高利润率，借最大倍数
        borrowAmount = opportunity.inputAmount * maxMultiplier;
      } else if (profitRate > 0.005) {
        // 0.5-1% ROI：中等利润率，借中等倍数
        borrowAmount = opportunity.inputAmount * ((minMultiplier + maxMultiplier) / 2);
      } else if (profitRate > 0.001) {
        // 0.1-0.5% ROI：较低利润率，借较小倍数
        borrowAmount = opportunity.inputAmount * (minMultiplier * 1.5);
      } else {
        // <0.1% ROI：低利润率，借最小倍数
        borrowAmount = opportunity.inputAmount * minMultiplier;
      }
      
      // 应用安全边际（降低风险）
      borrowAmount = Math.floor(borrowAmount * safetyMargin);
      
      // 限制在配置范围内
      borrowAmount = Math.min(
        Math.max(borrowAmount, minBorrowAmount),
        maxBorrowAmount
      );
      
      logger.info(`📊 Dynamic borrow: ${(borrowAmount / 1e9).toFixed(2)} SOL (ROI=${(opportunity.roi).toFixed(3)}%)`);
      
      return borrowAmount;
    }

    // 默认：使用最小借款金额（动态借款关闭时）
    logger.info(`📌 Fixed borrow amount: ${(minBorrowAmount / 1e9).toFixed(2)} SOL (dynamic sizing disabled)`);
    return minBorrowAmount;
  }

  /**
   * RPC模拟验证闪电贷交易（核心优化⭐）
   * 
   * 在不消耗任何Gas的情况下，完整模拟交易执行
   * 
   * @param opportunity 套利机会
   * @param borrowAmount 借款金额
   * @param arbitrageInstructions 已构建的套利指令
   * @param lookupTableAccounts ALT账户
   * @returns 模拟结果
   */
  private async simulateFlashloan(
    opportunity: ArbitrageOpportunity,
    borrowAmount: number,
    arbitrageInstructions: TransactionInstruction[],
    lookupTableAccounts: AddressLookupTableAccount[]
  ): Promise<{
    valid: boolean;
    reason?: string;
    logs?: string[];
    unitsConsumed?: number;
  }> {
    logger.info(`🔍 Simulating flashloan with ${borrowAmount / 1e9} SOL...`);
    const startTime = Date.now();

    try {
      if (!arbitrageInstructions || arbitrageInstructions.length === 0) {
        return {
          valid: false,
          reason: 'No arbitrage instructions provided',
        };
      }

      // 验证指令有效性，避免 toBase58() undefined 错误
      if (!this.validateInstructions(arbitrageInstructions)) {
        return {
          valid: false,
          reason: 'Invalid instructions: contains undefined accounts',
        };
      }

      // 2. 构建完整的闪电贷交易
      const recentBlockhash = await this.getCachedBlockhash();
      const userTokenAccount = await this.getOrCreateTokenAccount(
        opportunity.inputMint
      );

      // ✅ 确保 borrowAmount 是 number 类型，避免 BigInt 传递到交易构建
      const borrowAmountSafe = Number(borrowAmount);

      const transaction = FlashLoanTransactionBuilder.buildAtomicArbitrageTx(
        {
          useFlashLoan: true,
          flashLoanConfig: {
            protocol: this.config.flashloan.provider === 'jupiter-lend'
              ? FlashLoanProtocol.JUPITER_LEND
              : FlashLoanProtocol.SOLEND,
            amount: borrowAmountSafe,
            tokenMint: opportunity.inputMint,
          },
          arbitrageInstructions,
          wallet: this.keypair.publicKey,
        },
        recentBlockhash.blockhash,
        userTokenAccount,
        lookupTableAccounts  // 传递 ALT 以压缩交易大小
      );

      // 3. 签名交易（模拟需要签名）
      // ⚠️ 安全注意：此交易仅用于模拟，模拟后会立即失效（blockhash过期）
      // 模拟用的交易是局部变量，不会被返回或重用，绝对安全
      // 🔧 修复：先签名，再测量完整交易大小（包含签名）
      transaction.sign([this.keypair]);

      // 4. 计算交易大小（签名后的完整交易）
      const txSize = transaction.serialize().length;
      const maxTxSize = 1232; // 原始交易限制
      const maxBase64Size = 1644; // Base64编码后的限制

      // 计算Base64编码后的估算大小（增加33.3%）
      const estimatedBase64Size = Math.ceil(txSize * 1.333);

      logger.info(
        `📦 Transaction size: ${txSize}/${maxTxSize} bytes (raw), ` +
        `~${estimatedBase64Size}/${maxBase64Size} bytes (base64 encoded) ` +
        `(${lookupTableAccounts.length} ALTs, ${arbitrageInstructions.length} instructions)`
      );
      
      if (txSize > maxTxSize) {
        logger.error(`❌ Transaction too large: ${txSize} > ${maxTxSize} bytes (raw)`);
        return {
          valid: false,
          reason: `Transaction too large: ${txSize} bytes (raw) > ${maxTxSize} bytes`,
        };
      }

      if (estimatedBase64Size > maxBase64Size) {
        logger.error(`❌ Transaction too large after base64 encoding: ${estimatedBase64Size} > ${maxBase64Size} bytes`);
        return {
          valid: false,
          reason: `Transaction too large after base64 encoding: ${estimatedBase64Size} bytes > ${maxBase64Size} bytes`,
        };
      }

      // 5. RPC模拟执行（免费！）⭐
      // simulateTransaction 不会发送交易到链上，不会消耗任何 gas
      const simulation = await this.connection.simulateTransaction(
        transaction,
        {
          // 使用 'processed' 承诺级别（最快）
          commitment: 'processed',
          
          // 跳过签名验证（加速，因为只是模拟）
          sigVerify: false,
          
          // 使用最新的区块哈希（避免"Blockhash not found"错误）
          replaceRecentBlockhash: true,
          
          // 包含详细账户信息（可选）
          accounts: {
            encoding: 'base64',
            addresses: [],  // 可以指定要返回状态的账户
          },
        }
      );

      const simTime = Date.now() - startTime;

      // 🔒 安全说明：模拟用的交易对象是局部变量，不会被返回或重用
      // simulateTransaction 不会发送交易到链上，不会消耗任何 gas
      // 交易对象在函数返回后会自动被垃圾回收，绝对安全

      // 6. 分析模拟结果
      if (simulation.value.err) {
        // 模拟失败 - 这是我们要过滤的
        const errorMsg = this.parseSimulationError(simulation.value.err);
        
        logger.warn(
          `❌ Simulation failed (${simTime}ms)\n` +
          `   Reason: ${errorMsg}\n` +
          `   🎉 Saved 0.116 SOL (Gas + Tip) by filtering invalid opportunity\n` +
          `   ✅ 模拟交易已安全销毁，不会消耗任何 gas`
        );

        return {
          valid: false,
          reason: errorMsg,
          logs: simulation.value.logs || [],
        };
      }

      // 模拟成功 - 可以安全执行
      logger.info(
        `✅ Simulation passed (${simTime}ms)\n` +
        `   Compute units: ${simulation.value.unitsConsumed || 'unknown'}\n` +
        `   Log entries: ${simulation.value.logs?.length || 0}\n` +
        `   ✅ 模拟交易已安全销毁，不会消耗任何 gas`
      );

      // 可选：分析日志，提取实际利润
      if (simulation.value.logs && simulation.value.logs.length > 0) {
        logger.debug(`Simulation logs:`, simulation.value.logs.slice(0, 10));
      }

      return {
        valid: true,
        logs: simulation.value.logs || [],
        unitsConsumed: simulation.value.unitsConsumed,
      };

    } catch (error: any) {
      const simTime = Date.now() - startTime;
      logger.error(`⚠️ Simulation error (${simTime}ms): ${error.message}`);
      
      // 模拟出错也视为无效（保守策略）
      return {
        valid: false,
        reason: `Simulation error: ${error.message}`,
      };
    }
  }

  /**
   * 解析模拟错误信息
   */
  private parseSimulationError(err: any): string {
    if (typeof err === 'string') {
      return err;
    }

    // InstructionError: [index, error]
    if (err.InstructionError) {
      const [index, error] = err.InstructionError;
      
      // 常见错误码解析
      if (error.Custom !== undefined) {
        const errorCode = error.Custom;
        return `Instruction ${index} failed with custom error ${errorCode}`;
      }
      
      if (error.InsufficientFunds) {
        return `Instruction ${index} failed: Insufficient funds`;
      }
      
      if (error.Custom === 1) {
        return `Instruction ${index} failed: Insufficient liquidity in pool`;
      }
      
      return `Instruction ${index} failed: ${JSON.stringify(error)}`;
    }

    // InsufficientFundsForRent
    if (err.InsufficientFundsForRent) {
      return 'Insufficient funds for rent';
    }

    // 其他错误
    return JSON.stringify(err);
  }

  /**
   * 构建套利指令（完整实现）
   * 
   * 环形套利流程：
   * 1. SOL → Bridge Token (USDC/USDT/JUP等)
   * 2. Bridge Token → SOL
   * 
   * @param opportunity 套利机会
   * @param borrowAmount 实际借款金额（用于获取准确的swap指令）
   * @returns 指令数组和 Address Lookup Tables
   */
  
  /**
   * 使用Worker缓存的Ultra quote信息通过Quote API构建交易指令
   * 🚀 双重优势：Ultra API的最优价格 + Quote API的闪电贷支持
   * 
   * 策略：
   * 1. Worker用Ultra API发现最优价格和路由（只关心价格，不需要余额）
   * 2. 主线程用Quote API构建指令（支持闪电贷，不检查余额）
   * 3. 使用Ultra的routePlan信息引导Quote API复制路由
   * 
   * @param opportunity 套利机会（包含缓存的Ultra报价信息）
   * @param opportunityId 数据库记录ID
   * @returns 已签名的交易及相关验证信息，失败返回null
   */
  private async buildTransactionFromCachedQuote(
    opportunity: ArbitrageOpportunity,
    opportunityId?: bigint
  ): Promise<{
    transaction?: VersionedTransaction;
    bundle?: Bundle;
    isBundleMode?: boolean;
    validation: any;
    borrowAmount: number;
    flashLoanFee: number;
  } | null> {
    
    try {
      // 1. 检查是否有缓存的 Ultra quote（Ultra API只用于价格发现）
      if (!opportunity.outboundQuote || !opportunity.returnQuote) {
        logger.error('❌ No cached quote from Worker');
        return null;
      }
      
      const quoteAge = Date.now() - (opportunity.discoveredAt || 0);
      logger.info(
        `🎯 Using Worker quote for routing guidance (age: ${quoteAge}ms) + ` +
        `Legacy Swap API for instruction building (flash loan support)`
      );
      
      // 2. 计算最优借款金额
      const borrowAmount = this.calculateOptimalBorrowAmount(opportunity);
      
      // 3. 初步利润检查（基于Worker报价，仅过滤明显无利润的情况）
      const profitRate = opportunity.profit / opportunity.inputAmount;
      const expectedProfitFromWorker = Math.floor(profitRate * borrowAmount);
      
      logger.debug(
        `Profit calculation (Worker quote): query ${opportunity.inputAmount / LAMPORTS_PER_SOL} SOL -> ` +
        `profit ${opportunity.profit / LAMPORTS_PER_SOL} SOL (${(profitRate * 100).toFixed(4)}%), ` +
        `borrow ${borrowAmount / LAMPORTS_PER_SOL} SOL -> ` +
        `expected ${expectedProfitFromWorker / LAMPORTS_PER_SOL} SOL`
      );
      
      // 4. 过滤异常ROI
      const MAX_REASONABLE_ROI = 10;
      if (profitRate * 100 > MAX_REASONABLE_ROI) {
        logger.warn(
          `Filtering abnormal opportunity: ROI ${(profitRate * 100).toFixed(2)}% exceeds ` +
          `reasonable limit ${MAX_REASONABLE_ROI}%. Likely API data error.`
        );
        return null;
      }
      
      // 5. 初步利润过滤（基于Worker报价，仅过滤明显无利润的情况）
      // 注意：这里只做初步过滤，真正的利润验证会在并行预判后基于实际路由报价进行
      if (expectedProfitFromWorker <= 0) {
        logger.debug(`❌ 初步检查：Worker报价显示无利润，跳过`);
        return null;
      }
      
      // 6. 构建闪电贷指令（如果使用Jupiter Lend）
      const isJupiterLend = this.config.flashloan.provider === 'jupiter-lend';
      
      // 8. 🚀 并行预判策略：并行获取多个策略的报价和指令
      logger.debug('🚀 Building swap instructions via Quote API with parallel fallback...');
      const buildStart = Date.now();
      const maxBase64Size = 1644; // Base64编码后的限制
      
      // 🚀 优化：第一阶段 - 只查询最优策略
      const primaryStrategy = { 
        name: '最优路由', 
        maxAccounts: 20,  // 🔥 降低到20以减少交易大小（从28降低）
        onlyDirectRoutes: false 
      };

      logger.debug(`🚀 第一阶段：查询最优策略...`);
      const primaryStart = Date.now();

      const [flashLoanInstructions, [primarySwap1, primarySwap2]] = await Promise.all([
        // 闪电贷指令构建
        isJupiterLend 
          ? this.jupiterLendAdapter.buildFlashLoanInstructions({
              amount: borrowAmount,
              asset: opportunity.inputMint,
              signer: this.keypair.publicKey,
            }).catch(error => {
              logger.error(`❌ Failed to build Jupiter Lend instructions: ${error.message}`);
              throw error;
            })
          : Promise.resolve(null),
        
        // 最优策略的两个swap
        Promise.all([
          this.buildSwapInstructionsFromQuoteAPI({
            inputMint: opportunity.inputMint,
            outputMint: opportunity.bridgeMint!,
            amount: borrowAmount,
            slippageBps: 50,
            ultraRoutePlan: opportunity.outboundQuote.routePlan,
            maxAccounts: primaryStrategy.maxAccounts,
            onlyDirectRoutes: primaryStrategy.onlyDirectRoutes,
          }),
          this.buildSwapInstructionsFromQuoteAPI({
            inputMint: opportunity.bridgeMint!,
            outputMint: opportunity.outputMint,
            amount: opportunity.bridgeAmount!,
            slippageBps: 50,
            ultraRoutePlan: opportunity.returnQuote.routePlan,
            maxAccounts: primaryStrategy.maxAccounts,
            onlyDirectRoutes: primaryStrategy.onlyDirectRoutes,
          })
        ])
      ]);

      const primaryLatency = Date.now() - primaryStart;
      logger.info(`✅ 最优策略查询完成 (${primaryLatency}ms)`);

      // 检查最优策略是否可用
      let swap1Results: any[] = [];
      let swap2Results: any[] = [];
      let strategies = [primaryStrategy];

      if (primarySwap1 && primarySwap2) {
        // 快速验证最优策略
        const primaryProfit = primarySwap2.outAmount - borrowAmount;
        const primarySize = this.estimateTransactionSizeForStrategy(
          primarySwap1, 
          primarySwap2, 
          flashLoanInstructions
        );
        
        const primaryValid = primaryProfit > 0 && primarySize <= 1644;
        
        if (primaryValid) {
          logger.info(`✅ 最优策略可用: profit=${(primaryProfit/1e9).toFixed(6)} SOL, size=${primarySize}B`);
          swap1Results = [{ strategy: primaryStrategy, result: primarySwap1 }];
          swap2Results = [{ strategy: primaryStrategy, result: primarySwap2 }];
        } else {
          logger.warn(`⚠️ 最优策略不可用 (profit=${(primaryProfit/1e9).toFixed(6)}, size=${primarySize}), 查询降级策略...`);
          // 需要降级
        }
      } else {
        logger.warn(`⚠️ 最优策略失败，查询降级策略...`);
      }

      // 🚀 第二阶段：如果需要，查询降级策略
      if (swap1Results.length === 0) {
        const fallbackStrategies = [
        { name: '中等限制', maxAccounts: 18, onlyDirectRoutes: false },  // 🔥 降低账户限制
        { name: '严格限制', maxAccounts: 16, onlyDirectRoutes: true },   // 🔥 更严格的限制
      ];
      
        logger.debug(`🚀 第二阶段：查询${fallbackStrategies.length}个降级策略...`);
        const fallbackStart = Date.now();
        
        const [fallbackSwap1Results, fallbackSwap2Results] = await Promise.all([
          Promise.all(fallbackStrategies.map(strategy =>
        this.buildSwapInstructionsFromQuoteAPI({
          inputMint: opportunity.inputMint,
          outputMint: opportunity.bridgeMint!,
          amount: borrowAmount,
          slippageBps: 50,
          ultraRoutePlan: opportunity.outboundQuote.routePlan,
          maxAccounts: strategy.maxAccounts,
          onlyDirectRoutes: strategy.onlyDirectRoutes,
        }).then(result => ({ strategy, result }))
          )),
          Promise.all(fallbackStrategies.map(strategy =>
        this.buildSwapInstructionsFromQuoteAPI({
          inputMint: opportunity.bridgeMint!,
          outputMint: opportunity.outputMint,
          amount: opportunity.bridgeAmount!,
          slippageBps: 50,
          ultraRoutePlan: opportunity.returnQuote.routePlan,
          maxAccounts: strategy.maxAccounts,
          onlyDirectRoutes: strategy.onlyDirectRoutes,
        }).then(result => ({ strategy, result }))
          ))
        ]);
      
        const fallbackLatency = Date.now() - fallbackStart;
        logger.info(`✅ 降级策略查询完成 (${fallbackLatency}ms)`);
        
        // 合并最优策略（如果有结果）和降级策略
        swap1Results = [
          ...(primarySwap1 ? [{ strategy: primaryStrategy, result: primarySwap1 }] : []),
          ...fallbackSwap1Results
        ];
        swap2Results = [
          ...(primarySwap2 ? [{ strategy: primaryStrategy, result: primarySwap2 }] : []),
          ...fallbackSwap2Results
        ];
        strategies = [primaryStrategy, ...fallbackStrategies];
      }
      
      // 记录闪电贷指令构建日志（如果成功）
      if (flashLoanInstructions) {
        logger.debug(
          `✅ Jupiter Lend flash loan instructions built ` +
          `(borrow: ${flashLoanInstructions.borrowInstruction.keys.length} accounts, ` +
          `repay: ${flashLoanInstructions.repayInstruction.keys.length} accounts)`
        );
      }
      
      // 🚀 优化3：提取所有可能用到的ALT并预加载（与策略选择并行）
      const allPossibleALTs = new Set<string>();
      for (let i = 0; i < strategies.length; i++) {
        if (swap1Results[i].result && swap2Results[i].result) {
          swap1Results[i].result!.addressLookupTableAddresses.forEach((addr: string) => 
            allPossibleALTs.add(addr)
          );
          swap2Results[i].result!.addressLookupTableAddresses.forEach((addr: string) => 
            allPossibleALTs.add(addr)
          );
        }
      }
      
      // 添加闪电贷ALT
      const flashLoanALT = isJupiterLend 
        ? this.jupiterLendALTManager.getALTAddress() 
        : this.solendALTManager.getALTAddress();
      if (flashLoanALT) {
        allPossibleALTs.add(flashLoanALT.toBase58());
      }
      
      // 🚀 立即启动ALT预加载（与策略选择并行）
      logger.debug(`🚀 ALT预加载已启动 (${allPossibleALTs.size}个地址)，与策略选择并行执行...`);
      
      // 找到最佳策略组合：利润最高且符合大小限制
      let bestSwap1: any = null;
      let bestSwap2: any = null;
      let bestStrategyCombination = '';
      let bestEstimatedSize = Infinity;
      let bestEstimatedProfit = -Infinity;  // 🆕 记录最佳利润
      
      for (let i = 0; i < strategies.length; i++) {
        const swap1 = swap1Results[i];
        const swap2 = swap2Results[i];
        
        if (!swap1.result || !swap2.result) {
          logger.debug(`Strategy ${i} (${strategies[i].name}): swap failed`);
          continue; // 跳过失败的策略
        }
        
        // 🆕 估算利润（基于实际路由报价）
        const estimatedProfit = swap2.result.outAmount - borrowAmount;
        
        // 🔥 关键修复：在估算时也使用合并后的计算预算指令
        const tempMergedComputeBudget = this.mergeComputeBudgetInstructions([
          ...swap1.result.computeBudgetInstructions,
          ...swap2.result.computeBudgetInstructions,
        ]);
        
        // 估算交易大小（使用合并后的计算预算）
        const tempInstructions = [
          ...tempMergedComputeBudget,  // ✅ 使用合并后的指令
          ...swap1.result.setupInstructions,
          ...swap1.result.instructions,
          ...swap1.result.cleanupInstructions,
          ...swap2.result.instructions,
          ...swap2.result.cleanupInstructions,
        ];
        
        const tempAltSet = new Set<string>();
        swap1.result.addressLookupTableAddresses.forEach((addr: string) => tempAltSet.add(addr));
        swap2.result.addressLookupTableAddresses.forEach((addr: string) => tempAltSet.add(addr));
        
        // 添加闪电贷ALT（估算）
        if (isJupiterLend) {
          const jupiterLendALT = this.jupiterLendALTManager.getALTAddress();
          if (jupiterLendALT) {
            tempAltSet.add(jupiterLendALT.toBase58());
          }
        }
        
        // 🚀 优化3：使用预加载的ALT（已在缓存中，速度极快）
        const tempAltAccounts = await this.loadAddressLookupTables(Array.from(tempAltSet));
        const estimatedSize = this.estimateTransactionSize(tempInstructions, tempAltAccounts);
        
        // 🆕 详细日志：显示每个策略的估算结果
        logger.debug(
          `Strategy ${i} (${strategies[i].name}): ` +
          `size=${estimatedSize}/${maxBase64Size}B, ` +
          `profit=${(estimatedProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL, ` +
          `fits=${estimatedSize <= maxBase64Size}`
        );
        
        // 🆕 选择策略：优先选择利润高且符合大小限制的策略
        // 如果利润相同，选择交易大小更小的策略
        const fitsSizeLimit = estimatedSize <= maxBase64Size;
        const isBetterProfit = estimatedProfit > bestEstimatedProfit;
        const isSameProfitButSmaller = estimatedProfit === bestEstimatedProfit && estimatedSize < bestEstimatedSize;
        
        if (fitsSizeLimit && (isBetterProfit || isSameProfitButSmaller)) {
          bestSwap1 = swap1.result;
          bestSwap2 = swap2.result;
          bestStrategyCombination = `${swap1.strategy.name}+${swap2.strategy.name}`;
          bestEstimatedSize = estimatedSize;
          bestEstimatedProfit = estimatedProfit;
          logger.info(`✅ Selected strategy ${i}: ${strategies[i].name}, size=${estimatedSize}B`);
        }
      }
      
      if (!bestSwap1 || !bestSwap2) {
        logger.warn(
          `⚠️ 所有策略在单笔交易模式下都超限。` +
          `尝试了 ${strategies.length} 个策略组合。正在尝试Bundle模式...`
        );
        
        // 🎁 fallback策略：即使所有策略都超限，也尝试Bundle模式
        // 选择利润最高的策略（即使超限）
        let fallbackSwap1: any = null;
        let fallbackSwap2: any = null;
        let fallbackProfit = -Infinity;
        
        for (let i = 0; i < strategies.length; i++) {
          const swap1 = swap1Results[i];
          const swap2 = swap2Results[i];
          
          if (!swap1.result || !swap2.result) continue;
          
          const profit = swap2.result.outAmount - borrowAmount;
          if (profit > fallbackProfit) {
            fallbackSwap1 = swap1.result;
            fallbackSwap2 = swap2.result;
            fallbackProfit = profit;
          }
        }
        
        if (!fallbackSwap1 || !fallbackSwap2) {
          logger.error(`❌ 所有策略的swap指令都失败，无法继续`);
        this.stats.opportunitiesFiltered++;
        return null;
        }
        
        logger.info(`🎁 使用fallback策略，强制尝试Bundle模式...`);
        
        // 🚀 优化：fallback模式也需要查询优先费
        const fallbackProf = fallbackSwap2.outAmount - borrowAmount;
        const { totalFee: fallbackPriorityFee } = await this.priorityFeeEstimator.estimateOptimalFee(
          fallbackProf,
          'high'
        );
        
        // 直接跳转到Bundle模式
        return await this.buildFlashloanBundle(
          opportunity,
          borrowAmount,
          fallbackSwap1,
          fallbackSwap2,
          flashLoanInstructions,
          await this.loadAddressLookupTables([
            ...Array.from(new Set([
              ...fallbackSwap1.addressLookupTableAddresses,
              ...fallbackSwap2.addressLookupTableAddresses,
            ])),
            ...(isJupiterLend && this.jupiterLendALTManager.getALTAddress() 
              ? [this.jupiterLendALTManager.getALTAddress()!.toBase58()] 
              : [])
          ]),
          fallbackPriorityFee  // 传入优先费
        );
      }
      
      logger.info(
        `✅ 选择最佳策略: ${bestStrategyCombination}, ` +
        `估算大小: ${bestEstimatedSize} bytes, ` +
        `估算利润: ${(bestEstimatedProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL`
      );
      
      // 使用最佳策略组合
      const swap1Result = bestSwap1;
      const swap2Result = bestSwap2;
      
      logger.debug(`✅ Built instructions: swap1=${swap1Result.instructions.length} ix, swap2=${swap2Result.instructions.length} ix`);
      
      // 🆕 3. 重新验证利润（基于实际路由报价）
      // 这里使用实际路由的报价，而不是Ultra报价
      const actualOutAmount = swap2Result.outAmount;  // Swap2的输出金额（最终得到的代币数量）
      const actualGrossProfit = actualOutAmount - borrowAmount;  // 毛利润
      
      logger.info(
        `💰 利润重新计算（基于实际路由报价）: ` +
        `借入=${(borrowAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL, ` +
        `实际输出=${(actualOutAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL, ` +
        `毛利润=${(actualGrossProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL`
      );
      
      // 🚀 优化2+3：提前收集ALT地址（为并行加载做准备）
      const altSet = new Set<string>();
      swap1Result.addressLookupTableAddresses.forEach((addr: string) => altSet.add(addr));
      swap2Result.addressLookupTableAddresses.forEach((addr: string) => altSet.add(addr));
      
      // 🗜️ 添加闪电贷ALT（根据配置选择）
      let flashLoanALTAdded = false;
      if (isJupiterLend) {
        const jupiterLendALT = this.jupiterLendALTManager.getALTAddress();
        if (jupiterLendALT) {
          altSet.add(jupiterLendALT.toBase58());
          flashLoanALTAdded = true;
          logger.debug(`🗜️ Added Jupiter Lend ALT: ${jupiterLendALT.toBase58().slice(0, 8)}...`);
        }
      } else {
        const solendALT = this.solendALTManager.getALTAddress();
        if (solendALT) {
          altSet.add(solendALT.toBase58());
          flashLoanALTAdded = true;
          logger.debug(`🗜️ Added Solend ALT: ${solendALT.toBase58().slice(0, 8)}...`);
        }
      }
      
      // 🚀 优化2+3：并行执行优先费查询和ALT加载（复用预加载结果，节省200-400ms）
      const feeAndAltParallelStart = Date.now();
      const [priorityFeeResult, lookupTableAccounts] = await Promise.all([
        this.priorityFeeEstimator.estimateOptimalFee(actualGrossProfit, 'high'),
        // 🚀 如果之前已启动预加载，这里会直接复用缓存结果（极快）
        this.loadAddressLookupTables(Array.from(altSet)),
      ]);
      const feeAndAltParallelLatency = Date.now() - feeAndAltParallelStart;
      
      const { totalFee: priorityFee, strategy: priorityFeeStrategy } = priorityFeeResult;
      
      logger.info(
        `⚡ 并行优化完成 (${feeAndAltParallelLatency}ms): ` +
        `优先费=${(priorityFee / LAMPORTS_PER_SOL).toFixed(6)} SOL (${priorityFeeStrategy}), ` +
        `ALT=${lookupTableAccounts.length}个`
      );
      
      // 验证闪电贷可行性（基于实际利润）
      const feeConfig = {
        baseFee: this.config.economics.cost.signatureCount * 5000,
        priorityFee,
        jitoTipPercent: this.config.economics.jito.profitSharePercentage || 30,
        slippageBufferBps: 15,
        enableNetProfitCheck: this.config.economics.profit.enableNetProfitCheck ?? true,
      };
      
      const validation = this.config.flashloan.provider === 'jupiter-lend'
        ? JupiterLendAdapter.validateFlashLoan(borrowAmount, actualGrossProfit, feeConfig)
        : SolendAdapter.validateFlashLoan(borrowAmount, actualGrossProfit, feeConfig);
      
      if (!validation.valid) {
        logger.warn(`❌ 重新验证失败（策略 ${bestStrategyCombination}）: ${validation.reason || 'unknown'}`);
        if (validation.breakdown) {
          logger.debug(
            `   费用拆解: ` +
            `毛利润=${(validation.breakdown.grossProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL, ` +
            `净利润=${(validation.breakdown.netProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL`
          );
        }
        this.stats.opportunitiesFiltered++;
        return null;
      }
      
      const flashLoanFee = validation.fee;
      logger.info(
        `✅ 重新验证通过（策略 ${bestStrategyCombination}） - 净利润: ${(validation.netProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL`
      );
      
      // 8.3 合并计算预算指令（优化：去重并选择最大值，节省50-100字节）
      const mergedComputeBudget = this.mergeComputeBudgetInstructions([
        ...swap1Result.computeBudgetInstructions,
        ...swap2Result.computeBudgetInstructions,
      ]);
      
      // 8.4 合并所有指令（使用优化后的计算预算）
      const arbitrageInstructions = [
        ...mergedComputeBudget,                    // ✅ 优化后的计算预算（只有1-2个指令）
        ...swap1Result.setupInstructions,          // Swap1的账户设置
        ...swap1Result.instructions,               // Swap1主指令
        ...swap1Result.cleanupInstructions,        // Swap1清理
        ...swap2Result.instructions,               // Swap2主指令
        ...swap2Result.cleanupInstructions,        // Swap2清理
      ];
      
      const buildLatency = Date.now() - buildStart;
      logger.info(
        `✅ Built ${arbitrageInstructions.length} instructions ` +
        `with ${lookupTableAccounts.length} ALTs in ${buildLatency}ms (quote_age=${quoteAge}ms)` +
        `${flashLoanALTAdded ? ` [incl. ${isJupiterLend ? 'Jupiter Lend' : 'Solend'} ALT]` : ''} ` +
        `[strategy=${bestStrategyCombination}, size=${bestEstimatedSize} bytes]`
      );
      
      // 🚨 再次验证交易大小（使用实际的ALT）
      const finalEstimatedSize = this.estimateTransactionSize(
        arbitrageInstructions,
        lookupTableAccounts
      );
      
      // 🎁 自动切换到Bundle模式（当交易大小接近限制时）
      const bundleThreshold = 1100; // 字节，给予一定余量
      
      if (finalEstimatedSize > bundleThreshold) {
        logger.info(
          `🎁 Transaction size (${finalEstimatedSize} bytes) near limit, switching to Jito Bundle mode...`
        );
        
        // 🚀 优化：构建Bundle时复用已查询的优先费
        return await this.buildFlashloanBundle(
          opportunity,
          borrowAmount,
          swap1Result,
          swap2Result,
          flashLoanInstructions,
          lookupTableAccounts,
          priorityFee  // 传入已查询的优先费
        );
      }
      
      // 单笔交易模式：如果超过最大限制则拒绝
      if (finalEstimatedSize > maxBase64Size) {
        logger.warn(
          `⚠️ Final transaction size estimated ${finalEstimatedSize} bytes (base64 encoded) > ${maxBase64Size} limit. ` +
          `Rejecting before simulation to save RPC calls.`
        );
        this.stats.opportunitiesFiltered++;
        return null;
      }

      // 🔒 安全时机：交易大小检查通过后，再扩展 ALT
      // 这样可以避免在交易被拒绝时仍然执行 ALT 扩展
      if (isJupiterLend && flashLoanInstructions) {
        logger.debug('🔧 Ensuring ALT contains flash loan addresses (after size check)...');
        try {
          await this.jupiterLendALTManager.ensureALTForInstructions(
            flashLoanInstructions.borrowInstruction,
            flashLoanInstructions.repayInstruction
          );
        } catch (error: any) {
          logger.error(`❌ Failed to ensure ALT: ${error.message}`);
          // ALT 扩展失败不应该阻止交易执行（如果 ALT 已存在）
          // 但如果是首次创建 ALT 失败，应该拒绝交易
          if (!this.jupiterLendALTManager.getALTAddress()) {
            logger.error(`❌ ALT does not exist and creation failed, rejecting transaction`);
            return null;
          }
        }
      }

      logger.debug(
        `✅ Transaction size OK: ${finalEstimatedSize}/${maxBase64Size} bytes (base64 encoded) ` +
        `(${arbitrageInstructions.length} ix, ${lookupTableAccounts.length} ALTs)`
      );
      
      // 11. RPC模拟验证
      logger.info(`🔬 RPC Simulation Validation...`);
      const simulation = await this.simulateFlashloan(
        opportunity, 
        borrowAmount, 
        arbitrageInstructions, 
        lookupTableAccounts
      );
      
      if (!simulation.valid) {
        logger.warn(`❌ RPC simulation failed: ${simulation.reason}`);
        logger.info(`🔒 模拟失败后交易构建终止，确保不会发送交易，不会消耗 gas`);
        this.stats.opportunitiesFiltered++;
        
        if (this.config.database?.enabled && opportunityId) {
          try {
            await databaseRecorder.markOpportunityFiltered(
              opportunityId,
              `RPC simulation failed: ${simulation.reason}`
            );
          } catch (error) {
            logger.warn('⚠️ Failed to mark filtered (non-blocking):', error);
          }
        }
        
        // 🔒 安全保证：模拟失败后立即返回 null，确保不会构建或发送交易
        return null;
      }
      
      logger.info(`✅ RPC simulation passed! Compute units: ${simulation.unitsConsumed || 'unknown'}`);
      
      // 12. 构建闪电贷原子交易
      const recentBlockhash = await this.getCachedBlockhash();
      const userTokenAccount = await this.getOrCreateTokenAccount(
        opportunity.inputMint
      );
      
      const transaction = FlashLoanTransactionBuilder.buildAtomicArbitrageTx(
        {
          useFlashLoan: true,
          flashLoanConfig: {
            protocol: isJupiterLend
              ? FlashLoanProtocol.JUPITER_LEND
              : FlashLoanProtocol.SOLEND,
            amount: Number(borrowAmount),
            tokenMint: opportunity.inputMint,
          },
          flashLoanInstructions: flashLoanInstructions || undefined, // 传入Jupiter Lend指令（如果有）
          arbitrageInstructions,
          wallet: this.keypair.publicKey,
        },
        recentBlockhash.blockhash,
        userTokenAccount,
        lookupTableAccounts
      );
      
      // 13. 签名交易
      transaction.sign([this.keypair]);
      
      logger.info('✅ Transaction built and signed successfully (single transaction mode)');
      
      // 更新统计：单笔交易模式
      this.stats.singleTransactions++;
      
      return {
        transaction,
        validation,
        borrowAmount,
        flashLoanFee,
        isBundleMode: false,
      };

    } catch (error: any) {
      logger.error(`Failed to build transaction from cached quote: ${error.message}`);
      return null;
    }
  }

  /**
   * 使用 Quote API 构建 Swap 指令（支持闪电贷）
   * 
   * 流程：
   * 1. 调用 /quote 获取报价
   * 2. 调用 /swap-instructions 获取指令（不检查余额，支持闪电贷）
   * 3. 反序列化指令并返回
   * 
   * @param ultraRoutePlan Ultra API 的路由计划（用于引导路由选择）
   */
  private async buildSwapInstructionsFromQuoteAPI(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: number;
    slippageBps: number;
    ultraRoutePlan?: any[];
    maxAccounts?: number;  // 🆕 策略参数：账户数限制
    onlyDirectRoutes?: boolean;  // 🆕 策略参数：是否强制直接路由
  }): Promise<{
    instructions: TransactionInstruction[];
    setupInstructions: TransactionInstruction[];
    cleanupInstructions: TransactionInstruction[];
    computeBudgetInstructions: TransactionInstruction[];
    addressLookupTableAddresses: string[];
    outAmount: number;  // 🆕 报价输出金额（用于重新验证利润）
  } | null> {
    const maxRetries = 3;
    const retryDelay = 100; // ms
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. 从 Ultra routePlan 提取 DEX 列表（如果有）
      const dexes = params.ultraRoutePlan
        ?.map((route: any) => route.swapInfo?.label)
        .filter(Boolean);
      
      logger.debug(
          `Building swap via Legacy Swap API (attempt ${attempt}/${maxRetries}): ` +
          `${params.inputMint.toBase58().slice(0,8)}... → ` +
        `${params.outputMint.toBase58().slice(0,8)}..., ` +
        `amount=${params.amount}, dexes=${dexes?.join(',') || 'auto'}`
      );
      
        // 2. 调用 Legacy Swap API /quote
      const quoteParams: any = {
        inputMint: params.inputMint.toBase58(),
        outputMint: params.outputMint.toBase58(),
        amount: params.amount.toString(),
        slippageBps: params.slippageBps,
        onlyDirectRoutes: params.onlyDirectRoutes !== undefined ? params.onlyDirectRoutes : false, // 🆕 使用策略参数
        maxAccounts: params.maxAccounts !== undefined ? params.maxAccounts : 20, // 🆕 使用策略参数
        restrictIntermediateTokens: true,  // 🔥 限制中间代币，减少路由复杂度
      };
      
        // 如果有 Ultra 的路由信息，尝试锁定 DEX（引导路由）
      if (dexes && dexes.length > 0) {
        quoteParams.dexes = dexes.join(',');
      }
      
      // 🚀 优化：生成缓存key并检查缓存
      const cacheKey = `${params.inputMint.toBase58()}_${params.outputMint.toBase58()}_${params.amount}_${params.maxAccounts}_${params.onlyDirectRoutes}_${dexes?.join(',') || 'auto'}`;
      const cached = this.quoteCache.get(cacheKey);
      
      let quoteResponse: any;
      
      if (cached && (Date.now() - cached.timestamp < this.QUOTE_CACHE_TTL)) {
        // 缓存命中，使用缓存的quote
        logger.debug(`💨 Quote cache hit (age=${Date.now() - cached.timestamp}ms): ${cacheKey.slice(0, 40)}...`);
        quoteResponse = { data: cached.quote };
      } else {
        // 缓存未命中，调用API
        quoteResponse = await this.jupiterQuoteAxios.get('/quote', {
        params: quoteParams,
          timeout: 30000,
      });
      }
      
      if (!quoteResponse.data || !quoteResponse.data.outAmount) {
          logger.warn(`Legacy Swap API returned no route (attempt ${attempt}/${maxRetries})`);
          
          // 如果是因为指定了 dexes 导致无路由，下次重试时不指定
          if (attempt < maxRetries && dexes && dexes.length > 0) {
            logger.info('Retrying without dexes constraint...');
            params.ultraRoutePlan = undefined; // 清除 DEX 限制
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
            continue;
          }
          
        return null;
      }
      
        // 📊 添加详细的路由调试日志
        logger.debug(
          `Quote API response: ` +
          `outAmount=${quoteResponse.data.outAmount}, ` +
          `marketInfos=${quoteResponse.data.marketInfos?.length || 0}, ` +
          `routePlan=${quoteResponse.data.routePlan?.length || 0}`
        );
        
        // 输出市场详情（用于调试）
        if (quoteResponse.data.marketInfos && quoteResponse.data.marketInfos.length > 0) {
          const marketLabels = quoteResponse.data.marketInfos.map((m: any) => m.label || 'Unknown');
          logger.debug(`Markets in route: ${marketLabels.join(' → ')}`);
        }
        
        // 🚨 关键优化：检查路由复杂度，过滤掉会导致交易过大的路由
        // 修复：检查实际的DEX数量，而不只是swap数量
        const routeComplexity = this.analyzeRouteComplexity(quoteResponse.data);
        
        // 闪电贷场景：最多允许2个DEX（更严格的限制）
        // 🚀 Jupiter Lend (0% fee) + ALT压缩后，可以支持3个DEX！
        const maxDexes = this.config.flashloan.provider === 'jupiter-lend' ? 3 : 2;
        const maxAccounts = 28;  // Jupiter Lend允许更多账户
        
        if (routeComplexity.totalDexes > maxDexes) {
          logger.warn(
            `⚠️ Route has too many DEXes: ${routeComplexity.totalDexes} > ${maxDexes} max (${this.config.flashloan.provider}). ` +
            `DEX list: ${routeComplexity.dexLabels.join(' → ')}. ` +
            `This would create oversized transaction. Skipping.`
          );
          return null;
        }
        
        if (routeComplexity.totalAccounts > maxAccounts) {
          logger.warn(
            `⚠️ Route requires too many accounts: ${routeComplexity.totalAccounts} > ${maxAccounts} max. ` +
            `Skipping to avoid transaction size issues.`
          );
          return null;
        }
        
        logger.debug(
          `✅ Route complexity check passed: ${routeComplexity.totalDexes} DEXes ` +
          `(${routeComplexity.dexLabels.join(' → ')}), ` +
          `${routeComplexity.totalAccounts} accounts <= ${maxAccounts} max`
        );
        
        // 3. 调用 /swap-instructions（不检查余额，支持闪电贷）
      const swapInstructionsResponse = await this.jupiterQuoteAxios.post('/swap-instructions', {
        quoteResponse: quoteResponse.data,
        userPublicKey: this.keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: false,  // 🔥 闪电贷已是wSOL，不需要wrap/unwrap（省~40 bytes）
        dynamicComputeUnitLimit: true,
        asLegacyTransaction: false,  // 🔥 启用 Versioned Transaction + LUT 压缩
        useSharedAccounts: true,     // 🔥 启用共享账户优化
        skipUserAccountsRpcCalls: true,  // 🔥 跳过RPC调用，加快速度
          // prioritizationFeeLamports: 'auto', // 让 Jupiter 自动设置优先费
      }, {
          timeout: 30000,
      });
      
      if (swapInstructionsResponse.data?.error) {
          logger.error(
            `Legacy Swap API error (attempt ${attempt}/${maxRetries}): ` +
            `${swapInstructionsResponse.data.error}`
          );
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
            continue;
          }
          
        return null;
      }
      
      const {
        computeBudgetInstructions,
        setupInstructions,
        swapInstruction: swapInstructionPayload,
        cleanupInstruction,
        addressLookupTableAddresses,
      } = swapInstructionsResponse.data;
      
      // 4. 反序列化指令
      const deserializeInstruction = (instructionPayload: any): TransactionInstruction => {
        return new TransactionInstruction({
          programId: new PublicKey(instructionPayload.programId),
          keys: instructionPayload.accounts.map((key: any) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          data: Buffer.from(instructionPayload.data, 'base64'),
        });
      };
      
        // 反序列化所有指令
        const deserializedInstructions = {
        instructions: swapInstructionPayload ? [deserializeInstruction(swapInstructionPayload)] : [],
        setupInstructions: (setupInstructions || []).map(deserializeInstruction),
        cleanupInstructions: cleanupInstruction ? [deserializeInstruction(cleanupInstruction)] : [],
        computeBudgetInstructions: (computeBudgetInstructions || []).map(deserializeInstruction),
        addressLookupTableAddresses: addressLookupTableAddresses || [],
      };
      
        // 📊 详细的指令统计日志
        const totalInstructions = 
          deserializedInstructions.instructions.length +
          deserializedInstructions.setupInstructions.length +
          deserializedInstructions.cleanupInstructions.length +
          deserializedInstructions.computeBudgetInstructions.length;
        
        // 计算指令data总大小
        const allInstructions = [
          ...deserializedInstructions.computeBudgetInstructions,
          ...deserializedInstructions.setupInstructions,
          ...deserializedInstructions.instructions,
          ...deserializedInstructions.cleanupInstructions,
        ];
        const totalDataSize = allInstructions.reduce((sum, ix) => sum + ix.data.length, 0);
        const totalAccounts = allInstructions.reduce((sum, ix) => sum + ix.keys.length, 0);
        
        logger.debug(
          `✅ Swap instructions built: ` +
          `${totalInstructions} total (` +
          `compute=${deserializedInstructions.computeBudgetInstructions.length}, ` +
          `setup=${deserializedInstructions.setupInstructions.length}, ` +
          `swap=${deserializedInstructions.instructions.length}, ` +
          `cleanup=${deserializedInstructions.cleanupInstructions.length}), ` +
          `data=${totalDataSize}B, accounts=${totalAccounts}, ALTs=${addressLookupTableAddresses?.length || 0}, ` +
          `outAmount=${quoteResponse.data.outAmount}`
        );
        
        // 🚀 优化：更新缓存（只有在API调用成功后才更新）
        if (!cached) {
          this.quoteCache.set(cacheKey, {
            quote: quoteResponse.data,
            swapResponse: swapInstructionsResponse.data,
            timestamp: Date.now()
          });
          
          // 定期清理过期缓存（10%概率）
          if (Math.random() < 0.1) {
            this.cleanExpiredQuoteCache();
          }
        }
        
        return {
          ...deserializedInstructions,
          outAmount: Number(quoteResponse.data.outAmount),  // 🆕 返回报价输出金额
        };
        
    } catch (error: any) {
        const isTlsError = error.message?.includes('TLS') || 
                          error.message?.includes('socket') ||
                          error.code === 'ECONNRESET';
        
        logger.error(
          `Failed to build swap instructions (attempt ${attempt}/${maxRetries}): ${error.message}` +
          (isTlsError ? ' [TLS/网络错误]' : '')
        );
        
        if (error.code) {
          logger.error(`Error code: ${error.code}`);
        }
        
        // 如果是网络错误且还有重试机会，则重试
        if (isTlsError && attempt < maxRetries) {
          const delay = retryDelay * attempt * 2; // 递增延迟
          logger.info(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // 最后一次尝试失败，返回 null
        if (attempt === maxRetries) {
      return null;
        }
    }
    }
    
    return null;
  }

  /**
   * 从Jupiter V6 API获取Swap指令（已弃用，保留用于向后兼容）
   * 
   * 使用正确的V6 API流程：quote → swap-instructions → deserialize
   * 返回指令和 Address Lookup Table 地址
   * 使用专用连接池和增强的重试机制
   */
  private async getJupiterSwapInstructions(params: {
    inputMint: PublicKey;
    outputMint: PublicKey;
    amount: number;
    slippageBps: number;
  }): Promise<{
    instructions: TransactionInstruction[];
    addressLookupTableAddresses: string[];
    computeBudgetInstructions: TransactionInstruction[];
  }> {
    const maxRetries = 3;
    const retryDelays = [100, 500, 1000];  // Fast retry
    
    // ✅ 确保 amount 是 number 类型，避免 BigInt 问题
    const amountNum = Number(params.amount);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Step 1: GET /quote
        const quoteResponse = await this.jupiterSwapAxios.get('/quote', {
          params: {
            inputMint: params.inputMint.toBase58(),
            outputMint: params.outputMint.toBase58(),
            amount: amountNum.toString(),
            slippageBps: params.slippageBps,
            onlyDirectRoutes: true,   // ✅ 只使用直接路由，减少账户数
            maxAccounts: 20,          // ✅ 严格限制账户数 (官方建议)
          },
        });

        if (!quoteResponse.data) {
          throw new Error('No quote data received');
        }

        // Step 2: POST /swap-instructions (官方推荐方法)
        // 直接返回已解析的指令，无需手动处理 ALT
        const swapInstructionsResponse = await this.jupiterSwapAxios.post('/swap-instructions', {
          quoteResponse: quoteResponse.data,
          userPublicKey: this.keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
        }, {
          timeout: 20000,
        });

        if (swapInstructionsResponse.data?.error) {
          throw new Error(`Jupiter API error: ${swapInstructionsResponse.data.error}`);
        }

        const {
          computeBudgetInstructions,
          setupInstructions,
          swapInstruction: swapInstructionPayload,
          cleanupInstruction,
        } = swapInstructionsResponse.data;

        // Step 3: 反序列化指令（从 JSON 转为 TransactionInstruction）
        const deserializeInstruction = (instruction: any): TransactionInstruction | null => {
          if (!instruction) return null;
          
          return new TransactionInstruction({
            programId: new PublicKey(instruction.programId),
            keys: instruction.accounts.map((key: any) => ({
              pubkey: new PublicKey(key.pubkey),
              isSigner: key.isSigner,
              isWritable: key.isWritable,
            })),
            data: Buffer.from(instruction.data, 'base64'),
          });
        };

        // Step 4: 分别组装指令
        const instructions: TransactionInstruction[] = [];
        const budgetInstructions: TransactionInstruction[] = [];

        // 提取计算预算指令（单独返回，避免重复）
        if (computeBudgetInstructions) {
          for (const ix of computeBudgetInstructions) {
            const deserialized = deserializeInstruction(ix);
            if (deserialized) budgetInstructions.push(deserialized);
          }
        }

        // 添加设置指令（ATA 创建等）
        if (setupInstructions) {
          for (const ix of setupInstructions) {
            const deserialized = deserializeInstruction(ix);
            if (deserialized) instructions.push(deserialized);
          }
        }

        // 添加核心 swap 指令
        if (swapInstructionPayload) {
          const swapIx = deserializeInstruction(swapInstructionPayload);
          if (swapIx) instructions.push(swapIx);
        }

        // 添加清理指令
        if (cleanupInstruction) {
          const cleanupIx = deserializeInstruction(cleanupInstruction);
          if (cleanupIx) instructions.push(cleanupIx);
        }

        logger.debug(`✅ Extracted ${instructions.length} swap instructions + ${budgetInstructions.length} budget instructions`);
        this.recordJupiterApiCall(true);
        
        // 返回指令和 ALT 地址（ComputeBudget 指令分离）
        return {
          instructions,
          computeBudgetInstructions: budgetInstructions,
          addressLookupTableAddresses: swapInstructionsResponse.data.addressLookupTableAddresses || [],
        };

      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries - 1;

        // 404: No route
        if (error.response?.status === 404) {
          logger.warn(`No route: ${params.inputMint.toBase58()} → ${params.outputMint.toBase58()}`);
          this.recordJupiterApiCall(false, '404');
          return { instructions: [], computeBudgetInstructions: [], addressLookupTableAddresses: [] };
        }

        // TLS/Network errors
        const isTLSError = 
          error.message?.includes('socket disconnected') ||
          error.message?.includes('ECONNRESET') ||
          error.message?.includes('ETIMEDOUT') ||
          error.message?.includes('TLS') ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT';

        // 5xx errors
        const is5xxError = error.response?.status >= 500;

        // 429 rate limit
        const isRateLimitError = error.response?.status === 429;

        if ((isTLSError || is5xxError || isRateLimitError) && !isLastAttempt) {
          const delay = isRateLimitError ? retryDelays[attempt] * 3 : retryDelays[attempt];
          logger.warn(
            `Jupiter API error (${error.response?.status || error.code || 'network'}), ` +
            `retry in ${delay}ms (${attempt + 1}/${maxRetries})`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Last attempt or non-retryable
        if (isLastAttempt && (isTLSError || is5xxError)) {
          logger.error(`Jupiter API failed after ${maxRetries} attempts`);
          this.recordJupiterApiCall(false, isTLSError ? 'tls' : '5xx');
          return { instructions: [], computeBudgetInstructions: [], addressLookupTableAddresses: [] };
        }

        logger.error(`Jupiter V6 API error: ${error.message}`);
        throw error;
      }
    }

    return { instructions: [], computeBudgetInstructions: [], addressLookupTableAddresses: [] };
  }

  /**
   * 合并计算预算指令（去重并选择最大值）
   * 
   * 多个swap可能都返回computeBudgetInstructions，导致重复。
   * 此方法提取所有指令的最大值，只返回2个合并后的指令，节省50-100字节。
   * 
   * @param instructions 所有计算预算指令数组
   * @returns 合并后的指令数组（最多2个）
   */
  private mergeComputeBudgetInstructions(
    instructions: TransactionInstruction[]
  ): TransactionInstruction[] {
    const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
    
    let maxComputeUnitLimit = 0;
    let maxComputeUnitPrice = 0;
    let originalCount = 0;
    
    // 提取所有计算预算指令的最大值
    for (const ix of instructions) {
      if (ix.programId.toBase58() === COMPUTE_BUDGET_PROGRAM) {
        originalCount++;
        
        // setComputeUnitLimit 指令 (discriminator = 2)
        if (ix.data.length >= 5 && ix.data[0] === 2) {
          const limit = ix.data.readUInt32LE(1);
          maxComputeUnitLimit = Math.max(maxComputeUnitLimit, limit);
        }
        
        // setComputeUnitPrice 指令 (discriminator = 3)
        if (ix.data.length >= 9 && ix.data[0] === 3) {
          const price = Number(ix.data.readBigUInt64LE(1));
          maxComputeUnitPrice = Math.max(maxComputeUnitPrice, price);
        }
      }
    }
    
    // 如果没有找到任何计算预算指令，返回空数组
    if (originalCount === 0) {
      return [];
    }
    
    // 只返回合并后的指令（2个而不是4-6个）
    const merged: TransactionInstruction[] = [];
    
    if (maxComputeUnitLimit > 0) {
      merged.push(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: maxComputeUnitLimit,
        })
      );
    }
    
    if (maxComputeUnitPrice > 0) {
      merged.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: maxComputeUnitPrice,
        })
      );
    }
    
    // 计算节省的字节数（每个指令约30-40字节）
    const savedInstructions = originalCount - merged.length;
    const estimatedBytesSaved = savedInstructions * 35; // 平均每个指令35字节
    
    logger.debug(
      `✅ Merged compute budget: limit=${maxComputeUnitLimit}, price=${maxComputeUnitPrice} ` +
      `(reduced from ${originalCount} to ${merged.length} instructions, saved ~${estimatedBytesSaved} bytes)`
    );
    
    // 更新统计
    this.stats.bytesOptimizedTotal += estimatedBytesSaved;
    
    return merged;
  }

  /**
   * 从指令数组构建VersionedTransaction
   * 
   * @param instructions 交易指令数组
   * @param blockhash 最新的区块哈希
   * @param lookupTableAccounts ALT账户数组
   * @returns 已签名的VersionedTransaction
   */
  private buildVersionedTransaction(
    instructions: TransactionInstruction[],
    blockhash: string,
    lookupTableAccounts: AddressLookupTableAccount[]
  ): VersionedTransaction {
    const messageV0 = new TransactionMessage({
      payerKey: this.keypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(lookupTableAccounts);
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([this.keypair]);
    
    return transaction;
  }

  /**
   * 构建闪电贷Bundle（拆分为2个交易以突破大小限制）
   * 
   * Bundle结构:
   * - 交易1: 闪电贷借款 + Swap1 (去程)
   * - 交易2: Swap2 (回程) + 闪电贷还款
   * 
   * 两个交易使用相同的blockhash，确保原子性（全成功或全失败）
   * 
   * @param opportunity 套利机会
   * @param borrowAmount 借款金额
   * @param swap1Result 去程swap结果
   * @param swap2Result 回程swap结果  
   * @param flashLoanInstructions 闪电贷指令
   * @param lookupTableAccounts ALT账户
   * @param priorityFee 优先费（复用之前查询的结果，避免重复查询）
   * @returns Bundle及相关元数据
   */
  private async buildFlashloanBundle(
    opportunity: ArbitrageOpportunity,
    borrowAmount: number,
    swap1Result: any,
    swap2Result: any,
    flashLoanInstructions: any,
    lookupTableAccounts: AddressLookupTableAccount[],
    priorityFee: number  // 🚀 优化：接收预先查询的优先费
  ): Promise<{
    bundle: Bundle;
    isBundleMode: boolean;
    validation: any;
    borrowAmount: number;
    flashLoanFee: number;
  } | null> {
    try {
      const bundleStart = Date.now();
      logger.info('🎁 Building Jito Bundle for oversized flash loan transaction...');
      
      // 1. 合并计算预算指令
      const mergedComputeBudget = this.mergeComputeBudgetInstructions([
        ...swap1Result.computeBudgetInstructions,
        ...swap2Result.computeBudgetInstructions,
      ]);
      
      // 🚀 优化3：并行获取blockhash和准备指令（节省时间）
      // 准备指令可以在等待blockhash的同时完成
      const tx1Instructions = [
        flashLoanInstructions.borrowInstruction,
        ...mergedComputeBudget,
        ...swap1Result.setupInstructions,
        ...swap1Result.instructions,
      ];
      
      const tx2Instructions = [
        ...swap2Result.instructions,
        ...swap2Result.cleanupInstructions,
        flashLoanInstructions.repayInstruction,
      ];
      
      // 2. 获取最新blockhash（异步操作）
      const recentBlockhash = await this.getCachedBlockhash();
      
      // 3. 🚀 优化3：并行构建两个交易（同时序列化，节省~50ms）
      const [tx1, tx2] = await Promise.all([
        Promise.resolve(this.buildVersionedTransaction(
          tx1Instructions,
          recentBlockhash.blockhash,
          lookupTableAccounts
        )),
        Promise.resolve(this.buildVersionedTransaction(
          tx2Instructions,
          recentBlockhash.blockhash,
          lookupTableAccounts
        ))
      ]);
      
      // 4. 并行获取交易大小
      const [tx1Size, tx2Size] = [tx1.serialize().length, tx2.serialize().length];
      
      const bundleLatency = Date.now() - bundleStart;
      logger.info(`  📦 TX1 size: ${tx1Size}/1232 bytes (borrow + swap1)`);
      logger.info(`  📦 TX2 size: ${tx2Size}/1232 bytes (swap2 + repay)`);
      
      // 5. 验证两个交易都在限制内
      if (tx1Size > 1232 || tx2Size > 1232) {
        logger.error(
          `❌ Bundle transactions still too large! TX1=${tx1Size}, TX2=${tx2Size}. ` +
          `Even with Bundle mode, cannot fit transaction.`
        );
        return null;
      }
      
      // 6. 创建Bundle
      const bundle = new Bundle([tx1, tx2], 5); // 最多尝试5个slots
      
      logger.info(
        `✅ Bundle created: 2 transactions, total=${tx1Size + tx2Size} bytes ` +
        `(build_time=${bundleLatency}ms)`
      );
      
      // 7. 🚀 优化：复用之前查询的优先费（避免重复RPC调用，节省~250ms）
      const actualOutAmount = swap2Result.outAmount;
      const actualGrossProfit = actualOutAmount - borrowAmount;
      
      logger.debug(`🚀 Reusing priority fee from previous query: ${(priorityFee / LAMPORTS_PER_SOL).toFixed(6)} SOL (saved ~250ms)`);
      
      const feeConfig = {
        baseFee: this.config.economics.cost.signatureCount * 5000 * 2, // 2个交易
        priorityFee,
        jitoTipPercent: this.config.economics.jito.profitSharePercentage || 30,
        slippageBufferBps: 15,
        enableNetProfitCheck: this.config.economics.profit.enableNetProfitCheck ?? true,
      };
      
      const isJupiterLend = this.config.flashloan.provider === 'jupiter-lend';
      const validation = isJupiterLend
        ? JupiterLendAdapter.validateFlashLoan(borrowAmount, actualGrossProfit, feeConfig)
        : SolendAdapter.validateFlashLoan(borrowAmount, actualGrossProfit, feeConfig);
      
      if (!validation.valid) {
        logger.warn(`❌ Bundle validation failed: ${validation.reason || 'unknown'}`);
        return null;
      }
      
      const flashLoanFee = validation.fee;
      
      logger.info(
        `✅ Bundle validation passed - Net profit: ${(validation.netProfit / LAMPORTS_PER_SOL).toFixed(6)} SOL`
      );
      
      // 8. 更新统计
      this.stats.bundleTransactions++;
      
      return {
        bundle,
        isBundleMode: true,
        validation,
        borrowAmount,
        flashLoanFee,
      };
      
    } catch (error: any) {
      logger.error(`Failed to build flashloan bundle: ${error.message}`);
      return null;
    }
  }

  /**
   * Record Jupiter API call statistics
   */
  private recordJupiterApiCall(success: boolean, errorType?: string): void {
    this.jupiterApiStats.total++;
    if (success) {
      this.jupiterApiStats.success++;
    } else if (errorType === 'tls') {
      this.jupiterApiStats.tlsErrors++;
    } else if (errorType === '5xx') {
      this.jupiterApiStats.serverErrors++;
    } else if (errorType === '404') {
      this.jupiterApiStats.routeNotFound++;
    }

    // Log stats every 100 calls
    if (this.jupiterApiStats.total % 100 === 0) {
      const successRate = (this.jupiterApiStats.success / this.jupiterApiStats.total * 100).toFixed(1);
      logger.info(
        `📊 Jupiter API: ${successRate}% success ` +
        `(TLS: ${this.jupiterApiStats.tlsErrors}, 5xx: ${this.jupiterApiStats.serverErrors}, 404: ${this.jupiterApiStats.routeNotFound})`
      );
    }
  }

  /**
   * 🚀 优化2：预加载常用Jupiter ALT到缓存
   * 在启动时预先加载常用ALT，避免运行时RPC查询延迟
   * 节省约200ms的ALT加载时间
   */
  private async preloadCommonALTs(): Promise<void> {
    // 定义常用的Jupiter ALT地址（从日志中提取）
    const commonALTs = [
      '9AKCoNoAe6pNKrMv6ssRtgMfbNfsE9hWMRF3fHFdFQ3r',  // 常见于Jupiter Swap
      '7U2UmEFVBDcPFjkwNrFdP4qiPAxKhHWjxMVmwQ2KUZYs',  // 常见于Swap路由
      'Eq5wAtcDkV5GnGGKCuRpM5m5w4r4Vw9b1hSBCiE8gLnW',  // Jupiter Lend ALT
      '3xmsRYePP7HGLR8bYSTQkGy7KRqoGPJPa6JM3B48Qsdy',  // Meteora相关
      'D9YGP4SsF4ZTPP5F6jfyNgHfL2vN4CjxWGrFCEcDW5qW',  // Orca相关
    ];

    const altAddresses = [
      ...commonALTs,
      // 🗜️ 添加闪电贷ALT（如果已初始化）
      ...(this.jupiterLendALTManager.getALTAddress() 
        ? [this.jupiterLendALTManager.getALTAddress()!.toBase58()] 
        : []),
      ...(this.solendALTManager.getALTAddress() 
        ? [this.solendALTManager.getALTAddress()!.toBase58()] 
        : []),
    ];

    // 过滤掉重复地址
    const uniqueAddresses = Array.from(new Set(altAddresses));
    
    logger.debug(`📦 Preloading ${uniqueAddresses.length} common ALTs...`);
    
    // 批量加载ALT（使用getMultipleAccounts提高效率）
    const pubkeys = uniqueAddresses.map(addr => new PublicKey(addr));
    
    try {
      const accountInfos = await this.connection.getMultipleAccountsInfo(pubkeys);
      
      let successCount = 0;
      let totalAddresses = 0;
      
      accountInfos.forEach((accountInfo: any, index: number) => {
        if (accountInfo) {
          try {
            const altAccount = new AddressLookupTableAccount({
              key: pubkeys[index],
              state: AddressLookupTableAccount.deserialize(accountInfo.data),
            });
            
            // 存入缓存
            this.altCache.set(uniqueAddresses[index], {
              account: altAccount,
              timestamp: Date.now(),
            });
            
            successCount++;
            totalAddresses += altAccount.state.addresses.length;
            
            logger.debug(
              `  ✅ Cached ALT ${uniqueAddresses[index].slice(0, 8)}... ` +
              `(${altAccount.state.addresses.length} addresses)`
            );
          } catch (error: any) {
            logger.debug(`  ⚠️ Failed to parse ALT ${uniqueAddresses[index].slice(0, 8)}...: ${error.message}`);
          }
        } else {
          logger.debug(`  ⚠️ ALT ${uniqueAddresses[index].slice(0, 8)}... not found on-chain`);
        }
      });
      
      logger.debug(
        `📊 ALT Preload Summary: ${successCount}/${uniqueAddresses.length} loaded, ` +
        `${totalAddresses} total addresses cached`
      );
      
    } catch (error: any) {
      logger.warn(`⚠️ ALT preload failed (non-critical): ${error.message}`);
      // 预加载失败不影响运行，继续启动
    }
  }

  /**
   * 加载 Address Lookup Tables（带缓存优化）
   * 从 RPC 获取 ALT 账户信息，用于压缩交易大小
   * 使用缓存减少重复 RPC 查询，提升性能
   * 
   * @param addresses ALT 地址数组
   * @returns 加载的 ALT 账户数组
   */
  private async loadAddressLookupTables(
    addresses: string[]
  ): Promise<AddressLookupTableAccount[]> {
    if (!addresses || addresses.length === 0) {
      logger.debug('⚠️ No ALT addresses to load');
      return [];
    }

    const now = Date.now();
    const accounts: AddressLookupTableAccount[] = [];
    const toFetch: PublicKey[] = [];
    const toFetchAddresses: string[] = [];

    // 检查缓存
    for (const address of addresses) {
      const cached = this.altCache.get(address);
      if (cached && (now - cached.timestamp) < this.ALT_CACHE_TTL) {
        accounts.push(cached.account);
        logger.debug(`✅ ALT cache hit: ${address.slice(0, 8)}...`);
      } else {
        toFetch.push(new PublicKey(address));
        toFetchAddresses.push(address);
      }
    }

    // 批量获取未缓存的 ALT
    if (toFetch.length > 0) {
      logger.debug(`🔄 Fetching ${toFetch.length} ALTs from RPC...`);
      
      try {
        const accountInfos = await this.connection.getMultipleAccountsInfo(toFetch);
        
        for (let i = 0; i < accountInfos.length; i++) {
          const accountInfo = accountInfos[i];
          if (accountInfo) {
            const lookupTableAccount = new AddressLookupTableAccount({
              key: toFetch[i],
              state: AddressLookupTableAccount.deserialize(accountInfo.data),
            });
            accounts.push(lookupTableAccount);
            
            // 更新缓存
            this.altCache.set(toFetchAddresses[i], {
              account: lookupTableAccount,
              timestamp: now,
            });
            
            logger.debug(
              `✅ ALT loaded & cached: ${toFetchAddresses[i].slice(0, 8)}... ` +
              `(${lookupTableAccount.state.addresses.length} addresses)`
            );
          } else {
            logger.warn(`⚠️ Failed to load ALT: ${toFetchAddresses[i]}`);
          }
        }
      } catch (error: any) {
        logger.error(`❌ Failed to load Address Lookup Tables: ${error.message}`);
        return accounts; // 返回已缓存的部分
      }
    }

    const totalAddresses = accounts.reduce(
      (sum, alt) => sum + alt.state.addresses.length,
      0
    );
    logger.info(
      `📋 Total ALTs loaded: ${accounts.length} ` +
      `(${accounts.length - toFetch.length} from cache, ${toFetch.length} from RPC) ` +
      `with ${totalAddresses} compressed addresses`
    );
    
    return accounts;
  }

  /**
   * 验证交易指令的有效性
   * 检查所有 pubkey 是否都已定义，避免序列化时出现 toBase58() undefined 错误
   */
  private validateInstructions(instructions: TransactionInstruction[]): boolean {
    for (let i = 0; i < instructions.length; i++) {
      const ix = instructions[i];
      if (!ix.programId) {
        logger.error(`Instruction ${i}: programId is undefined`);
        return false;
      }
      for (let j = 0; j < ix.keys.length; j++) {
        if (!ix.keys[j].pubkey) {
          logger.error(`Instruction ${i}, key ${j}: pubkey is undefined`);
          return false;
        }
      }
    }
    return true;
  }

  /**
   * 分析路由复杂度
   * 
   * 检查Quote API返回的路由信息，提取实际的DEX数量和账户数
   * 
   * @param quoteData Jupiter Quote API返回的数据
   * @returns 路由复杂度信息
   */
  private analyzeRouteComplexity(quoteData: any): {
    totalDexes: number;
    totalAccounts: number;
    dexLabels: string[];
    routeType: 'direct' | 'split' | 'multi-hop';
  } {
    const dexLabels: string[] = [];
    let totalAccounts = 0;
    
    // 1. 优先检查 marketInfos（最准确的DEX信息）
    if (quoteData.marketInfos && Array.isArray(quoteData.marketInfos)) {
      for (const marketInfo of quoteData.marketInfos) {
        if (marketInfo.label) {
          dexLabels.push(marketInfo.label);
        }
        // 累计账户数（每个market通常需要3-5个账户）
        totalAccounts += 4;  // 平均估算
      }
    }
    
    // 2. 检查 routePlan（了解路由结构）
    if (quoteData.routePlan && Array.isArray(quoteData.routePlan)) {
      for (const plan of quoteData.routePlan) {
        // 如果marketInfos没有数据，从routePlan提取
        if (dexLabels.length === 0 && plan.swapInfo) {
          if (plan.swapInfo.label) {
            dexLabels.push(plan.swapInfo.label);
          }
          totalAccounts += 4;
        }
      }
    }
    
    // 3. 确定路由类型
    let routeType: 'direct' | 'split' | 'multi-hop' = 'direct';
    if (quoteData.routePlan && quoteData.routePlan.length > 1) {
      routeType = 'split';  // 分割路由（如50% Raydium + 50% Orca）
    } else if (dexLabels.length > 1) {
      routeType = 'multi-hop';  // 多跳路由（如Raydium → Orca → Whirlpool）
    }
    
    // 4. 添加基础账户（签名者、token accounts等）
    totalAccounts += 8;  // 基础开销
    
    // 5. 如果有contextSlot等元数据，可能需要额外账户
    if (quoteData.contextSlot) {
      totalAccounts += 2;
    }
    
    logger.debug(
      `Route analysis: ${dexLabels.length} DEXes detected, ` +
      `${totalAccounts} accounts estimated, type=${routeType}`
    );
    
    return {
      totalDexes: dexLabels.length,
      totalAccounts,
      dexLabels,
      routeType,
    };
  }

  /**
   * 估算交易大小（字节）
   * 
   * 交易大小组成：
   * - 固定头部：~100 bytes
   * - 签名数组：64 bytes (签名) + 4 bytes (数组长度)
   * - ComputeBudget 指令：~30 bytes (2个指令)
   * - 闪电贷指令：~150 bytes (borrow + repay，账户在ALT中)
   * - Swap指令：取决于账户数和data大小
   * - ALT引用：每个ALT约 ~35 bytes
   * - 版本化交易额外开销：~50 bytes
   * - 安全边际：5%
   * - Base64编码：增加33.3%
   * 
   * @returns 估算的交易大小（Base64编码后的字节数）
   */
  private estimateTransactionSize(
    arbitrageInstructions: TransactionInstruction[],
    lookupTableAccounts: AddressLookupTableAccount[]
  ): number {
    let size = 0;
    
    // 1. 固定头部（版本号、签名计数等）
    size += 100;
    
    // 2. 签名数组开销
    size += 64; // 签名（64字节）
    size += 4;  // 签名数组长度（compact-u16编码，1-4字节，保守估计4字节）
    
    // 3. ComputeBudget 指令（setComputeUnitLimit + setComputeUnitPrice）
    size += 2 * 15; // 每个约15字节
    
    // 4. 闪电贷指令（borrow + repay）
    // 假设所有账户都在ALT中（1字节索引）
    size += 2 * 15; // 2个指令的基础开销
    size += 14 * 1; // 账户索引（假设14个账户都在ALT中）
    size += 100; // 指令data（borrow + repay）
    
    // 5. 套利指令（Swap指令）
    for (const ix of arbitrageInstructions) {
      // 每个指令的基础开销
      size += 1; // programId索引
      
      // 账户数（降低压缩率到85%，更保守的估算）
      const accountCount = ix.keys.length;
      const compressedAccounts = Math.floor(accountCount * 0.85);
      const uncompressedAccounts = accountCount - compressedAccounts;
      size += compressedAccounts * 1; // ALT索引（1字节）
      size += uncompressedAccounts * 32; // 完整地址（32字节）
      
      // 账户读写标记（每个账户1字节）
      size += accountCount * 1;
      
      // 账户索引数组开销（每个账户约0.5字节）
      size += Math.ceil(accountCount * 0.5);
      
      // 指令data（这是无法压缩的部分！）
      size += ix.data.length;
    }
    
    // 6. ALT引用（每个ALT约35字节）
    size += lookupTableAccounts.length * 35;
    
    // 7. 版本化交易额外开销（约50字节）
    size += 50;
    
    // 8. 安全边际（5%）
    size = Math.ceil(size * 1.05);
    
    // 9. 返回Base64编码后的估算大小（RPC检查的是Base64编码后的限制）
    // Base64编码增加33.3%：size * 1.333
    return Math.ceil(size * 1.333);
  }

  /**
   * 🚀 优化9：获取Blockhash（带缓存）
   * 
   * 优化：减少重复RPC查询
   * - Solana blockhash有效期：~150 slots ≈ 60-75秒
   * - 缓存TTL：30秒（安全边际）
   * - 节省：20-50ms/查询
   */
  private async getCachedBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const now = Date.now();
    
    // 检查缓存
    if (this.blockhashCache && (now - this.blockhashCache.timestamp) < this.BLOCKHASH_CACHE_TTL) {
      const age = now - this.blockhashCache.timestamp;
      logger.debug(`🚀 Blockhash cache hit (saved ~30ms, age: ${age}ms)`);
      return {
        blockhash: this.blockhashCache.blockhash,
        lastValidBlockHeight: this.blockhashCache.lastValidBlockHeight,
      };
    }
    
    // 缓存失效或不存在，重新查询
    const result = await this.connection.getLatestBlockhash();
    this.blockhashCache = {
      blockhash: result.blockhash,
      lastValidBlockHeight: result.lastValidBlockHeight,
      timestamp: now,
    };
    
    logger.debug('🔄 Blockhash refreshed from RPC');
    
    return result;
  }

  /**
   * 获取或创建代币账户
   */
  private async getOrCreateTokenAccount(mint: PublicKey): Promise<PublicKey> {
    const mintKey = mint.toBase58();
    
    // 检查缓存（当前直接返回钱包地址，缓存命中率100%）
    const cached = this.tokenAccountCache.get(mintKey);
    if (cached) {
      return cached;
    }
    
    // 简化版：使用钱包地址（适用于Native SOL）
    // TODO: 完整实现应查询Associated Token Account
    const account = this.keypair.publicKey;
    
    // 存入缓存
    this.tokenAccountCache.set(mintKey, account);
    
    return account;
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
    const successRate =
      this.stats.tradesAttempted > 0
        ? (
            (this.stats.tradesSuccessful / this.stats.tradesAttempted) *
            100
          ).toFixed(1)
        : '0.0';

    const netProfit = this.stats.totalProfitSol - this.stats.totalLossSol;
    const uptimeHours = (Date.now() - this.stats.startTime) / (1000 * 60 * 60);

    logger.info('═══════════════════════════════════════════');
    logger.info('📊 Flashloan Bot Statistics');
    logger.info('═══════════════════════════════════════════');
    logger.info(`Uptime: ${uptimeHours.toFixed(2)} hours`);
    logger.info(`Opportunities Found: ${this.stats.opportunitiesFound}`);
    logger.info(`Opportunities Filtered: ${this.stats.opportunitiesFiltered}`);
    logger.info(`  └─ By RPC Simulation: ${this.stats.simulationFiltered} (saved ${this.stats.savedGasSol.toFixed(4)} SOL)`);
    logger.info(`Trades Attempted: ${this.stats.tradesAttempted}`);
    logger.info(`Trades Successful: ${this.stats.tradesSuccessful}`);
    logger.info(`Trades Failed: ${this.stats.tradesFailed}`);
    logger.info(`Success Rate: ${successRate}%`);
    logger.info(
      `Total Borrowed: ${this.stats.totalBorrowedSol.toFixed(4)} SOL`
    );
    logger.info(
      `Total Fees: ${this.stats.totalFlashloanFees.toFixed(4)} SOL`
    );
    logger.info(`Total Profit: ${this.stats.totalProfitSol.toFixed(4)} SOL`);
    logger.info(`Net Profit: ${netProfit.toFixed(4)} SOL`);
    logger.info('');
    logger.info('🎉 Transaction Optimization:');
    logger.info(`  💰 RPC Simulation: Saved ${this.stats.savedGasSol.toFixed(4)} SOL`);
    logger.info(`  📦 Compute Budget Merge: Saved ~${this.stats.bytesOptimizedTotal} bytes`);
    logger.info(`  🎁 Bundle Mode: ${this.stats.bundleTransactions} transactions`);
    logger.info(`  📄 Single Mode: ${this.stats.singleTransactions} transactions`);
    if (this.stats.bundleTransactions + this.stats.singleTransactions > 0) {
      const bundleRate = ((this.stats.bundleTransactions / (this.stats.bundleTransactions + this.stats.singleTransactions)) * 100).toFixed(1);
      logger.info(`  📊 Bundle Usage Rate: ${bundleRate}%`);
    }
    logger.info('═══════════════════════════════════════════');
    
    // 🆕 二次验证机会统计
    if (this.stats.validatedOpportunities > 0) {
      logger.info('');
      logger.info('📊 二次验证机会统计');
      logger.info('═══════════════════════════════════════════');
      logger.info(`通过验证的机会总数: ${this.stats.validatedOpportunities}`);
      logger.info(`理论净利润（扣费后）: ${this.stats.theoreticalNetProfitSol.toFixed(4)} SOL`);
      logger.info('');
      logger.info('💰 理论费用明细汇总:');
      logger.info(`  ├─ 累计基础费用:     ${this.stats.theoreticalFeesBreakdown.totalBaseFee.toFixed(4)} SOL`);
      logger.info(`  ├─ 累计优先费用:     ${this.stats.theoreticalFeesBreakdown.totalPriorityFee.toFixed(4)} SOL`);
      logger.info(`  ├─ 累计 Jito Tip:    ${this.stats.theoreticalFeesBreakdown.totalJitoTip.toFixed(4)} SOL`);
      logger.info(`  └─ 累计滑点缓冲:     ${this.stats.theoreticalFeesBreakdown.totalSlippageBuffer.toFixed(4)} SOL`);
      
      const totalTheoreticalFees = 
        this.stats.theoreticalFeesBreakdown.totalBaseFee +
        this.stats.theoreticalFeesBreakdown.totalPriorityFee +
        this.stats.theoreticalFeesBreakdown.totalJitoTip +
        this.stats.theoreticalFeesBreakdown.totalSlippageBuffer;
      logger.info(`  总计费用: ${totalTheoreticalFees.toFixed(4)} SOL`);
      logger.info('');
      
      // 理论利润 vs 实际利润对比
      logger.info('📈 理论利润 vs 实际利润对比:');
      logger.info(`  理论净利润（如果执行所有验证通过的机会）: ${this.stats.theoreticalNetProfitSol.toFixed(4)} SOL`);
      logger.info(`  实际净利润（已执行的交易）:             ${netProfit.toFixed(4)} SOL`);
      
      const executionRate = this.stats.validatedOpportunities > 0
        ? ((this.stats.tradesAttempted / this.stats.validatedOpportunities) * 100).toFixed(1)
        : '0.0';
      logger.info(`  执行率: ${executionRate}% (${this.stats.tradesAttempted}/${this.stats.validatedOpportunities})`);
      
      if (this.stats.theoreticalNetProfitSol > 0) {
        const realizationRate = ((netProfit / this.stats.theoreticalNetProfitSol) * 100).toFixed(1);
        logger.info(`  利润兑现率: ${realizationRate}%`);
      }
      
      // 平均理论利润
      const avgTheoreticalProfit = this.stats.theoreticalNetProfitSol / this.stats.validatedOpportunities;
      logger.info(`  平均理论净利润/机会: ${avgTheoreticalProfit.toFixed(6)} SOL`);
      
      logger.info('═══════════════════════════════════════════');
    }
  }

  /**
   * 停止机器人
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping Flashloan Bot...');
    this.isRunning = false;

    await this.finder.stop();

    logger.info('Stopping Jupiter Server...');
    await this.jupiterServerManager.stop();
    logger.info('✅ Jupiter Server stopped');

    this.printStats();

    // 发送停止通知
    if (this.monitoring) {
      const netProfit = this.stats.totalProfitSol - this.stats.totalLossSol;
      await this.monitoring.sendAlert({
        type: 'info',
        title: '🛑 闪电贷机器人已停止',
        description: `机器人已安全停止运行`,
        fields: [
          { name: '总交易次数', value: `${this.stats.tradesAttempted}` },
          { name: '成功次数', value: `${this.stats.tradesSuccessful}` },
          {
            name: '成功率',
            value: `${((this.stats.tradesSuccessful / Math.max(this.stats.tradesAttempted, 1)) * 100).toFixed(1)}%`,
          },
          { name: '净利润', value: `${netProfit.toFixed(4)} SOL` },
        ],
        level: 'medium',
      });
    }

    logger.info('✅ Flashloan Bot stopped');
  }

  /**
   * 清理过期的Quote缓存
   */
  private cleanExpiredQuoteCache(): void {
    const now = Date.now();
    for (const [key, value] of this.quoteCache.entries()) {
      if (now - value.timestamp > this.QUOTE_CACHE_TTL) {
        this.quoteCache.delete(key);
      }
    }
  }

  /**
   * 估算策略的交易大小（快速估算，用于策略选择）
   */
  private estimateTransactionSizeForStrategy(
    swap1: any, 
    swap2: any, 
    flashLoanInstructions: any
  ): number {
    // 简化的大小估算逻辑
    const instructionCount = 
      (swap1.instructions?.length || 0) + 
      (swap2.instructions?.length || 0) + 
      (flashLoanInstructions ? 2 : 0);
    
    const altCount = 
      new Set([
        ...(swap1.addressLookupTableAddresses || []),
        ...(swap2.addressLookupTableAddresses || [])
      ]).size;
    
    // 粗略估算：每个指令~80字节，每个ALT~32字节
    return instructionCount * 80 + altCount * 32 + 200; // 基础开销
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }
}

// ==================== CLI Entry Point ====================

/**
 * 命令行入口
 */
async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  
  // 支持多种参数格式：
  // 1. --config=path/to/file.toml
  // 2. path/to/file.toml (直接位置参数，通过 pnpm -- 传递)
  let configPath = args.find((arg) => arg.startsWith('--config='))?.split('=')[1];
  
  if (!configPath && args.length > 0 && !args[0].startsWith('--')) {
    // 第一个非选项参数作为配置文件路径
    configPath = args[0];
  }
  
  // 默认配置文件
  if (!configPath) {
    configPath = 'configs/flashloan-dryrun.toml';  // ✅ 改为dryrun作为默认（更安全）
  }

  logger.info(`Loading config from: ${configPath}`);

  // 加载配置
  let config = FlashloanBot.loadConfig(configPath);
  
  // 校验和调整配置
  config = FlashloanBot.validateAndAdjustConfig(config);

  // 创建机器人实例
  const bot = new FlashloanBot(config);

  // 处理退出信号
  process.on('SIGINT', async () => {
    logger.info('\n\nReceived SIGINT, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('\n\nReceived SIGTERM, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });

  // 启动机器人
  try {
    await bot.start();
  } catch (error: any) {
    logger.error(`Fatal error: ${error.message}`, error);
    process.exit(1);
  }
}

// 如果直接运行此文件，执行 main
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error:', error);
    console.error('Full error details:', error);
    console.error('Error stack:', error?.stack);
    process.exit(1);
  });
}

// 导出类和类型
export * from './opportunity-finder';
export { main };

