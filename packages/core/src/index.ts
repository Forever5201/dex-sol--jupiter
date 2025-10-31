/**
 * Solana Arbitrage Bot - Core Module
 * 
 * 主导出文件
 */

// 导出所有核心模块

// Jupiter Swap集成
export * from './solana/jupiter-swap';
export * from './economics';

// 导出Solana基础模块
export * from './solana/connection';
export * from './solana/keypair';
export * from './solana/transaction';

// 导出配置和日志
export * from './config/loader';
export * from './config/proxy-config';
export * from './logger';

// 导出监控模块
export * from './monitoring';

// 导出闪电贷模块
export * from './flashloan';

// 导出网络配置模块（统一代理管理）
export * from './network/proxy-config';
export * from './network/unified-adapter';

// 导出工具模块
// export { PriorityFeeEstimator } from './utils/priority-fee-estimator';
// export type { PriorityFeeEstimate, Urgency } from './utils/priority-fee-estimator';

// 导出数据库模块
export * from './database';
export { initDatabase, getDatabase, closeDatabase, checkDatabaseHealth } from './database';
export { databaseRecorder, DatabaseRecorder } from './database/recorder';
export type { OpportunityData, TradeData, RouteData, ValidationData } from './database/recorder';

// 版本信息
export const VERSION = '1.0.0';


