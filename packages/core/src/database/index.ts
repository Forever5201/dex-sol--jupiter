/**
 * 数据库连接管理
 * 
 * 使用 Prisma Client 连接 PostgreSQL 数据库
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../logger';

const logger = createLogger('Database');

/**
 * 全局 Prisma Client 实例
 */
let prisma: PrismaClient | null = null;

/**
 * 数据库配置
 */
export interface DatabaseConfig {
  url?: string;
  poolSize?: number;
  connectionTimeout?: number;
  logQueries?: boolean;
}

/**
 * 初始化数据库连接
 */
export function initDatabase(config: DatabaseConfig = {}): PrismaClient {
  if (prisma) {
    logger.warn('Database already initialized, returning existing instance');
    return prisma;
  }

  const logLevel = config.logQueries ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'];

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: config.url || process.env.DATABASE_URL,
      },
    },
    log: logLevel as any,
  });

  logger.info('Database connection initialized', {
    poolSize: config.poolSize,
    timeout: config.connectionTimeout,
  });

  return prisma;
}

/**
 * 获取数据库实例
 */
export function getDatabase(): PrismaClient {
  if (!prisma) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return prisma;
}

/**
 * 检查数据库连接健康状态
 */
export async function checkDatabaseHealth(): Promise<{ healthy: boolean; error?: string }> {
  try {
    if (!prisma) {
      return { healthy: false, error: 'Database not initialized' };
    }

    // 执行简单查询测试连接
    await prisma.$queryRaw`SELECT 1`;
    
    return { healthy: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Database health check failed:', error);
    return { healthy: false, error: errorMessage };
  }
}

/**
 * 关闭数据库连接
 */
export async function closeDatabase(): Promise<void> {
  if (!prisma) {
    logger.warn('Database not initialized, nothing to close');
    return;
  }

  try {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection:', error);
    throw error;
  }
}

/**
 * 执行数据库事务
 */
export async function executeTransaction<T>(
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  const db = getDatabase();
  return await db.$transaction(async (tx: any) => {
    return await fn(tx as PrismaClient);
  });
}

// 导出类型
export * from '@prisma/client';

// 导出统计分析类
export { OpportunityAnalytics } from './analytics';
export type { FunnelAnalysis, MatrixAnalysis, PerformanceAnalysis } from './analytics';
