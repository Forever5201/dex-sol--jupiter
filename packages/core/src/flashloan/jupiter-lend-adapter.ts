/**
 * Jupiter Lend 协议适配器
 * 
 * 实现 Jupiter Lend 闪电贷功能（0% 费用！）
 * 参考：https://dev.jup.ag/docs/lend/liquidation
 */

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import { FlashLoanResult, FlashLoanFeeConfig, FlashLoanValidationResult } from './types';
import { JupiterLendInstructionCache } from './jupiter-lend-instruction-cache';
import { createLogger } from '../logger';

const logger = createLogger('JupiterLendAdapter');

/**
 * Jupiter Lend 适配器
 * 
 * 特点：
 * - 0% 费用（完全免费！）
 * - 官方 SDK 集成
 * - 支持所有主流代币
 * - 🚀 智能指令缓存（节省 1326ms，96.4%）
 */
export class JupiterLendAdapter {
  private instructionCache: JupiterLendInstructionCache;

  constructor(
    private connection: Connection,
    cacheValidityMs: number = 5 * 60 * 1000, // 5分钟缓存
    private enablePersistence: boolean = true, // 启用持久化
    private cacheFilePath: string = 'cache/jupiter-lend-instructions.json'
  ) {
    this.instructionCache = new JupiterLendInstructionCache(cacheValidityMs);
    
    // 🔥 启动时从磁盘加载缓存（如果存在）
    if (this.enablePersistence) {
      this.instructionCache.loadFromDisk(this.cacheFilePath).then(() => {
        logger.info('✅ Instruction cache initialized from disk');
      }).catch(err => {
        logger.warn(`⚠️ Failed to load cache from disk: ${err.message}`);
      });
    }
    
    // 每5分钟清理过期缓存
    setInterval(() => {
      this.instructionCache.clearExpired();
    }, 5 * 60 * 1000);
    
    // 🔥 启用自动保存（每5分钟持久化到磁盘）
    if (this.enablePersistence) {
      this.instructionCache.startAutoSave(this.cacheFilePath);
    }
    
    // 每30秒打印统计（调试用）
    setInterval(() => {
      const stats = this.instructionCache.getStats();
      if (stats.cacheHits > 0) {
        this.instructionCache.logStats();
      }
    }, 30 * 1000);
  }

  /**
   * 构建闪电贷指令（带智能缓存）
   * 
   * 性能优化：
   * - 首次构建：~1376ms（需要 RPC 查询）
   * - 缓存命中：~50ms（仅更新 amount）
   * - 节省时间：~1326ms（96.4%）
   * 
   * @param params 闪电贷参数
   * @returns 闪电贷结果（借款和还款指令）
   */
  async buildFlashLoanInstructions(params: {
    amount: number;
    asset: PublicKey;
    signer: PublicKey;
  }): Promise<FlashLoanResult> {
    const startTime = Date.now();
    
    // 🚀 尝试从缓存获取（超快！~50ms）
    const cached = this.instructionCache.getFromCache(
      params.amount,
      params.asset,
      params.signer
    );

    if (cached) {
      const elapsed = Date.now() - startTime;
      logger.debug(`⚡ Instructions built from cache in ${elapsed}ms (saved ~1326ms)`);
      
      return {
        borrowInstruction: cached.borrowInstruction,
        repayInstruction: cached.repayInstruction,
        borrowAmount: params.amount,
        repayAmount: params.amount, // NO FEE!
        fee: 0,
        additionalAccounts: [],
      };
    }

    // ❌ 缓存未命中，需要通过 SDK 构建（慢，~1376ms）
    logger.debug(`🔨 Building instructions via SDK (cache miss)...`);
    
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

    const elapsed = Date.now() - startTime;
    logger.debug(`✅ Instructions built via SDK in ${elapsed}ms`);

    // 💾 将指令添加到缓存（下次就快了！）
    this.instructionCache.addToCache(
      params.asset,
      params.signer,
      borrowIx,
      paybackIx
    );

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
   * 获取缓存统计信息
   */
  getCacheStats() {
    return this.instructionCache.getStats();
  }

  /**
   * 清除缓存（用于测试或强制刷新）
   */
  clearCache() {
    this.instructionCache.clear();
  }

  /**
   * 🔥 缓存预热：预先构建常用资产的指令
   * 
   * 在 Bot 启动时调用此方法，预先构建常用资产的闪电贷指令
   * 这样首次套利时就能直接使用缓存，避免冷启动延迟
   * 
   * @param assets 需要预热的资产列表（通常是 SOL, USDC, USDT 等）
   * @param signer 签名者地址
   * @param dummyAmount 预热时使用的虚拟金额（默认 1 SOL）
   */
  async preheatCache(
    assets: PublicKey[],
    signer: PublicKey,
    dummyAmount: number = 1_000_000_000 // 1 SOL
  ): Promise<void> {
    logger.info(`🔥 Starting cache preheat for ${assets.length} assets...`);
    const startTime = Date.now();
    
    let succeeded = 0;
    let failed = 0;

    for (const asset of assets) {
      try {
        // 构建指令（会自动添加到缓存）
        await this.buildFlashLoanInstructions({
          amount: dummyAmount,
          asset,
          signer,
        });
        
        succeeded++;
        logger.debug(`✅ Preheated cache for ${asset.toBase58().slice(0, 8)}...`);
      } catch (error: any) {
        failed++;
        logger.warn(`⚠️ Failed to preheat cache for ${asset.toBase58().slice(0, 8)}...: ${error.message}`);
      }
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `🔥 Cache preheat complete: ${succeeded}/${assets.length} assets preheated ` +
      `in ${elapsed}ms (avg ${(elapsed / assets.length).toFixed(0)}ms/asset)`
    );
    
    if (failed > 0) {
      logger.warn(`⚠️ ${failed} assets failed to preheat, will build on first use`);
    }
  }

  /**
   * 验证闪电贷可行性（完整费用计算版本）
   * 
   * 计算逻辑（三阶段）：
   * 1. 扣除固定成本（baseFee + priorityFee）→ 得到毛利润
   * 2. 扣除成功后费用（jitoTip + slippageBuffer）→ 得到净利润
   * 3. 验证净利润 > 0（可通过配置关闭）
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
    const enableNetProfitCheck = fees.enableNetProfitCheck ?? true;
    
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

    // ===== 第三阶段：净利润检查（可配置关闭） =====
    if (enableNetProfitCheck && netProfit <= 0) {
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

    // ===== 最终验证通过 =====
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

