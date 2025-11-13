/**
 * 机会统计分析类
 * 
 * 提供各种统计查询方法，用于分析机会处理的漏斗和性能
 */

import { getDatabase } from './index';
import { createLogger } from '../logger';

const logger = createLogger('OpportunityAnalytics');

/**
 * 漏斗分析结果
 */
export interface FunnelAnalysis {
  totalOpportunities: number;
  buildSuccess: number;
  buildFailed: number;
  simulationPassed: number;
  simulationFailed: number;
  validationPassed: number;
  validationFailed: number;
  passedBoth: number;
  shouldExecute: number;
  executed: number;
  executionSuccess: number;
  
  // 通过率
  buildSuccessRate: number;
  simulationPassRate: number;
  validationPassRate: number;
  bothPassRate: number;
  executionRate: number;
  
  // 平均耗时
  avgBuildLatencyMs: number;
  avgSimulationLatencyMs: number;
  avgValidationLatencyMs: number;
  avgParallelTotalLatencyMs: number;
  
  // 并行收益
  avgBuildTotalLatencyMs: number;
  parallelSavingsMs: number;  // 并行节省的时间 = (build+validation) - parallel_total
  parallelSavingsPercent: number;
}

/**
 * 矩阵分析结果
 */
export interface MatrixAnalysis {
  simPassedValPassed: number;
  simPassedValFailed: number;
  simFailedValPassed: number;
  simFailedValFailed: number;
  
  // 利润统计（只统计通过验证的）
  avgProfitSimPassedValPassed: number;
  avgProfitSimPassedValFailed: number;
  avgProfitSimFailedValPassed: number;
}

/**
 * 性能分析结果
 */
export interface PerformanceAnalysis {
  buildLatency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  };
  simulationLatency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  };
  validationLatency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  };
  parallelTotalLatency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  };
}

/**
 * 机会统计分析类
 */
export class OpportunityAnalytics {
  /**
   * 获取漏斗分析
   */
  static async getFunnelAnalysis(options?: {
    startTime?: Date;
    endTime?: Date;
  }): Promise<FunnelAnalysis> {
    const db = getDatabase();
    
    const where = options ? {
      discoveredAt: {
        ...(options.startTime && { gte: options.startTime }),
        ...(options.endTime && { lte: options.endTime }),
      },
    } : {};
    
    // 统计总数和各阶段通过数
    const [
      totalOpportunities,
      buildSuccess,
      buildFailed,
      simulationPassed,
      simulationFailed,
      validationPassed,
      validationFailed,
      passedBoth,
      shouldExecute,
      executed,
      executionSuccess,
    ] = await Promise.all([
      db.opportunity.count({ where }),
      db.opportunity.count({ where: { ...where, buildSuccess: true } }),
      db.opportunity.count({ where: { ...where, buildSuccess: false } }),
      db.opportunity.count({ where: { ...where, passedSimulation: true } }),
      db.opportunity.count({ where: { ...where, passedSimulation: false } }),
      db.opportunity.count({ where: { ...where, passedValidation: true } }),
      db.opportunity.count({ where: { ...where, passedValidation: false } }),
      db.opportunity.count({ where: { ...where, passedBoth: true } }),
      db.opportunity.count({ where: { ...where, shouldExecute: true } }),
      db.opportunity.count({ where: { ...where, executed: true } }),
      db.opportunity.count({ where: { ...where, executed: true, executionStatus: 'success' } }),
    ]);
    
    // 统计平均耗时
    const avgLatencies = await db.opportunity.aggregate({
      where,
      _avg: {
        buildLatencyMs: true,
        simulationLatencyMs: true,
        validationLatencyMs: true,
        parallelTotalLatencyMs: true,
        buildTotalLatencyMs: true,
      },
    });
    
    const avgBuildLatencyMs = avgLatencies._avg.buildLatencyMs || 0;
    const avgSimulationLatencyMs = avgLatencies._avg.simulationLatencyMs || 0;
    const avgValidationLatencyMs = avgLatencies._avg.validationLatencyMs || 0;
    const avgParallelTotalLatencyMs = avgLatencies._avg.parallelTotalLatencyMs || 0;
    const avgBuildTotalLatencyMs = avgLatencies._avg.buildTotalLatencyMs || 0;
    
    // 计算并行收益
    const serialTime = avgBuildTotalLatencyMs + avgValidationLatencyMs;
    const parallelSavingsMs = serialTime - avgParallelTotalLatencyMs;
    const parallelSavingsPercent = serialTime > 0 ? (parallelSavingsMs / serialTime) * 100 : 0;
    
    return {
      totalOpportunities,
      buildSuccess,
      buildFailed,
      simulationPassed,
      simulationFailed,
      validationPassed,
      validationFailed,
      passedBoth,
      shouldExecute,
      executed,
      executionSuccess,
      
      buildSuccessRate: totalOpportunities > 0 ? (buildSuccess / totalOpportunities) * 100 : 0,
      simulationPassRate: buildSuccess > 0 ? (simulationPassed / buildSuccess) * 100 : 0,
      validationPassRate: totalOpportunities > 0 ? (validationPassed / totalOpportunities) * 100 : 0,
      bothPassRate: totalOpportunities > 0 ? (passedBoth / totalOpportunities) * 100 : 0,
      executionRate: shouldExecute > 0 ? (executed / shouldExecute) * 100 : 0,
      
      avgBuildLatencyMs,
      avgSimulationLatencyMs,
      avgValidationLatencyMs,
      avgParallelTotalLatencyMs,
      avgBuildTotalLatencyMs,
      parallelSavingsMs,
      parallelSavingsPercent,
    };
  }
  
  /**
   * 获取矩阵分析
   */
  static async getMatrixAnalysis(options?: {
    startTime?: Date;
    endTime?: Date;
  }): Promise<MatrixAnalysis> {
    const db = getDatabase();
    
    const where = options ? {
      discoveredAt: {
        ...(options.startTime && { gte: options.startTime }),
        ...(options.endTime && { lte: options.endTime }),
      },
    } : {};
    
    const [
      simPassedValPassed,
      simPassedValFailed,
      simFailedValPassed,
      simFailedValFailed,
    ] = await Promise.all([
      db.opportunity.count({ where: { ...where, passedSimulation: true, passedValidation: true } }),
      db.opportunity.count({ where: { ...where, passedSimulation: true, passedValidation: false } }),
      db.opportunity.count({ where: { ...where, passedSimulation: false, passedValidation: true } }),
      db.opportunity.count({ where: { ...where, passedSimulation: false, passedValidation: false } }),
    ]);
    
    // 计算各象限的平均利润
    const [avgProfit1, avgProfit2, avgProfit3] = await Promise.all([
      db.opportunity.aggregate({
        where: { ...where, passedSimulation: true, passedValidation: true },
        _avg: { expectedProfit: true },
      }),
      db.opportunity.aggregate({
        where: { ...where, passedSimulation: true, passedValidation: false },
        _avg: { expectedProfit: true },
      }),
      db.opportunity.aggregate({
        where: { ...where, passedSimulation: false, passedValidation: true },
        _avg: { expectedProfit: true },
      }),
    ]);
    
    return {
      simPassedValPassed,
      simPassedValFailed,
      simFailedValPassed,
      simFailedValFailed,
      avgProfitSimPassedValPassed: Number(avgProfit1._avg.expectedProfit || 0) / 1e9,
      avgProfitSimPassedValFailed: Number(avgProfit2._avg.expectedProfit || 0) / 1e9,
      avgProfitSimFailedValPassed: Number(avgProfit3._avg.expectedProfit || 0) / 1e9,
    };
  }
  
  /**
   * 获取性能分析
   */
  static async getPerformanceAnalysis(options?: {
    startTime?: Date;
    endTime?: Date;
  }): Promise<PerformanceAnalysis> {
    const db = getDatabase();
    
    const where = options ? {
      discoveredAt: {
        ...(options.startTime && { gte: options.startTime }),
        ...(options.endTime && { lte: options.endTime }),
      },
    } : {};
    
    // 构建WHERE条件
    const timeFilter = [];
    if (options?.startTime) timeFilter.push(`discovered_at >= '${options.startTime.toISOString()}'`);
    if (options?.endTime) timeFilter.push(`discovered_at <= '${options.endTime.toISOString()}'`);
    const timeCondition = timeFilter.length > 0 ? `AND ${timeFilter.join(' AND ')}` : '';
    
    // 获取构建耗时统计
    const buildLatencies = await db.$queryRawUnsafe<Array<{ latency: number }>>(
      `SELECT build_latency_ms as latency
       FROM opportunities
       WHERE build_latency_ms IS NOT NULL ${timeCondition}
       ORDER BY build_latency_ms`
    );
    
    // 获取模拟耗时统计
    const simulationLatencies = await db.$queryRawUnsafe<Array<{ latency: number }>>(
      `SELECT simulation_latency_ms as latency
       FROM opportunities
       WHERE simulation_latency_ms IS NOT NULL ${timeCondition}
       ORDER BY simulation_latency_ms`
    );
    
    // 获取验证耗时统计
    const validationLatencies = await db.$queryRawUnsafe<Array<{ latency: number }>>(
      `SELECT validation_latency_ms as latency
       FROM opportunities
       WHERE validation_latency_ms IS NOT NULL ${timeCondition}
       ORDER BY validation_latency_ms`
    );
    
    // 获取并行总耗时统计
    const parallelLatencies = await db.$queryRawUnsafe<Array<{ latency: number }>>(
      `SELECT parallel_total_latency_ms as latency
       FROM opportunities
       WHERE parallel_total_latency_ms IS NOT NULL ${timeCondition}
       ORDER BY parallel_total_latency_ms`
    );
    
    return {
      buildLatency: this.calculatePercentiles(buildLatencies.map((r: any) => Number(r.latency))),
      simulationLatency: this.calculatePercentiles(simulationLatencies.map((r: any) => Number(r.latency))),
      validationLatency: this.calculatePercentiles(validationLatencies.map((r: any) => Number(r.latency))),
      parallelTotalLatency: this.calculatePercentiles(parallelLatencies.map((r: any) => Number(r.latency))),
    };
  }
  
  /**
   * 计算百分位数
   */
  private static calculatePercentiles(values: number[]): {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  } {
    if (values.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p99: 0 };
    }
    
    const sorted = values.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p90: sorted[Math.floor(sorted.length * 0.9)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }
  
  /**
   * 生成漏斗分析报表
   */
  static async generateFunnelReport(options?: {
    startTime?: Date;
    endTime?: Date;
  }): Promise<string> {
    const funnel = await this.getFunnelAnalysis(options);
    
    const report = `
📊 机会处理漏斗分析
${'='.repeat(80)}

📈 总体统计
  总机会数：${funnel.totalOpportunities}

🔨 构建阶段
  成功：${funnel.buildSuccess} (${funnel.buildSuccessRate.toFixed(1)}%)
  失败：${funnel.buildFailed} (${(100 - funnel.buildSuccessRate).toFixed(1)}%)
  平均耗时：${funnel.avgBuildLatencyMs.toFixed(0)}ms

🧪 模拟阶段
  通过：${funnel.simulationPassed} (${funnel.simulationPassRate.toFixed(1)}%)
  失败：${funnel.simulationFailed} (${(100 - funnel.simulationPassRate).toFixed(1)}%)
  平均耗时：${funnel.avgSimulationLatencyMs.toFixed(0)}ms

✅ 验证阶段
  通过：${funnel.validationPassed} (${funnel.validationPassRate.toFixed(1)}%)
  失败：${funnel.validationFailed} (${(100 - funnel.validationPassRate).toFixed(1)}%)
  平均耗时：${funnel.avgValidationLatencyMs.toFixed(0)}ms

🎯 综合判断
  同时通过（模拟&验证）：${funnel.passedBoth} (${funnel.bothPassRate.toFixed(1)}%)
  应该执行：${funnel.shouldExecute}
  实际执行：${funnel.executed}
  执行成功：${funnel.executionSuccess}

⚡ 并行处理性能
  构建+模拟总耗时：${funnel.avgBuildTotalLatencyMs.toFixed(0)}ms
  验证耗时：${funnel.avgValidationLatencyMs.toFixed(0)}ms
  串行总耗时（估算）：${(funnel.avgBuildTotalLatencyMs + funnel.avgValidationLatencyMs).toFixed(0)}ms
  并行实际耗时：${funnel.avgParallelTotalLatencyMs.toFixed(0)}ms
  节省时间：${funnel.parallelSavingsMs.toFixed(0)}ms (${funnel.parallelSavingsPercent.toFixed(1)}%)

${'='.repeat(80)}
    `.trim();
    
    return report;
  }
  
  /**
   * 生成矩阵分析报表
   */
  static async generateMatrixReport(options?: {
    startTime?: Date;
    endTime?: Date;
  }): Promise<string> {
    const matrix = await this.getMatrixAnalysis(options);
    
    const total = matrix.simPassedValPassed + matrix.simPassedValFailed + 
                  matrix.simFailedValPassed + matrix.simFailedValFailed;
    
    const report = `
📊 模拟 vs 验证矩阵分析
${'='.repeat(80)}

                │ 验证通过      │ 验证失败      │
────────────────┼───────────────┼───────────────┤
模拟通过        │ ${matrix.simPassedValPassed.toString().padStart(6)} (${((matrix.simPassedValPassed / total) * 100).toFixed(1).padStart(5)}%)│ ${matrix.simPassedValFailed.toString().padStart(6)} (${((matrix.simPassedValFailed / total) * 100).toFixed(1).padStart(5)}%)│
                │ 平均利润:     │ 平均利润:     │
                │ ${matrix.avgProfitSimPassedValPassed.toFixed(6).padStart(13)} │ ${matrix.avgProfitSimPassedValFailed.toFixed(6).padStart(13)} │
────────────────┼───────────────┼───────────────┤
模拟失败        │ ${matrix.simFailedValPassed.toString().padStart(6)} (${((matrix.simFailedValPassed / total) * 100).toFixed(1).padStart(5)}%)│ ${matrix.simFailedValFailed.toString().padStart(6)} (${((matrix.simFailedValFailed / total) * 100).toFixed(1).padStart(5)}%)│
                │ 平均利润:     │               │
                │ ${matrix.avgProfitSimFailedValPassed.toFixed(6).padStart(13)} │               │

${'='.repeat(80)}
    `.trim();
    
    return report;
  }
}
