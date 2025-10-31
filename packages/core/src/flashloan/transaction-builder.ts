/**
 * 闪电贷交易构建器
 * 
 * 构建原子套利交易：借款 → 套利 → 还款
 */

import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  Connection,
} from '@solana/web3.js';
import { SolendAdapter } from './solend-adapter';
import { JupiterLendAdapter } from './jupiter-lend-adapter';
import { AtomicArbitrageConfig, FlashLoanResult, FlashLoanProtocol } from './types';

/**
 * 闪电贷交易构建器
 */
export class FlashLoanTransactionBuilder {
  /**
   * 构建原子套利交易
   * 
   * 交易结构：
   * 1. 闪电借款指令
   * 2. 套利交易指令（可能多条）
   * 3. 闪电还款指令
   * 
   * 所有指令必须在同一个交易中，确保原子性
   * 
   * ⚠️ 注意：对于Jupiter Lend，必须先调用JupiterLendAdapter.buildFlashLoanInstructions()
   *          获取指令，然后传入config.flashLoanInstructions
   */
  static buildAtomicArbitrageTx(
    config: AtomicArbitrageConfig,
    recentBlockhash: string,
    userTokenAccount: PublicKey,
    addressLookupTables?: AddressLookupTableAccount[]
  ): VersionedTransaction {
    const instructions: TransactionInstruction[] = [];

    if (config.useFlashLoan && config.flashLoanConfig) {
      // 如果提供了预构建的闪电贷指令（Jupiter Lend），直接使用
      if (config.flashLoanInstructions) {
        instructions.push(config.flashLoanInstructions.borrowInstruction);
        instructions.push(...config.arbitrageInstructions);
        instructions.push(config.flashLoanInstructions.repayInstruction);
      } else {
        // 否则使用Solend（向后兼容）
        const { amount, tokenMint } = config.flashLoanConfig;
        
        // 推断代币符号（简化版，实际应该查表）
        let tokenSymbol = 'USDC';
        if (tokenMint.equals(new PublicKey('So11111111111111111111111111111111111111112'))) {
          tokenSymbol = 'SOL';
        } else if (tokenMint.equals(new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'))) {
          tokenSymbol = 'USDT';
        }

        // 1. 构建Solend闪电贷
        const flashLoan = SolendAdapter.buildFlashLoan(
          amount,
          tokenSymbol,
          userTokenAccount,
          config.wallet
        );

        // 2. 组装指令
        instructions.push(flashLoan.borrowInstruction);
        instructions.push(...config.arbitrageInstructions);
        instructions.push(flashLoan.repayInstruction);
      }
    } else {
      // 不使用闪电贷，直接套利
      instructions.push(...config.arbitrageInstructions);
    }

    // 3. 构建交易消息
    const messageV0 = new TransactionMessage({
      payerKey: config.wallet,
      recentBlockhash,
      instructions,
    }).compileToV0Message(addressLookupTables);

    return new VersionedTransaction(messageV0);
  }

  /**
   * 估算闪电贷交易的计算单元
   * 
   * 闪电贷交易比普通交易复杂，需要更多计算单元
   */
  static estimateComputeUnits(
    useFlashLoan: boolean,
    arbitrageInstructionCount: number
  ): number {
    let baseUnits = 0;

    if (useFlashLoan) {
      baseUnits += 200_000; // 借款指令
      baseUnits += 200_000; // 还款指令
    }

    // 每条套利指令约200k计算单元
    baseUnits += arbitrageInstructionCount * 200_000;

    // 添加安全边际
    return Math.ceil(baseUnits * 1.2);
  }

  /**
   * 验证闪电贷交易的可行性
   * 
   * @param borrowAmount 借款金额
   * @param expectedProfit 预期利润（扣除所有交易成本后）
   * @param gasCost 估算的Gas成本
   */
  static validateFlashLoanArbitrage(
    borrowAmount: number,
    expectedProfit: number,
    gasCost: number
  ): {
    feasible: boolean;
    flashLoanFee: number;
    netProfit: number;
    roi: number;
    warnings: string[];
  } {
    const flashLoanFee = SolendAdapter.calculateFee(borrowAmount);
    const netProfit = expectedProfit - flashLoanFee - gasCost;
    const roi = (netProfit / flashLoanFee) * 100;

    const warnings: string[] = [];

    // 检查利润是否为正
    if (netProfit <= 0) {
      warnings.push('净利润为负，交易不可行');
    }

    // 检查费用占比
    const feeRatio = flashLoanFee / expectedProfit;
    if (feeRatio > 0.3) {
      warnings.push(`闪电贷费用占利润${(feeRatio * 100).toFixed(1)}%，比例较高`);
    }

    // 检查ROI
    if (roi < 10) {
      warnings.push(`ROI仅${roi.toFixed(1)}%，风险收益比不佳`);
    }

    return {
      feasible: netProfit > 0,
      flashLoanFee,
      netProfit,
      roi,
      warnings,
    };
  }

  /**
   * 计算最优借款金额
   * 
   * 在自有资金和闪电贷之间找平衡点
   * 
   * @param availableCapital 可用资金
   * @param opportunitySize 机会所需资金
   * @param expectedProfitRate 预期利润率（如5%）
   */
  static calculateOptimalBorrowAmount(
    availableCapital: number,
    opportunitySize: number,
    expectedProfitRate: number
  ): {
    borrowAmount: number;
    useOwnCapital: number;
    strategy: 'no-flashloan' | 'partial-flashloan' | 'full-flashloan';
    reason: string;
  } {
    // 1. 资金充足，无需闪电贷
    if (availableCapital >= opportunitySize) {
      return {
        borrowAmount: 0,
        useOwnCapital: opportunitySize,
        strategy: 'no-flashloan',
        reason: '自有资金充足',
      };
    }

    // 2. 计算闪电贷的成本效益
    const shortfall = opportunitySize - availableCapital;
    const flashLoanFee = SolendAdapter.calculateFee(shortfall);
    const expectedProfit = opportunitySize * expectedProfitRate;
    
    // 如果闪电贷费用超过预期利润的30%，不划算
    if (flashLoanFee > expectedProfit * 0.3) {
      return {
        borrowAmount: 0,
        useOwnCapital: availableCapital,
        strategy: 'no-flashloan',
        reason: '闪电贷费用过高，使用部分自有资金',
      };
    }

    // 3. 部分使用闪电贷
    if (availableCapital > opportunitySize * 0.5) {
      return {
        borrowAmount: shortfall,
        useOwnCapital: availableCapital,
        strategy: 'partial-flashloan',
        reason: '组合使用自有资金和闪电贷',
      };
    }

    // 4. 完全使用闪电贷
    return {
      borrowAmount: opportunitySize,
      useOwnCapital: 0,
      strategy: 'full-flashloan',
      reason: '使用闪电贷放大收益',
    };
  }
}
