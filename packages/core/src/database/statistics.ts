/**
 * 统计服务
 * 
 * 计算和提供各种统计数据
 */

import { getDatabase } from './index';
import { createLogger } from '../logger';

const logger = createLogger('DatabaseStatistics');

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  successRate: number;
  totalNetProfit: bigint;
  avgProfitPerTrade: bigint;
  totalFees: bigint;
  avgFeePerTrade: bigint;
  avgRoi: number;
  bestTrade: {
    signature: string;
    profit: bigint;
    roi: number;
  } | null;
  worstTrade: {
    signature: string;
    profit: bigint;
    roi: number;
  } | null;
}

/**
 * ROI 分布
 */
export interface ROIDistribution {
  ranges: Array<{
    min: number;
    max: number;
    count: number;
    percentage: number;
  }>;
}

/**
 * DEX 性能
 */
export interface DEXPerformance {
  dexName: string;
  totalTrades: number;
  totalVolume: bigint;
  avgPriceImpact: number;
}

/**
 * 统计服务类
 */
export class DatabaseStatistics {
  /**
   * 计算每日统计
   */
  async calculateDailyStats(date: Date): Promise<void> {
    try {
      const db = getDatabase();
      
      const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      // 查询交易统计
      const [totalTrades, successfulTrades, failedTrades] = await Promise.all([
        db.trade.count({
          where: { tradeDate: startOfDay },
        }),
        db.trade.count({
          where: { tradeDate: startOfDay, status: 'success' },
        }),
        db.trade.count({
          where: { tradeDate: startOfDay, status: 'failed' },
        }),
      ]);

      // 查询机会统计
      const [opportunitiesFound, opportunitiesExecuted] = await Promise.all([
        db.opportunity.count({
          where: {
            discoveredAt: {
              gte: startOfDay,
              lt: endOfDay,
            },
          },
        }),
        db.opportunity.count({
          where: {
            discoveredAt: {
              gte: startOfDay,
              lt: endOfDay,
            },
            executed: true,
          },
        }),
      ]);

      // 查询利润和费用统计
      const profitStats = await db.trade.aggregate({
        where: { tradeDate: startOfDay },
        _sum: {
          grossProfit: true,
          netProfit: true,
          flashloanFee: true,
          jitoTip: true,
          gasFee: true,
          totalFee: true,
        },
        _avg: {
          netProfit: true,
          roi: true,
        },
        _max: {
          netProfit: true,
          roi: true,
        },
        _min: {
          netProfit: true,
          roi: true,
        },
      });

      const successRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;
      const executionRate = opportunitiesFound > 0 
        ? (opportunitiesExecuted / opportunitiesFound) * 100 
        : 0;

      // 插入或更新统计数据
      await db.dailyStatistic.upsert({
        where: { statDate: startOfDay },
        create: {
          statDate: startOfDay,
          totalTrades,
          successfulTrades,
          failedTrades,
          successRate,
          opportunitiesFound,
          opportunitiesExecuted,
          executionRate,
          totalGrossProfit: BigInt(profitStats._sum.grossProfit || 0),
          totalNetProfit: BigInt(profitStats._sum.netProfit || 0),
          avgProfitPerTrade: BigInt(Math.floor(profitStats._avg.netProfit || 0)),
          maxSingleProfit: BigInt(profitStats._max.netProfit || 0),
          minSingleProfit: BigInt(profitStats._min.netProfit || 0),
          totalFlashloanFee: BigInt(profitStats._sum.flashloanFee || 0),
          totalJitoTip: BigInt(profitStats._sum.jitoTip || 0),
          totalGasFee: BigInt(profitStats._sum.gasFee || 0),
          totalFees: BigInt(profitStats._sum.totalFee || 0),
          avgRoi: profitStats._avg.roi || 0,
          maxRoi: profitStats._max.roi || 0,
          minRoi: profitStats._min.roi || 0,
        },
        update: {
          totalTrades,
          successfulTrades,
          failedTrades,
          successRate,
          opportunitiesFound,
          opportunitiesExecuted,
          executionRate,
          totalGrossProfit: BigInt(profitStats._sum.grossProfit || 0),
          totalNetProfit: BigInt(profitStats._sum.netProfit || 0),
          avgProfitPerTrade: BigInt(Math.floor(profitStats._avg.netProfit || 0)),
          maxSingleProfit: BigInt(profitStats._max.netProfit || 0),
          minSingleProfit: BigInt(profitStats._min.netProfit || 0),
          totalFlashloanFee: BigInt(profitStats._sum.flashloanFee || 0),
          totalJitoTip: BigInt(profitStats._sum.jitoTip || 0),
          totalGasFee: BigInt(profitStats._sum.gasFee || 0),
          totalFees: BigInt(profitStats._sum.totalFee || 0),
          avgRoi: profitStats._avg.roi || 0,
          maxRoi: profitStats._max.roi || 0,
          minRoi: profitStats._min.roi || 0,
          updatedAt: new Date(),
        },
      });

      logger.info('Daily statistics calculated', { date: startOfDay });
    } catch (error) {
      logger.error('Failed to calculate daily statistics:', error);
      throw error;
    }
  }

  /**
   * 计算代币统计
   */
  async calculateTokenStats(
    tokenMint: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<void> {
    try {
      const db = getDatabase();

      const trades = await db.trade.findMany({
        where: {
          OR: [
            { inputMint: tokenMint },
            { bridgeMint: tokenMint },
          ],
          tradeDate: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
      });

      const totalTrades = trades.length;
      const successfulTrades = trades.filter((t: any) => t.status === 'success').length;
      const successRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;
      const totalNetProfit = trades.reduce((sum: bigint, t: any) => sum + t.netProfit, 0n);
      const avgProfitPerTrade = totalTrades > 0 ? totalNetProfit / BigInt(totalTrades) : 0n;

      await db.tokenStatistic.upsert({
        where: {
          tokenMint_periodStart_periodEnd: {
            tokenMint,
            periodStart,
            periodEnd,
          },
        },
        create: {
          tokenMint,
          periodStart,
          periodEnd,
          totalTrades,
          successfulTrades,
          successRate,
          totalNetProfit,
          avgProfitPerTrade,
        },
        update: {
          totalTrades,
          successfulTrades,
          successRate,
          totalNetProfit,
          avgProfitPerTrade,
          updatedAt: new Date(),
        },
      });

      logger.info('Token statistics calculated', { tokenMint, periodStart, periodEnd });
    } catch (error) {
      logger.error('Failed to calculate token statistics:', error);
      throw error;
    }
  }

  /**
   * 获取性能指标
   */
  async getPerformanceMetrics(
    startDate?: Date,
    endDate?: Date
  ): Promise<PerformanceMetrics> {
    try {
      const db = getDatabase();

      const where = startDate && endDate
        ? {
            tradeDate: {
              gte: startDate,
              lte: endDate,
            },
          }
        : {};

      const [totalTrades, successfulTrades, failedTrades, stats, bestTrade, worstTrade] =
        await Promise.all([
          db.trade.count({ where }),
          db.trade.count({ where: { ...where, status: 'success' } }),
          db.trade.count({ where: { ...where, status: 'failed' } }),
          db.trade.aggregate({
            where,
            _sum: {
              netProfit: true,
              totalFee: true,
            },
            _avg: {
              netProfit: true,
              totalFee: true,
              roi: true,
            },
          }),
          db.trade.findFirst({
            where,
            orderBy: { netProfit: 'desc' },
            select: { signature: true, netProfit: true, roi: true },
          }),
          db.trade.findFirst({
            where,
            orderBy: { netProfit: 'asc' },
            select: { signature: true, netProfit: true, roi: true },
          }),
        ]);

      const successRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;

      return {
        totalTrades,
        successfulTrades,
        failedTrades,
        successRate,
        totalNetProfit: BigInt(stats._sum.netProfit || 0),
        avgProfitPerTrade: BigInt(Math.floor(stats._avg.netProfit || 0)),
        totalFees: BigInt(stats._sum.totalFee || 0),
        avgFeePerTrade: BigInt(Math.floor(stats._avg.totalFee || 0)),
        avgRoi: Number(stats._avg.roi || 0),
        bestTrade: bestTrade
          ? {
              signature: bestTrade.signature,
              profit: bestTrade.netProfit,
              roi: Number(bestTrade.roi || 0),
            }
          : null,
        worstTrade: worstTrade
          ? {
              signature: worstTrade.signature,
              profit: worstTrade.netProfit,
              roi: Number(worstTrade.roi || 0),
            }
          : null,
      };
    } catch (error) {
      logger.error('Failed to get performance metrics:', error);
      throw error;
    }
  }

  /**
   * 获取 ROI 分布
   */
  async getROIDistribution(): Promise<ROIDistribution> {
    try {
      const db = getDatabase();

      const trades = await db.trade.findMany({
        where: {
          status: 'success',
          roi: { not: null },
        },
        select: { roi: true },
      });

      const ranges = [
        { min: 0, max: 1, count: 0 },
        { min: 1, max: 5, count: 0 },
        { min: 5, max: 10, count: 0 },
        { min: 10, max: 50, count: 0 },
        { min: 50, max: 100, count: 0 },
        { min: 100, max: Infinity, count: 0 },
      ];

      trades.forEach((trade: any) => {
        const roi = Number(trade.roi || 0);
        const range = ranges.find(r => roi >= r.min && roi < r.max);
        if (range) {
          range.count++;
        }
      });

      const total = trades.length;
      const distribution: ROIDistribution = {
        ranges: ranges.map(r => ({
          ...r,
          percentage: total > 0 ? (r.count / total) * 100 : 0,
        })),
      };

      return distribution;
    } catch (error) {
      logger.error('Failed to get ROI distribution:', error);
      throw error;
    }
  }

  /**
   * 获取 DEX 性能
   */
  async getDEXPerformance(): Promise<DEXPerformance[]> {
    try {
      const db = getDatabase();

      const routes = await db.tradeRoute.groupBy({
        by: ['dexName'],
        _count: true,
        _sum: {
          inputAmount: true,
        },
        _avg: {
          priceImpact: true,
        },
      });

      return routes.map((r: any) => ({
        dexName: r.dexName,
        totalTrades: r._count,
        totalVolume: BigInt(r._sum.inputAmount || 0),
        avgPriceImpact: Number(r._avg.priceImpact || 0),
      }));
    } catch (error) {
      logger.error('Failed to get DEX performance:', error);
      throw error;
    }
  }

  /**
   * 获取每日统计（从缓存表）
   */
  async getDailyStats(startDate: Date, endDate: Date) {
    try {
      const db = getDatabase();

      const stats = await db.dailyStatistic.findMany({
        where: {
          statDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: {
          statDate: 'asc',
        },
      });

      return stats;
    } catch (error) {
      logger.error('Failed to get daily stats:', error);
      throw error;
    }
  }
}

// 导出单例实例
export const databaseStatistics = new DatabaseStatistics();



