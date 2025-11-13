#!/usr/bin/env ts-node
/**
 * 机会漏斗分析工具
 * 
 * 用法：
 *   ts-node tools/analyze-opportunity-funnel.ts [--hours=24]
 */

import { initDatabase, OpportunityAnalytics } from '@solana-arb-bot/core';

async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  let hours = 24;  // 默认分析最近24小时
  
  for (const arg of args) {
    if (arg.startsWith('--hours=')) {
      hours = parseInt(arg.split('=')[1]);
    }
  }
  
  console.log(`\n📊 正在分析最近 ${hours} 小时的机会数据...\n`);
  
  // 初始化数据库
  await initDatabase();
  
  // 计算时间范围
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
  
  console.log(`时间范围: ${startTime.toLocaleString()} - ${endTime.toLocaleString()}\n`);
  
  // 生成漏斗分析报表
  const funnelReport = await OpportunityAnalytics.generateFunnelReport({
    startTime,
    endTime,
  });
  
  console.log(funnelReport);
  
  // 生成矩阵分析报表
  console.log('\n');
  const matrixReport = await OpportunityAnalytics.generateMatrixReport({
    startTime,
    endTime,
  });
  
  console.log(matrixReport);
  
  process.exit(0);
}

main().catch(error => {
  console.error('分析失败:', error);
  process.exit(1);
});
