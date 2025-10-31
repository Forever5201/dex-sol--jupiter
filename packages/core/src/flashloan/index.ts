/**
 * 闪电贷模块
 * 
 * 支持Solend、Jupiter Lend等协议的闪电贷功能
 * 实现无本金原子套利
 */

export * from './types';
export * from './solend-adapter';
export * from './jupiter-lend-adapter';
export * from './transaction-builder';
export * from './solend-alt-manager';
export * from './jupiter-lend-alt-manager';

// 便捷导出
export { SolendAdapter } from './solend-adapter';
export { JupiterLendAdapter } from './jupiter-lend-adapter';
export { FlashLoanTransactionBuilder } from './transaction-builder';
export { SolendALTManager } from './solend-alt-manager';
export { JupiterLendALTManager } from './jupiter-lend-alt-manager';
export {
  FlashLoanProtocol,
  type FlashLoanConfig,
  type FlashLoanResult,
  type AtomicArbitrageConfig,
  type SolendReserve,
} from './types';
