/**
 * LST套利机会统计分析工具
 * 
 * 用于统计和分析LST（mSOL, jitoSOL）相关的套利机会
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:Yuan971035088@localhost:5432/postgres"
    }
  }
});

// LST代币配置
const LST_TOKENS = {
  mSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  jitoSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
};

interface LSTStats {
  token: string;
  totalOpportunities: number;
  executedOpportunities: number;
  avgProfit: number;
  totalProfit: bigint;
  avgRoi: number;
  maxProfit: bigint;
  minProfit: bigint;
}

async function main() {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('💎 LST套利机会统计分析');
  console.log('════════════════════════════════════════════════════════════════\n');

  try {
    // 1. 总体统计
    await printOverallStats();

    // 2. 按LST代币统计
    await printLSTTokenStats();

    // 3. 按时间统计（今天、本周、本月）
    await printTimeBasedStats();

    // 4. 按套利类型统计
    await printArbitrageTypeStats();

    // 5. 执行率统计
    await printExecutionStats();

    // 6. 利润分布
    await printProfitDistribution();

  } catch (error: any) {
    console.error('❌ 统计失败:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 总体统计
 */
async function printOverallStats() {
  console.log('1️⃣  总体统计');
  console.log('─'.repeat(60));

  const totalCount = await prisma.opportunity.count({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
    },
  });

  const executedCount = await prisma.opportunity.count({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
      executed: true,
    },
  });

  const profitStats = await prisma.opportunity.aggregate({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
    },
    _sum: { expectedProfit: true },
    _avg: { expectedProfit: true, expectedRoi: true },
    _max: { expectedProfit: true },
    _min: { expectedProfit: true },
  });

  console.log(`   总LST机会数: ${totalCount}`);
  console.log(`   已执行数: ${executedCount} (${((executedCount / totalCount) * 100).toFixed(1)}%)`);
  console.log(`   平均利润: ${(Number(profitStats._avg.expectedProfit || 0) / 1e9).toFixed(6)} SOL`);
  console.log(`   总利润潜力: ${(Number(profitStats._sum.expectedProfit || 0) / 1e9).toFixed(4)} SOL`);
  console.log(`   平均ROI: ${(profitStats._avg.expectedRoi || 0).toFixed(2)}%`);
  console.log(`   最大利润: ${(Number(profitStats._max.expectedProfit || 0) / 1e9).toFixed(6)} SOL`);
  console.log(`   最小利润: ${(Number(profitStats._min.expectedProfit || 0) / 1e9).toFixed(6)} SOL`);
  console.log('');
}

/**
 * 按LST代币统计
 */
async function printLSTTokenStats() {
  console.log('2️⃣  按LST代币统计');
  console.log('─'.repeat(60));

  for (const [symbol, mint] of Object.entries(LST_TOKENS)) {
    const stats = await getLSTTokenStats(symbol, mint);
    
    console.log(`\n   🔸 ${symbol}`);
    console.log(`      机会数: ${stats.totalOpportunities}`);
    console.log(`      已执行: ${stats.executedOpportunities} (${((stats.executedOpportunities / stats.totalOpportunities) * 100).toFixed(1)}%)`);
    console.log(`      平均利润: ${stats.avgProfit.toFixed(6)} SOL`);
    console.log(`      总利润: ${(Number(stats.totalProfit) / 1e9).toFixed(4)} SOL`);
    console.log(`      平均ROI: ${stats.avgRoi.toFixed(2)}%`);
    console.log(`      最大利润: ${(Number(stats.maxProfit) / 1e9).toFixed(6)} SOL`);
  }
  console.log('');
}

/**
 * 获取单个LST代币统计
 */
async function getLSTTokenStats(symbol: string, mint: string): Promise<LSTStats> {
  const totalOpportunities = await prisma.opportunity.count({
    where: {
      OR: [
        { inputMint: mint },
        { outputMint: mint },
        { bridgeMint: mint },
        { bridgeToken: symbol },
      ],
    },
  });

  const executedOpportunities = await prisma.opportunity.count({
    where: {
      OR: [
        { inputMint: mint },
        { outputMint: mint },
        { bridgeMint: mint },
        { bridgeToken: symbol },
      ],
      executed: true,
    },
  });

  const profitStats = await prisma.opportunity.aggregate({
    where: {
      OR: [
        { inputMint: mint },
        { outputMint: mint },
        { bridgeMint: mint },
        { bridgeToken: symbol },
      ],
    },
    _sum: { expectedProfit: true },
    _avg: { expectedProfit: true, expectedRoi: true },
    _max: { expectedProfit: true },
    _min: { expectedProfit: true },
  });

  return {
    token: symbol,
    totalOpportunities,
    executedOpportunities,
    avgProfit: Number(profitStats._avg.expectedProfit || 0) / 1e9,
    totalProfit: profitStats._sum.expectedProfit || 0n,
    avgRoi: profitStats._avg.expectedRoi || 0,
    maxProfit: profitStats._max.expectedProfit || 0n,
    minProfit: profitStats._min.expectedProfit || 0n,
  };
}

/**
 * 按时间统计
 */
async function printTimeBasedStats() {
  console.log('3️⃣  按时间统计');
  console.log('─'.repeat(60));

  const now = new Date();
  
  // 今天
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayCount = await countLSTOpportunitiesByDate(todayStart, now);
  console.log(`   今天: ${todayCount} 个LST机会`);

  // 本周
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const weekCount = await countLSTOpportunitiesByDate(weekStart, now);
  console.log(`   本周: ${weekCount} 个LST机会 (平均 ${(weekCount / 7).toFixed(1)}/天)`);

  // 本月
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthCount = await countLSTOpportunitiesByDate(monthStart, now);
  const daysInMonth = now.getDate();
  console.log(`   本月: ${monthCount} 个LST机会 (平均 ${(monthCount / daysInMonth).toFixed(1)}/天)`);

  // 全部时间
  const firstOpportunity = await prisma.opportunity.findFirst({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
    },
    orderBy: { discoveredAt: 'asc' },
    select: { discoveredAt: true },
  });

  if (firstOpportunity) {
    const totalDays = Math.ceil((now.getTime() - firstOpportunity.discoveredAt.getTime()) / (1000 * 60 * 60 * 24));
    const totalCount = await prisma.opportunity.count({
      where: {
        OR: [
          { inputMint: { in: Object.values(LST_TOKENS) } },
          { outputMint: { in: Object.values(LST_TOKENS) } },
          { bridgeMint: { in: Object.values(LST_TOKENS) } },
          { bridgeToken: { in: Object.keys(LST_TOKENS) } },
        ],
      },
    });
    console.log(`   全部时间: ${totalCount} 个LST机会 (${totalDays}天, 平均 ${(totalCount / totalDays).toFixed(1)}/天)`);
  }
  console.log('');
}

/**
 * 按日期范围统计LST机会数量
 */
async function countLSTOpportunitiesByDate(start: Date, end: Date): Promise<number> {
  return await prisma.opportunity.count({
    where: {
      discoveredAt: {
        gte: start,
        lte: end,
      },
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
    },
  });
}

/**
 * 按套利类型统计
 */
async function printArbitrageTypeStats() {
  console.log('4️⃣  按套利类型统计');
  console.log('─'.repeat(60));

  // 通过metadata分析路由类型
  const opportunities = await prisma.opportunity.findMany({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
    },
    select: {
      metadata: true,
      bridgeToken: true,
    },
  });

  const typeStats: Record<string, number> = {
    '折价套利': 0,
    '多DEX价差': 0,
    '三角套利': 0,
    '其他': 0,
  };

  opportunities.forEach(opp => {
    // 简单分类逻辑
    if (opp.bridgeToken && Object.keys(LST_TOKENS).includes(opp.bridgeToken)) {
      typeStats['三角套利']++;
    } else {
      typeStats['多DEX价差']++;
    }
  });

  console.log(`   折价套利: ${typeStats['折价套利']} 个`);
  console.log(`   多DEX价差: ${typeStats['多DEX价差']} 个`);
  console.log(`   三角套利: ${typeStats['三角套利']} 个`);
  console.log(`   其他: ${typeStats['其他']} 个`);
  console.log('');
}

/**
 * 执行率统计
 */
async function printExecutionStats() {
  console.log('5️⃣  执行率统计');
  console.log('─'.repeat(60));

  const totalOpportunities = await prisma.opportunity.count({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
    },
  });

  const executedOpportunities = await prisma.opportunity.count({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
      executed: true,
    },
  });

  const filteredOpportunities = await prisma.opportunity.count({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
      filtered: true,
    },
  });

  const executionRate = totalOpportunities > 0 ? (executedOpportunities / totalOpportunities) * 100 : 0;
  const filterRate = totalOpportunities > 0 ? (filteredOpportunities / totalOpportunities) * 100 : 0;

  console.log(`   总机会: ${totalOpportunities}`);
  console.log(`   已执行: ${executedOpportunities} (${executionRate.toFixed(1)}%)`);
  console.log(`   已过滤: ${filteredOpportunities} (${filterRate.toFixed(1)}%)`);
  console.log(`   未处理: ${totalOpportunities - executedOpportunities - filteredOpportunities}`);
  console.log('');
}

/**
 * 利润分布
 */
async function printProfitDistribution() {
  console.log('6️⃣  利润分布（SOL）');
  console.log('─'.repeat(60));

  const opportunities = await prisma.opportunity.findMany({
    where: {
      OR: [
        { inputMint: { in: Object.values(LST_TOKENS) } },
        { outputMint: { in: Object.values(LST_TOKENS) } },
        { bridgeMint: { in: Object.values(LST_TOKENS) } },
        { bridgeToken: { in: Object.keys(LST_TOKENS) } },
      ],
    },
    select: {
      expectedProfit: true,
    },
  });

  const distribution = {
    '<0.001': 0,
    '0.001-0.01': 0,
    '0.01-0.1': 0,
    '0.1-1': 0,
    '>1': 0,
  };

  opportunities.forEach(opp => {
    const profitSol = Number(opp.expectedProfit) / 1e9;
    
    if (profitSol < 0.001) distribution['<0.001']++;
    else if (profitSol < 0.01) distribution['0.001-0.01']++;
    else if (profitSol < 0.1) distribution['0.01-0.1']++;
    else if (profitSol < 1) distribution['0.1-1']++;
    else distribution['>1']++;
  });

  const total = opportunities.length;
  console.log(`   <0.001 SOL: ${distribution['<0.001']} (${((distribution['<0.001'] / total) * 100).toFixed(1)}%)`);
  console.log(`   0.001-0.01 SOL: ${distribution['0.001-0.01']} (${((distribution['0.001-0.01'] / total) * 100).toFixed(1)}%)`);
  console.log(`   0.01-0.1 SOL: ${distribution['0.01-0.1']} (${((distribution['0.01-0.1'] / total) * 100).toFixed(1)}%)`);
  console.log(`   0.1-1 SOL: ${distribution['0.1-1']} (${((distribution['0.1-1'] / total) * 100).toFixed(1)}%)`);
  console.log(`   >1 SOL: ${distribution['>1']} (${((distribution['>1'] / total) * 100).toFixed(1)}%)`);
  console.log('');
}

main().then(() => {
  console.log('✅ 统计完成！\n');
});


























