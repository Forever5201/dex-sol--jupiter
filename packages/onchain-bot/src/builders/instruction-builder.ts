/**
 * 交易构建器接口
 * 定义了多协议交易构建的标准接口
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PriceData } from '../parsers/raydium';
import BN from 'bn.js';

export interface InstructionBuilder {
  /**
   * 构建Swap交易指令
   * @param pool 价格数据，包含池子信息
   * @param inputAmount 输入金额
   * @param minOutput 最小输出金额（滑点保护）
   * @param userWallet 用户钱包公钥
   * @param priorityFeeMicroLamports 优先费 (micro-lamports per compute unit)
   * @returns TransactionInstruction 交易指令
   */
  buildSwap(
    pool: PriceData,
    inputAmount: BN,
    minOutput: BN,
    userWallet: PublicKey,
    priorityFeeMicroLamports?: number
  ): Promise<TransactionInstruction>;

  /**
   * 检查构建器是否支持此池子
   * @param pool 价格数据
   * @returns 是否支持
   */
  canBuild(pool: PriceData): boolean;

  /**
   * 获取构建交易所需的额外账户
   * @param pool 价格数据
   * @returns 所需账户公钥数组
   */
  getRequiredAccounts(pool: PriceData): PublicKey[];

  /**
   * 获取推荐的计算单元限制
   * @param pool 价格数据
   * @returns 计算单元数
   */
  getComputeUnitLimit(pool: PriceData): number;
}