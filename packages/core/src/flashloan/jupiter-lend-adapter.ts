/**
 * Jupiter Lend 协议适配器
 * 
 * 实现 Jupiter Lend 闪电贷功能（0% 费用！）
 * 参考：https://dev.jup.ag/docs/lend/liquidation
 */

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import { FlashLoanResult, FlashLoanFeeConfig, FlashLoanValidationResult } from './types';

/**
 * Jupiter Lend 适配器
 * 
 * 特点：
 * - 0% 费用（完全免费！）
 * - 官方 SDK 集成
 * - 支持所有主流代币
 */
export class JupiterLendAdapter {
  constructor(private connection: Connection) {}

  /**
   * 构建闪电贷指令
   * 
   * @param params 闪电贷参数
   * @returns 闪电贷结果（借款和还款指令）
   */
  async buildFlashLoanInstructions(params: {
    amount: number;
    asset: PublicKey;
    signer: PublicKey;
  }): Promise<FlashLoanResult> {
    // 导入 Jupiter Lend 闪电贷 SDK（0% 费用！）
    // 官方文档：https://dev.jup.ag/docs/lend/liquidation
    const { getFlashBorrowIx, getFlashPaybackIx } = await import('@jup-ag/lend/flashloan');

    // 转换金额为 BN 类型（Jupiter SDK 要求）
    const amountBN = new BN(params.amount);

    // 借款指令（0% 费用！）
    const borrowIx = await getFlashBorrowIx({
      amount: amountBN,
      asset: params.asset,
      signer: params.signer,
      connection: this.connection,
    });

    // 还款指令（0% 费用！）
    const paybackIx = await getFlashPaybackIx({
      amount: amountBN,
      asset: params.asset,
      signer: params.signer,
      connection: this.connection,
    });

    return {
      borrowInstruction: borrowIx,
      repayInstruction: paybackIx,
      borrowAmount: params.amount,
      repayAmount: params.amount, // NO FEE!
      fee: 0, // Jupiter Lend 是完全免费的
      additionalAccounts: [],
    };
  }

  /**
   * 验证闪电贷可行性（完整费用计算版本）
   * 
   * 计算逻辑（三阶段）：
   * 1. 扣除固定成本（baseFee + priorityFee）→ 得到毛利润
   * 2. 扣除成功后费用（jitoTip + slippageBuffer）→ 得到净利润
   * 3. 验证净利润 > 0
   * 
   * @param borrowAmount 借款金额 (lamports)
   * @param profit 预期利润 (lamports，来自 Jupiter Quote)
   * @param fees 费用配置
   * @returns 验证结果
   */
  static validateFlashLoan(
    borrowAmount: number,
    profit: number,
    fees: FlashLoanFeeConfig
  ): FlashLoanValidationResult {
    // ===== 第一阶段：扣除固定成本（无论成败都会扣除） =====
    const fixedCost = fees.baseFee + fees.priorityFee;
    const grossProfit = profit - fixedCost;

    if (grossProfit <= 0) {
      return {
        valid: false,
        fee: 0, // Jupiter Lend 闪电贷费用为 0
        netProfit: grossProfit,
        reason: `毛利润不足覆盖固定成本（需要覆盖: ${(fixedCost / 1e9).toFixed(6)} SOL, 实际利润: ${(profit / 1e9).toFixed(6)} SOL）`,
        breakdown: {
          grossProfit: profit,
          baseFee: fees.baseFee,
          priorityFee: fees.priorityFee,
          jitoTip: 0,
          slippageBuffer: 0,
          netProfit: grossProfit,
        },
      };
    }

    // ===== 第二阶段：扣除成功后才扣除的费用 =====
    // Jito Tip: 按毛利润的百分比计算
    const jitoTip = Math.floor(grossProfit * fees.jitoTipPercent / 100);
    
    // 滑点缓冲: 智能动态计算（优化版）
    // 原理：Jupiter estimatedOut已包含Price Impact，只需预留Time Slippage
    // 策略：取以下三者的最小值
    //   1. 借款的0.03%（Time Slippage基准，从0.05%优化）
    //   2. 利润的10%（从15%降低，节省成本）
    //   3. 借款的0.02%（动态上限，替代固定0.015 SOL）
    const slippageBuffer = Math.min(
      Math.floor(borrowAmount * 0.0003),      // 借款的0.03%
      Math.floor(profit * 0.10),              // 利润的10%
      Math.floor(borrowAmount * 0.0002)       // 动态上限：借款的0.02%
    );

    const netProfit = grossProfit - jitoTip - slippageBuffer;

    if (netProfit <= 0) {
      return {
        valid: false,
        fee: 0, // Jupiter Lend 闪电贷费用为 0
        netProfit,
        reason: `净利润为负（Jito Tip: ${(jitoTip / 1e9).toFixed(6)} SOL, 滑点缓冲: ${(slippageBuffer / 1e9).toFixed(6)} SOL）`,
        breakdown: {
          grossProfit: profit,
          baseFee: fees.baseFee,
          priorityFee: fees.priorityFee,
          jitoTip,
          slippageBuffer,
          netProfit,
        },
      };
    }

    // ===== 第三阶段：最终验证通过 =====
    return {
      valid: true,
      fee: 0, // Jupiter Lend 闪电贷费用为 0%
      netProfit,
      breakdown: {
        grossProfit: profit,
        baseFee: fees.baseFee,
        priorityFee: fees.priorityFee,
        jitoTip,
        slippageBuffer,
        netProfit,
      },
    };
  }

  /**
   * 计算费用（始终为0）
   * 
   * @param amount 借款金额
   * @returns 费用（0）
   */
  static calculateFee(amount: number): number {
    return 0; // Jupiter Lend 完全免费
  }
}

