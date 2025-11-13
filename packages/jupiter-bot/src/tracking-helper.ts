/**
 * 机会追踪辅助类
 * 
 * 提供简洁的API来记录机会处理的各个阶段
 * 避免在主文件中重复数据库记录代码
 */

import { databaseRecorder } from '@solana-arb-bot/core';
import { createLogger } from '@solana-arb-bot/core';

const logger = createLogger('OpportunityTracking');

/**
 * 机会追踪辅助类
 */
export class OpportunityTrackingHelper {
  /**
   * 记录并行任务开始
   */
  static async recordParallelStart(opportunityId: bigint): Promise<void> {
    try {
      await databaseRecorder.recordParallelStart({
        opportunityId,
        parallelStartedAt: new Date(),
      });
      logger.debug(`📝 Parallel start recorded for opportunity #${opportunityId}`);
    } catch (error) {
      logger.warn(`⚠️ Failed to record parallel start (non-blocking):`, error);
    }
  }

  /**
   * 记录构建阶段开始
   */
  static async recordBuildStart(
    opportunityId: bigint
  ): Promise<{ buildStartTime: Date; buildStartMs: number }> {
    const buildStartTime = new Date();
    const buildStartMs = Date.now();
    
    try {
      await databaseRecorder.recordBuildPhase({
        opportunityId,
        buildStartedAt: buildStartTime,
      });
      logger.debug(`📝 Build start recorded for opportunity #${opportunityId}`);
    } catch (error) {
      logger.warn(`⚠️ Failed to record build start (non-blocking):`, error);
    }
    
    return { buildStartTime, buildStartMs };
  }

  /**
   * 记录构建阶段完成（模拟前）
   */
  static async recordBuildComplete(
    opportunityId: bigint,
    data: {
      buildStartTime: Date;
      buildStartMs: number;
      buildSuccess: boolean;
      buildError?: string;
      transactionSize?: number;
      isBundleMode?: boolean;
    }
  ): Promise<void> {
    const buildEndTime = new Date();
    const buildLatency = Date.now() - data.buildStartMs;
    
    try {
      await databaseRecorder.recordBuildPhase({
        opportunityId,
        buildStartedAt: data.buildStartTime,
        buildCompletedAt: buildEndTime,
        buildLatencyMs: buildLatency,
        buildSuccess: data.buildSuccess,
        buildError: data.buildError,
        transactionSize: data.transactionSize,
        isBundleMode: data.isBundleMode,
      });
      logger.debug(
        `📝 Build complete recorded for opportunity #${opportunityId}: ` +
        `${buildLatency}ms, success=${data.buildSuccess}`
      );
    } catch (error) {
      logger.warn(`⚠️ Failed to record build complete (non-blocking):`, error);
    }
  }

  /**
   * 记录模拟阶段
   */
  static async recordSimulation(
    opportunityId: bigint,
    data: {
      simulationStartMs: number;
      simulationSuccess: boolean;
      simulationError?: string;
      simulationComputeUnits?: number;
    }
  ): Promise<void> {
    const simulationEndTime = new Date();
    const simulationLatency = Date.now() - data.simulationStartMs;
    const simulationStartTime = new Date(data.simulationStartMs);
    
    try {
      await databaseRecorder.recordSimulationPhase({
        opportunityId,
        simulationStartedAt: simulationStartTime,
        simulationCompletedAt: simulationEndTime,
        simulationLatencyMs: simulationLatency,
        simulationSuccess: data.simulationSuccess,
        simulationError: data.simulationError,
        simulationComputeUnits: data.simulationComputeUnits,
      });
      logger.debug(
        `📝 Simulation recorded for opportunity #${opportunityId}: ` +
        `${simulationLatency}ms, success=${data.simulationSuccess}`
      );
    } catch (error) {
      logger.warn(`⚠️ Failed to record simulation (non-blocking):`, error);
    }
  }

  /**
   * 记录验证阶段
   */
  static async recordValidation(
    opportunityId: bigint,
    data: {
      validationStartMs: number;
      validationSuccess: boolean;
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
  ): Promise<void> {
    const validationEndTime = new Date();
    const validationLatency = Date.now() - data.validationStartMs;
    const validationStartTime = new Date(data.validationStartMs);
    
    try {
      await databaseRecorder.recordValidationPhase({
        opportunityId,
        validationStartedAt: validationStartTime,
        validationCompletedAt: validationEndTime,
        validationLatencyMs: validationLatency,
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
      });
      logger.debug(
        `📝 Validation recorded for opportunity #${opportunityId}: ` +
        `${validationLatency}ms, success=${data.validationSuccess}, ` +
        `profitable=${data.isProfitableAfterFees}`
      );
    } catch (error) {
      logger.warn(`⚠️ Failed to record validation (non-blocking):`, error);
    }
  }

  /**
   * 记录并行任务完成
   */
  static async recordParallelComplete(
    opportunityId: bigint,
    data: {
      parallelStartMs: number;
      buildTotalLatencyMs: number;
      validationLatencyMs?: number;
    }
  ): Promise<void> {
    const parallelEndTime = new Date();
    const parallelTotalLatency = Date.now() - data.parallelStartMs;
    
    try {
      await databaseRecorder.recordParallelCompleted({
        opportunityId,
        parallelCompletedAt: parallelEndTime,
        parallelTotalLatencyMs: parallelTotalLatency,
        buildTotalLatencyMs: data.buildTotalLatencyMs,
      });
      
      // 详细的并行任务日志
      let logMessage = `📝 Parallel tasks completed for opportunity #${opportunityId}:\n`;
      logMessage += `   ├─ 🔨 Build+Simulation: ${data.buildTotalLatencyMs}ms\n`;
      if (data.validationLatencyMs !== undefined) {
        logMessage += `   ├─ ✅ Validation: ${data.validationLatencyMs}ms\n`;
      } else {
        logMessage += `   ├─ ✅ Validation: disabled\n`;
      }
      logMessage += `   └─ ⚡ Parallel Total: ${parallelTotalLatency}ms`;
      
      logger.info(logMessage);
    } catch (error) {
      logger.warn(`⚠️ Failed to record parallel complete (non-blocking):`, error);
    }
  }

  /**
   * 记录过滤判断
   */
  static async recordFilterJudgment(
    opportunityId: bigint,
    data: {
      passedSimulation?: boolean;
      passedValidation?: boolean;
      passedBoth?: boolean;
      shouldExecute?: boolean;
      filterReason?: string;
      executionStatus?: string;
    }
  ): Promise<void> {
    try {
      await databaseRecorder.recordFilterJudgment({
        opportunityId,
        passedSimulation: data.passedSimulation,
        passedValidation: data.passedValidation,
        passedBoth: data.passedBoth,
        shouldExecute: data.shouldExecute,
        filterReason: data.filterReason,
        executionStatus: data.executionStatus,
      });
      logger.debug(
        `📝 Filter judgment recorded for opportunity #${opportunityId}: ` +
        `sim=${data.passedSimulation}, val=${data.passedValidation}, ` +
        `both=${data.passedBoth}, execute=${data.shouldExecute}`
      );
    } catch (error) {
      logger.warn(`⚠️ Failed to record filter judgment (non-blocking):`, error);
    }
  }

  /**
   * 快速记录构建失败
   */
  static async recordBuildFailure(
    opportunityId: bigint,
    buildStartTime: Date,
    errorReason: string
  ): Promise<void> {
    try {
      await databaseRecorder.recordBuildPhase({
        opportunityId,
        buildStartedAt: buildStartTime,
        buildSuccess: false,
        buildError: errorReason,
      });
      logger.debug(`📝 Build failure recorded for opportunity #${opportunityId}: ${errorReason}`);
    } catch (error) {
      logger.warn(`⚠️ Failed to record build failure (non-blocking):`, error);
    }
  }
}
