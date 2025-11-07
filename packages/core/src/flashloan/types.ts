/**
 * 闪电贷类型定义
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';

/**
 * 支持的闪电贷协议
 */
export enum FlashLoanProtocol {
  SOLEND = 'solend',
  JUPITER_LEND = 'jupiter-lend',
  MANGO = 'mango',
  MARGINFI = 'marginfi',
}

/**
 * 闪电贷配置
 */
export interface FlashLoanConfig {
  /** 协议类型 */
  protocol: FlashLoanProtocol;
  /** 借款金额（lamports） */
  amount: number;
  /** 借款代币的mint地址 */
  tokenMint: PublicKey;
  /** 费率（由协议决定，通常0.09%） */
  feeRate?: number;
}

/**
 * 闪电贷结果
 */
export interface FlashLoanResult {
  /** 借款指令 */
  borrowInstruction: TransactionInstruction;
  /** 还款指令 */
  repayInstruction: TransactionInstruction;
  /** 借款金额 */
  borrowAmount: number;
  /** 还款金额（包含费用） */
  repayAmount: number;
  /** 手续费 */
  fee: number;
  /** 需要的额外账户 */
  additionalAccounts: PublicKey[];
}

/**
 * Solend储备信息
 */
export interface SolendReserve {
  /** 储备账户地址 */
  address: PublicKey;
  /** 代币mint */
  liquidityMint: PublicKey;
  /** 流动性供应账户 */
  liquiditySupply: PublicKey;
  /** 流动性手续费接收账户 */
  liquidityFeeReceiver: PublicKey;
  /** 抵押品mint */
  collateralMint: PublicKey;
  /** 抵押品供应账户 */
  collateralSupply: PublicKey;
  /** 贷款市场 */
  lendingMarket: PublicKey;
  /** 贷款市场授权账户 */
  lendingMarketAuthority: PublicKey;
}

/**
 * 原子套利交易配置
 */
export interface AtomicArbitrageConfig {
  /** 是否使用闪电贷 */
  useFlashLoan: boolean;
  /** 闪电贷配置 */
  flashLoanConfig?: FlashLoanConfig;
  /** 预构建的闪电贷指令（用于Jupiter Lend等需要异步构建的协议） */
  flashLoanInstructions?: FlashLoanResult;
  /** 套利交易指令（在借款和还款之间执行） */
  arbitrageInstructions: TransactionInstruction[];
  /** 钱包公钥 */
  wallet: PublicKey;
}

/**
 * 闪电贷费用配置
 */
export interface FlashLoanFeeConfig {
  /** 基础交易费 (signature_count × 5000 lamports) */
  baseFee: number;
  /** 优先费 (从 PriorityFeeEstimator 动态获取) */
  priorityFee: number;
  /** Jito Tip 百分比 (例如: 30 表示 30%) */
  jitoTipPercent: number;
  /** 滑点缓冲 (基点, 例如: 15 表示 0.15%) */
  slippageBufferBps: number;
  /** 是否启用净利润检查（默认 true） */
  enableNetProfitCheck?: boolean;
}

/**
 * 闪电贷验证结果
 */
export interface FlashLoanValidationResult {
  /** 是否有效（净利润为正） */
  valid: boolean;
  /** 闪电贷费用（Jupiter Lend 为 0） */
  fee: number;
  /** 净利润（扣除所有费用后） */
  netProfit: number;
  /** 拒绝原因（如果无效） */
  reason?: string;
  /** 费用拆解详情 */
  breakdown?: {
    /** 毛利润（Jupiter 返回的价差） */
    grossProfit: number;
    /** 基础交易费 */
    baseFee: number;
    /** 优先费 */
    priorityFee: number;
    /** Jito Tip */
    jitoTip: number;
    /** 滑点缓冲 */
    slippageBuffer: number;
    /** 净利润 */
    netProfit: number;
  };
}
