/**
 * 数据清理服务
 * 
 * 自动清理过期数据
 */

import { getDatabase } from './index';
import { createLogger } from '../logger';

const logger = createLogger('DatabaseCleanup');

/**
 * 清理配置
 */
export interface CleanupConfig {
  /** 机会记录保留天数 */
  opportunitiesRetentionDays: number;
  /** 是否启用自动清理 */
  enableAutoCleanup: boolean;
  /** 清理计划（cron 格式） */
  cleanupSchedule?: string;
}

/**
 * 数据库清理服务类
 */
export class DatabaseCleanup {
  private config: CleanupConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: CleanupConfig) {
    this.config = config;
  }

  /**
   * 清理30天前的机会记录
   */
  async cleanupOldOpportunities(days: number = 30): Promise<number> {
    try {
      const db = getDatabase();
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await db.opportunity.deleteMany({
        where: {
          discoveredAt: {
            lt: cutoffDate,
          },
        },
      });

      logger.info(`Cleaned up ${result.count} old opportunities (older than ${days} days)`);
      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup old opportunities:', error);
      throw error;
    }
  }

  /**
   * 清理未执行且已过滤的机会
   */
  async cleanupFilteredOpportunities(days: number = 7): Promise<number> {
    try {
      const db = getDatabase();
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await db.opportunity.deleteMany({
        where: {
          discoveredAt: {
            lt: cutoffDate,
          },
          filtered: true,
          executed: false,
        },
      });

      logger.info(`Cleaned up ${result.count} filtered opportunities (older than ${days} days)`);
      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup filtered opportunities:', error);
      throw error;
    }
  }

  /**
   * 清理孤立的路由记录（没有关联交易的路由）
   */
  async cleanupOrphanedRoutes(): Promise<number> {
    try {
      const db = getDatabase();
      
      // 查找所有存在的交易ID
      const trades = await db.trade.findMany({
        select: { id: true },
      });
      const tradeIds = trades.map((t: any) => t.id);

      // 删除不在交易列表中的路由
      const result = await db.tradeRoute.deleteMany({
        where: {
          tradeId: {
            notIn: tradeIds,
          },
        },
      });

      if (result.count > 0) {
        logger.info(`Cleaned up ${result.count} orphaned routes`);
      }
      
      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup orphaned routes:', error);
      throw error;
    }
  }

  /**
   * 执行完整清理
   */
  async performFullCleanup(): Promise<{
    opportunitiesDeleted: number;
    filteredDeleted: number;
    orphanedRoutesDeleted: number;
  }> {
    logger.info('Starting full database cleanup...');

    const [opportunitiesDeleted, filteredDeleted, orphanedRoutesDeleted] = await Promise.all([
      this.cleanupOldOpportunities(this.config.opportunitiesRetentionDays),
      this.cleanupFilteredOpportunities(7),
      this.cleanupOrphanedRoutes(),
    ]);

    logger.info('Full database cleanup completed', {
      opportunitiesDeleted,
      filteredDeleted,
      orphanedRoutesDeleted,
    });

    return {
      opportunitiesDeleted,
      filteredDeleted,
      orphanedRoutesDeleted,
    };
  }

  /**
   * 启动定时清理任务
   */
  startAutoCleanup(intervalHours: number = 24): void {
    if (!this.config.enableAutoCleanup) {
      logger.info('Auto cleanup is disabled');
      return;
    }

    if (this.cleanupTimer) {
      logger.warn('Auto cleanup already running');
      return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    this.cleanupTimer = setInterval(async () => {
      try {
        await this.performFullCleanup();
      } catch (error) {
        logger.error('Auto cleanup failed:', error);
      }
    }, intervalMs);

    logger.info(`Auto cleanup started (interval: ${intervalHours} hours)`);
  }

  /**
   * 停止定时清理任务
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      logger.info('Auto cleanup stopped');
    }
  }

  /**
   * 获取数据库统计信息
   */
  async getDatabaseStats(): Promise<{
    totalTrades: number;
    totalOpportunities: number;
    totalRoutes: number;
    oldestTrade: Date | null;
    oldestOpportunity: Date | null;
  }> {
    try {
      const db = getDatabase();

      const [totalTrades, totalOpportunities, totalRoutes, oldestTrade, oldestOpportunity] =
        await Promise.all([
          db.trade.count(),
          db.opportunity.count(),
          db.tradeRoute.count(),
          db.trade.findFirst({
            orderBy: { executedAt: 'asc' },
            select: { executedAt: true },
          }),
          db.opportunity.findFirst({
            orderBy: { discoveredAt: 'asc' },
            select: { discoveredAt: true },
          }),
        ]);

      return {
        totalTrades,
        totalOpportunities,
        totalRoutes,
        oldestTrade: oldestTrade?.executedAt || null,
        oldestOpportunity: oldestOpportunity?.discoveredAt || null,
      };
    } catch (error) {
      logger.error('Failed to get database stats:', error);
      throw error;
    }
  }

  /**
   * 获取验证数据统计
   */
  async getValidationStats(): Promise<{
    totalValidations: number;
    stillExistsCount: number;
    avgDelayMs: number;
    survivalRate: number;
  }> {
    try {
      const db = getDatabase();

      const [totalValidations, stillExistsCount, avgDelayResult] = await Promise.all([
        db.opportunityValidation.count(),
        db.opportunityValidation.count({
          where: { stillExists: true },
        }),
        db.opportunityValidation.aggregate({
          _avg: { validationDelayMs: true },
        }),
      ]);

      const survivalRate = totalValidations > 0 
        ? (stillExistsCount / totalValidations) * 100 
        : 0;

      return {
        totalValidations,
        stillExistsCount,
        avgDelayMs: avgDelayResult._avg.validationDelayMs || 0,
        survivalRate,
      };
    } catch (error) {
      logger.error('Failed to get validation stats:', error);
      throw error;
    }
  }
}

/**
 * 创建清理服务实例
 */
export function createCleanupService(config: CleanupConfig): DatabaseCleanup {
  return new DatabaseCleanup(config);
}



