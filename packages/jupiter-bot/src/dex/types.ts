/**
 * DEX构建器类型定义
 * 完全跳过Legacy API，直接使用Worker的routePlan构建交易指令
 */

import { PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';

/**
 * DEX构建器接口
 */
export interface IDEXBuilder {
  /**
   * Build swap instruction from route step
   * @param routeStep Single step from routePlan
   * @param userPubkey User's public key
   * @param amount Input amount in lamports
   * @param slippageBps Slippage in basis points
   * @returns TransactionInstruction
   */
  buildSwap(
    routeStep: RouteStep,
    userPubkey: PublicKey,
    amount: number,
    slippageBps: number
  ): Promise<TransactionInstruction>;

  /**
   * Check if this builder can handle the given route step
   * @param routeStep Route step to validate
   * @returns true if supported
   */
  canBuild(routeStep: RouteStep): boolean;

  /**
   * Get required accounts for preloading
   * @param routeStep Route step
   * @returns Array of required account public keys
   */
  getRequiredAccounts(routeStep: RouteStep): PublicKey[];
}

/**
 * Route step from Worker (Jupiter API format)
 */
export interface RouteStep {
  swapInfo: {
    amm: string;          // Pool address
    label: string;        // DEX name (e.g., "Raydium CLMM", "Orca Whirlpool")
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

/**
 * Route plan from Worker
 */
export interface RoutePlan {
  routePlan: RouteStep[];
  outAmount: string;
  outAmountWithSlippage?: string;
  marketInfos?: any[];
}

/**
 * Swap instructions result (compatibility with existing code)
 */
export interface SwapInstructionsResult {
  instructions: TransactionInstruction[];
  setupInstructions: TransactionInstruction[];
  cleanupInstructions: TransactionInstruction[];
  computeBudgetInstructions: TransactionInstruction[];
  addressLookupTableAddresses: string[];
  outAmount: number;
}

/**
 * Flashloan wrapper interface
 */
export interface IFlashloanWrapper {
  wrapWithFlashloan(
    swapInstructions: TransactionInstruction[],
    borrowAmount: number,
    borrowMint: PublicKey
  ): Promise<{
    borrowInstruction: TransactionInstruction;
    repayInstructions: TransactionInstruction[];
    flashloanAccounts: PublicKey[];
  }>;
}

/**
 * Instruction merger result
 */
export interface MergedTransactionResult {
  transaction: VersionedTransaction;
  size: number;
  instructionsCount: number;
  altsCount: number;
}

/**
 * Pool data cache for performance
 */
export interface PoolDataCache {
  address: PublicKey;
  data: any;
  timestamp: number;
  ttl: number;
}

/**
 * Build options
 */
export interface BuildOptions {
  slippageBps: number;
  computeUnitPrice?: number;
  computeUnitLimit?: number;
  onlyDirectRoutes?: boolean;
  maxAccounts?: number;
}
