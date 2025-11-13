#!/usr/bin/env ts-node
/**
 * 测试机会追踪系统
 * 
 * 验证数据库记录功能是否正常工作
 */

import { initDatabase, OpportunityAnalytics } from '../packages/core/src/database';
import { databaseRecorder } from '../packages/core/src/database/recorder';
import { OpportunityTrackingHelper } from '../packages/jupiter-bot/src/tracking-helper';

async function testTrackingSystem() {
  console.log('\n🧪 开始测试机会追踪系统...\n');
  
  try {
    // 1. 初始化数据库
    console.log('📦 步骤 1/6: 初始化数据库连接...');
    await initDatabase();
    console.log('✅ 数据库连接成功\n');
    
    // 2. 测试记录机会
    console.log('📝 步骤 2/6: 测试记录机会...');
    const opportunityId = await databaseRecorder.recordOpportunity({
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'So11111111111111111111111111111111111111112',
      bridgeToken: 'USDC',
      bridgeMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      inputAmount: BigInt(1000000000), // 1 SOL
      outputAmount: BigInt(1015000000), // 1.015 SOL
      bridgeAmount: BigInt(1500000), // 1.5 USDC
      expectedProfit: BigInt(15000000), // 0.015 SOL
      expectedRoi: 0.015,
      executed: false,
      filtered: false,
      metadata: { test: true },
    });
    console.log(`✅ 机会记录成功，ID: ${opportunityId}\n`);
    
    // 3. 测试记录并行任务
    console.log('⚡ 步骤 3/6: 测试记录并行任务...');
    await OpportunityTrackingHelper.recordParallelStart(opportunityId);
    console.log('✅ 并行任务开始记录成功');
    
    // 模拟延迟
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 4. 测试记录构建阶段
    console.log('\n🔨 步骤 4/6: 测试记录构建阶段...');
    const buildTracking = await OpportunityTrackingHelper.recordBuildStart(opportunityId);
    await new Promise(resolve => setTimeout(resolve, 50));
    await OpportunityTrackingHelper.recordBuildComplete(opportunityId, {
      buildStartTime: buildTracking.buildStartTime,
      buildStartMs: buildTracking.buildStartMs,
      buildSuccess: true,
      transactionSize: 1200,
      isBundleMode: false,
    });
    console.log('✅ 构建阶段记录成功');
    
    // 5. 测试记录模拟阶段
    console.log('\n🧪 步骤 5/6: 测试记录模拟阶段...');
    const simulationStartMs = Date.now();
    await new Promise(resolve => setTimeout(resolve, 80));
    await OpportunityTrackingHelper.recordSimulation(opportunityId, {
      simulationStartMs,
      simulationSuccess: true,
      simulationComputeUnits: 150000,
    });
    console.log('✅ 模拟阶段记录成功');
    
    // 6. 测试记录验证阶段
    console.log('\n✅ 步骤 6/6: 测试记录验证阶段...');
    const validationStartMs = Date.now();
    await new Promise(resolve => setTimeout(resolve, 60));
    await OpportunityTrackingHelper.recordValidation(opportunityId, {
      validationStartMs,
      validationSuccess: true,
      secondProfit: BigInt(14500000), // 0.0145 SOL
      secondRoi: 0.0145,
      priceDrift: -0.033,
      isProfitableAfterFees: true,
      estimatedGasFee: BigInt(5000),
      estimatedPriorityFee: BigInt(50000),
      estimatedJitoTip: BigInt(4000000), // 0.004 SOL
      estimatedSlippageBuffer: BigInt(500000), // 0.0005 SOL
      netProfitAfterFees: BigInt(10000000), // 0.01 SOL
    });
    console.log('✅ 验证阶段记录成功');
    
    // 7. 测试记录并行完成
    console.log('\n⚡ 记录并行任务完成...');
    await OpportunityTrackingHelper.recordParallelComplete(opportunityId, {
      parallelStartMs: Date.now() - 300,
      buildTotalLatencyMs: 150,
    });
    console.log('✅ 并行任务完成记录成功');
    
    // 8. 测试记录过滤判断
    console.log('\n🎯 记录过滤判断...');
    await OpportunityTrackingHelper.recordFilterJudgment(opportunityId, {
      passedSimulation: true,
      passedValidation: true,
      passedBoth: true,
      shouldExecute: true,
      executionStatus: 'pending_execution',
    });
    console.log('✅ 过滤判断记录成功');
    
    // 9. 查询统计数据
    console.log('\n📊 查询统计数据...');
    const funnel = await OpportunityAnalytics.getFunnelAnalysis();
    console.log('\n漏斗统计:');
    console.log(`  总机会数: ${funnel.totalOpportunities}`);
    console.log(`  构建成功: ${funnel.buildSuccess} (${funnel.buildSuccessRate.toFixed(1)}%)`);
    console.log(`  模拟通过: ${funnel.simulationPassed} (${funnel.simulationPassRate.toFixed(1)}%)`);
    console.log(`  验证通过: ${funnel.validationPassed} (${funnel.validationPassRate.toFixed(1)}%)`);
    console.log(`  同时通过: ${funnel.passedBoth} (${funnel.bothPassRate.toFixed(1)}%)`);
    console.log(`  应该执行: ${funnel.shouldExecute}`);
    
    console.log('\n性能统计:');
    console.log(`  平均构建耗时: ${funnel.avgBuildLatencyMs.toFixed(0)}ms`);
    console.log(`  平均模拟耗时: ${funnel.avgSimulationLatencyMs.toFixed(0)}ms`);
    console.log(`  平均验证耗时: ${funnel.avgValidationLatencyMs.toFixed(0)}ms`);
    console.log(`  并行总耗时: ${funnel.avgParallelTotalLatencyMs.toFixed(0)}ms`);
    console.log(`  并行节省: ${funnel.parallelSavingsMs.toFixed(0)}ms (${funnel.parallelSavingsPercent.toFixed(1)}%)`);
    
    // 10. 生成报表
    console.log('\n📈 生成完整报表...\n');
    const report = await OpportunityAnalytics.generateFunnelReport();
    console.log(report);
    
    console.log('\n' + '='.repeat(80));
    console.log('🎉 测试完成！所有功能正常工作！');
    console.log('='.repeat(80) + '\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    console.error('\n可能的原因:');
    console.error('  1. 数据库迁移未运行 → 运行: cd packages/core && pnpm prisma migrate deploy');
    console.error('  2. Prisma客户端未生成 → 运行: cd packages/core && pnpm prisma generate');
    console.error('  3. 数据库连接失败 → 检查 DATABASE_URL 环境变量');
    console.error('  4. 权限问题 → 检查数据库用户权限\n');
    process.exit(1);
  }
}

testTrackingSystem();
