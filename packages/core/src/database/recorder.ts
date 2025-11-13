/**
 * 数据记录服务
 * 
 * 记录套利机会和交易到数据库
 */

import { getDatabase } from './index';
import { createLogger } from '../logger';
import type { Prisma } from '@prisma/client';

const logger = createLogger('DatabaseRecorder');

/**
 * 机会记录数据
 */
export interface OpportunityData {
  inputMint: string;
  outputMint: string;
  bridgeToken?: string;
  bridgeMint?: string;
  inputAmount: bigint;
  outputAmount: bigint;
  bridgeAmount?: bigint;
  expectedProfit: bigint;
  expectedRoi: number;
  executed?: boolean;
  filtered?: boolean;
  filterReason?: string;
  metadata?: any;
}

/**
 * 交易记录数据
 */
export interface TradeData {
  signature: string;
  status: 'success' | 'failed' | 'timeout' | 'rejected';
  errorMessage?: string;
  inputMint: string;
  outputMint: string;
  bridgeToken?: string;
  bridgeMint?: string;
  inputAmount: bigint;
  outputAmount: bigint;
  bridgeAmount?: bigint;
  grossProfit: bigint;
  netProfit: bigint;
  roi?: number;
  flashloanFee?: bigint;
  flashloanAmount?: bigint;
  flashloanProvider?: string;
  jitoTip?: bigint;
  gasFee?: bigint;
  priorityFee?: bigint;
  totalFee: bigint;
  computeUnitsUsed?: number;
  computeUnitPrice?: number;
  opportunityId?: bigint;
  metadata?: any;
}

/**
 * 路由记录数据
 */
export interface RouteData {
  stepNumber: number;
  direction: 'outbound' | 'return';
  dexName: string;
  poolAddress?: string;
  inputMint: string;
  outputMint: string;
  inputAmount: bigint;
  outputAmount: bigint;
  priceImpact?: number;
}

/**
 * 二次验证记录数据
 */
export interface ValidationData {
  opportunityId: bigint;
  firstDetectedAt: Date;
  firstProfit: bigint;
  firstRoi: number;
  secondCheckedAt: Date;
  stillExists: boolean;
  secondProfit?: bigint;
  secondRoi?: number;
  validationDelayMs: number;
  // 详细延迟分析（可选，用于性能优化）
  firstOutboundMs?: number;
  firstReturnMs?: number;
  secondOutboundMs?: number;
  secondReturnMs?: number;
}

/**
 * 并行任务追踪数据
 */
export interface ParallelTrackingData {
  opportunityId: bigint;
  parallelStartedAt: Date;
}

/**
 * 构建阶段数据
 */
export interface BuildPhaseData {
  opportunityId: bigint;
  buildStartedAt: Date;
  buildCompletedAt?: Date;
  buildLatencyMs?: number;
  buildSuccess?: boolean;
  buildError?: string;
  transactionSize?: number;
  isBundleMode?: boolean;
}

/**
 * 模拟阶段数据
 */
export interface SimulationPhaseData {
  opportunityId: bigint;
  simulationStartedAt: Date;
  simulationCompletedAt?: Date;
  simulationLatencyMs?: number;
  simulationSuccess?: boolean;
  simulationError?: string;
  simulationComputeUnits?: number;
}

/**
 * 验证阶段数据
 */
export interface ValidationPhaseData {
  opportunityId: bigint;
  validationStartedAt: Date;
  validationCompletedAt?: Date;
  validationLatencyMs?: number;
  validationSuccess?: boolean;
  secondProfit?: bigint;
  secondRoi?: number;
  priceDrift?: number;
  isProfitableAfterFees?: boolean;
  estimatedGasFee?: bigint;
  estimatedPriorityFee?: bigint;
  estimatedJitoTip?: bigint;
  estimatedSlippageBuffer?: bigint;
  netProfitAfterFees?: bigint;
}

/**
 * 并行完成数据
 */
export interface ParallelCompletedData {
  opportunityId: bigint;
  parallelCompletedAt: Date;
  parallelTotalLatencyMs: number;
  buildTotalLatencyMs: number;
}

/**
 * 过滤判断数据
 */
export interface FilterJudgmentData {
  opportunityId: bigint;
  passedSimulation?: boolean;
  passedValidation?: boolean;
  passedBoth?: boolean;
  shouldExecute?: boolean;
  filterReason?: string;
  executionStatus?: string;
}

/**
 * 数据库记录器类
 */
export class DatabaseRecorder {
  /**
   * 记录发现的套利机会
   */
  async recordOpportunity(data: OpportunityData): Promise<bigint> {
    try {
      const db = getDatabase();
      
      const opportunity = await db.opportunity.create({
        data: {
          inputMint: data.inputMint,
          outputMint: data.outputMint,
          bridgeToken: data.bridgeToken,
          bridgeMint: data.bridgeMint,
          inputAmount: data.inputAmount,
          outputAmount: data.outputAmount,
          bridgeAmount: data.bridgeAmount,
          expectedProfit: data.expectedProfit,
          expectedRoi: data.expectedRoi,
          executed: data.executed || false,
          filtered: data.filtered || false,
          filterReason: data.filterReason,
          metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : undefined,
        },
      });

      logger.debug('Opportunity recorded', { id: opportunity.id });
      return opportunity.id;
    } catch (error) {
      logger.error('Failed to record opportunity:', error);
      throw error;
    }
  }

  /**
   * 记录交易
   */
  async recordTrade(data: TradeData): Promise<bigint> {
    try {
      const db = getDatabase();
      
      const now = new Date();
      const tradeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const hourOfDay = now.getHours();

      const trade = await db.trade.create({
        data: {
          signature: data.signature,
          executedAt: now,
          confirmedAt: data.status === 'success' ? now : undefined,
          status: data.status,
          errorMessage: data.errorMessage,
          inputMint: data.inputMint,
          outputMint: data.outputMint,
          bridgeToken: data.bridgeToken,
          bridgeMint: data.bridgeMint,
          inputAmount: data.inputAmount,
          outputAmount: data.outputAmount,
          bridgeAmount: data.bridgeAmount,
          grossProfit: data.grossProfit,
          netProfit: data.netProfit,
          roi: data.roi,
          flashloanFee: data.flashloanFee || 0n,
          flashloanAmount: data.flashloanAmount || 0n,
          flashloanProvider: data.flashloanProvider,
          jitoTip: data.jitoTip || 0n,
          gasFee: data.gasFee || 0n,
          priorityFee: data.priorityFee || 0n,
          totalFee: data.totalFee,
          computeUnitsUsed: data.computeUnitsUsed,
          computeUnitPrice: data.computeUnitPrice,
          opportunityId: data.opportunityId,
          tradeDate,
          hourOfDay,
          metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : undefined,
        },
      });

      logger.info('Trade recorded', { 
        id: trade.id, 
        signature: data.signature,
        status: data.status,
      });

      return trade.id;
    } catch (error) {
      logger.error('Failed to record trade:', error);
      throw error;
    }
  }

  /**
   * 更新交易状态
   */
  async updateTradeStatus(
    tradeId: bigint,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.trade.update({
        where: { id: tradeId },
        data: {
          status,
          errorMessage,
          confirmedAt: status === 'success' ? new Date() : undefined,
        },
      });

      logger.debug('Trade status updated', { tradeId, status });
    } catch (error) {
      logger.error('Failed to update trade status:', error);
      throw error;
    }
  }

  /**
   * 记录交易路由详情
   */
  async recordTradeRoutes(tradeId: bigint, routes: RouteData[]): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.tradeRoute.createMany({
        data: routes.map(route => ({
          tradeId,
          stepNumber: route.stepNumber,
          direction: route.direction,
          dexName: route.dexName,
          poolAddress: route.poolAddress,
          inputMint: route.inputMint,
          outputMint: route.outputMint,
          inputAmount: route.inputAmount,
          outputAmount: route.outputAmount,
          priceImpact: route.priceImpact,
        })),
      });

      logger.debug('Trade routes recorded', { tradeId, count: routes.length });
    } catch (error) {
      logger.error('Failed to record trade routes:', error);
      throw error;
    }
  }

  /**
   * 标记机会为已执行
   */
  async markOpportunityExecuted(opportunityId: bigint, tradeId: bigint): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.opportunity.update({
        where: { id: opportunityId },
        data: {
          executed: true,
          tradeId,
        },
      });

      logger.debug('Opportunity marked as executed', { opportunityId, tradeId });
    } catch (error) {
      logger.error('Failed to mark opportunity as executed:', error);
      throw error;
    }
  }

  /**
   * 标记机会为已过滤
   */
  async markOpportunityFiltered(opportunityId: bigint, reason: string): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.opportunity.update({
        where: { id: opportunityId },
        data: {
          filtered: true,
          filterReason: reason,
        },
      });

      logger.debug('Opportunity marked as filtered', { opportunityId, reason });
    } catch (error) {
      logger.error('Failed to mark opportunity as filtered:', error);
      throw error;
    }
  }

  /**
   * 记录机会二次验证结果
   */
  async recordOpportunityValidation(data: ValidationData): Promise<bigint> {
    try {
      const db = getDatabase();
      
      const validation = await db.opportunityValidation.create({
        data: {
          opportunityId: data.opportunityId,
          firstDetectedAt: data.firstDetectedAt,
          firstProfit: data.firstProfit,
          firstRoi: data.firstRoi,
          secondCheckedAt: data.secondCheckedAt,
          stillExists: data.stillExists,
          secondProfit: data.secondProfit,
          secondRoi: data.secondRoi,
          validationDelayMs: data.validationDelayMs,
          // 详细延迟数据（可选）
          firstOutboundMs: data.firstOutboundMs,
          firstReturnMs: data.firstReturnMs,
          secondOutboundMs: data.secondOutboundMs,
          secondReturnMs: data.secondReturnMs,
        },
      });

      logger.debug('Opportunity validation recorded', { 
        id: validation.id,
        opportunityId: data.opportunityId,
        stillExists: data.stillExists,
        delayMs: data.validationDelayMs,
      });

      return validation.id;
    } catch (error) {
      logger.error('Failed to record opportunity validation:', error);
      throw error;
    }
  }

  // ==================== 新增：详细追踪记录方法 ====================

  /**
   * 记录并行任务开始
   */
  async recordParallelStart(data: ParallelTrackingData): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.opportunity.update({
        where: { id: data.opportunityId },
        data: {
          parallelStartedAt: data.parallelStartedAt,
        },
      });

      logger.debug('Parallel tasks started', { opportunityId: data.opportunityId });
    } catch (error) {
      logger.error('Failed to record parallel start:', error);
      throw error;
    }
  }

  /**
   * 记录构建阶段数据
   */
  async recordBuildPhase(data: BuildPhaseData): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.opportunity.update({
        where: { id: data.opportunityId },
        data: {
          buildStartedAt: data.buildStartedAt,
          buildCompletedAt: data.buildCompletedAt,
          buildLatencyMs: data.buildLatencyMs,
          buildSuccess: data.buildSuccess,
          buildError: data.buildError,
          transactionSize: data.transactionSize,
          isBundleMode: data.isBundleMode,
        },
      });

      logger.debug('Build phase recorded', { 
        opportunityId: data.opportunityId,
        success: data.buildSuccess,
        latencyMs: data.buildLatencyMs,
      });
    } catch (error) {
      logger.error('Failed to record build phase:', error);
      throw error;
    }
  }

  /**
   * 记录模拟阶段数据
   */
  async recordSimulationPhase(data: SimulationPhaseData): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.opportunity.update({
        where: { id: data.opportunityId },
        data: {
          simulationStartedAt: data.simulationStartedAt,
          simulationCompletedAt: data.simulationCompletedAt,
          simulationLatencyMs: data.simulationLatencyMs,
          simulationSuccess: data.simulationSuccess,
          simulationError: data.simulationError,
          simulationComputeUnits: data.simulationComputeUnits,
        },
      });

      logger.debug('Simulation phase recorded', { 
        opportunityId: data.opportunityId,
        success: data.simulationSuccess,
        latencyMs: data.simulationLatencyMs,
      });
    } catch (error) {
      logger.error('Failed to record simulation phase:', error);
      throw error;
    }
  }

  /**
   * 记录验证阶段数据
   */
  async recordValidationPhase(data: ValidationPhaseData): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.opportunity.update({
        where: { id: data.opportunityId },
        data: {
          validationStartedAt: data.validationStartedAt,
          validationCompletedAt: data.validationCompletedAt,
          validationLatencyMs: data.validationLatencyMs,
          validationSuccess: data.validationSuccess,
          secondProfit: data.secondProfit,
          secondRoi: data.secondRoi,
          priceDrift: data.priceDrift,
          isProfitableAfterFees: data.isProfitableAfterFees,
          estimatedGasFee: data.estimatedGasFee,
          estimatedPriorityFee: data.estimatedPriorityFee,
          estimatedJitoTip: data.estimatedJitoTip,
          estimatedSlippageBuffer: data.estimatedSlippageBuffer,
          netProfitAfterFees: data.netProfitAfterFees,
        },
      });

      logger.debug('Validation phase recorded', { 
        opportunityId: data.opportunityId,
        success: data.validationSuccess,
        latencyMs: data.validationLatencyMs,
        isProfitable: data.isProfitableAfterFees,
      });
    } catch (error) {
      logger.error('Failed to record validation phase:', error);
      throw error;
    }
  }

  /**
   * 记录并行任务完成
   */
  async recordParallelCompleted(data: ParallelCompletedData): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.opportunity.update({
        where: { id: data.opportunityId },
        data: {
          parallelCompletedAt: data.parallelCompletedAt,
          parallelTotalLatencyMs: data.parallelTotalLatencyMs,
          buildTotalLatencyMs: data.buildTotalLatencyMs,
        },
      });

      logger.debug('Parallel tasks completed', { 
        opportunityId: data.opportunityId,
        totalLatencyMs: data.parallelTotalLatencyMs,
        buildTotalLatencyMs: data.buildTotalLatencyMs,
      });
    } catch (error) {
      logger.error('Failed to record parallel completed:', error);
      throw error;
    }
  }

  /**
   * 记录过滤判断结果
   */
  async recordFilterJudgment(data: FilterJudgmentData): Promise<void> {
    try {
      const db = getDatabase();
      
      await db.opportunity.update({
        where: { id: data.opportunityId },
        data: {
          passedSimulation: data.passedSimulation,
          passedValidation: data.passedValidation,
          passedBoth: data.passedBoth,
          shouldExecute: data.shouldExecute,
          filterReason: data.filterReason,
          executionStatus: data.executionStatus,
          filtered: data.shouldExecute === false,
        },
      });

      logger.debug('Filter judgment recorded', { 
        opportunityId: data.opportunityId,
        passedBoth: data.passedBoth,
        shouldExecute: data.shouldExecute,
      });
    } catch (error) {
      logger.error('Failed to record filter judgment:', error);
      throw error;
    }
  }

  /**
   * 批量更新记录（用于高频更新场景）
   */
  async updateOpportunityTracking(
    opportunityId: bigint,
    data: Partial<BuildPhaseData & SimulationPhaseData & ValidationPhaseData & ParallelCompletedData & FilterJudgmentData>
  ): Promise<void> {
    try {
      const db = getDatabase();
      
      // 移除opportunityId字段避免重复
      const { opportunityId: _, ...updateData } = data;
      
      await db.opportunity.update({
        where: { id: opportunityId },
        data: updateData as any,
      });

      logger.debug('Opportunity tracking updated', { opportunityId });
    } catch (error) {
      logger.error('Failed to update opportunity tracking:', error);
      throw error;
    }
  }
}

// 导出单例实例
export const databaseRecorder = new DatabaseRecorder();



