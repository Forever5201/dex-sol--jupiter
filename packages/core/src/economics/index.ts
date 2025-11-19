// Re-export all types
export * from './types';

// Re-export all classes
export { CostCalculator } from './cost-calculator';
export { JitoTipOptimizer, type JitoTipOptimizerConfig } from './jito-tip-optimizer';
export { ProfitAnalyzer, type ProfitAnalyzerConfig } from './profit-analyzer';
export { RiskManager } from './risk-manager';
export { CircuitBreaker, type ExtendedCircuitBreakerConfig } from './circuit-breaker';
export { TickArraySimulator, type TickData, type TickArray, type CrossTickSimulationResult } from './tick-array-simulator';

// Re-export factory function
export { createEconomicsSystem } from './factory';

/**
 * 版本信息
 */
export const VERSION = '1.0.0';

/**
 * 模块元数据
 */
export const METADATA = {
  name: 'Solana Arbitrage Economics',
  version: VERSION,
  description: '专业级 Solana DEX 套利经济模型',
  author: 'Solana Arbitrage Bot Team',
};



