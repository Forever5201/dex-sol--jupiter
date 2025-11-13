#!/usr/bin/env tsx
/**
 * 检查最新的记录
 */

import { initDatabase, getDatabase } from '../packages/core/src/database';

async function checkLatestRecord() {
  try {
    await initDatabase();
    const db = getDatabase();
    
    // 查询最新的记录
    const latest = await db.opportunity.findFirst({
      where: {
        id: BigInt(12713), // 刚刚测试创建的ID
      },
    });
    
    if (!latest) {
      console.log('❌ 未找到记录 ID=12713');
      process.exit(1);
    }
    
    console.log('\n📊 最新测试记录 (ID: 12713):');
    console.log('='.repeat(70));
    
    console.log('\n🔨 构建阶段:');
    console.log('  started_at:', latest.buildStartedAt);
    console.log('  completed_at:', latest.buildCompletedAt);
    console.log('  latency_ms:', latest.buildLatencyMs);
    console.log('  success:', latest.buildSuccess);
    console.log('  error:', latest.buildError);
    console.log('  transaction_size:', latest.transactionSize);
    console.log('  is_bundle_mode:', latest.isBundleMode);
    
    console.log('\n🧪 模拟阶段:');
    console.log('  started_at:', latest.simulationStartedAt);
    console.log('  completed_at:', latest.simulationCompletedAt);
    console.log('  latency_ms:', latest.simulationLatencyMs);
    console.log('  success:', latest.simulationSuccess);
    console.log('  error:', latest.simulationError);
    console.log('  compute_units:', latest.simulationComputeUnits);
    
    console.log('\n✅ 验证阶段:');
    console.log('  started_at:', latest.validationStartedAt);
    console.log('  completed_at:', latest.validationCompletedAt);
    console.log('  latency_ms:', latest.validationLatencyMs);
    console.log('  success:', latest.validationSuccess);
    console.log('  second_profit:', latest.secondProfit);
    console.log('  second_roi:', latest.secondRoi);
    console.log('  price_drift:', latest.priceDrift);
    console.log('  is_profitable_after_fees:', latest.isProfitableAfterFees);
    console.log('  estimated_gas_fee:', latest.estimatedGasFee);
    console.log('  estimated_priority_fee:', latest.estimatedPriorityFee);
    console.log('  estimated_jito_tip:', latest.estimatedJitoTip);
    console.log('  estimated_slippage_buffer:', latest.estimatedSlippageBuffer);
    console.log('  net_profit_after_fees:', latest.netProfitAfterFees);
    
    console.log('\n⚡ 并行处理:');
    console.log('  parallel_started_at:', latest.parallelStartedAt);
    console.log('  parallel_completed_at:', latest.parallelCompletedAt);
    console.log('  parallel_total_latency_ms:', latest.parallelTotalLatencyMs);
    console.log('  build_total_latency_ms:', latest.buildTotalLatencyMs);
    
    console.log('\n🎯 过滤判断:');
    console.log('  passed_simulation:', latest.passedSimulation);
    console.log('  passed_validation:', latest.passedValidation);
    console.log('  passed_both:', latest.passedBoth);
    console.log('  should_execute:', latest.shouldExecute);
    console.log('  execution_status:', latest.executionStatus);
    
    console.log('\n' + '='.repeat(70));
    
    // 统计哪些字段有数据
    const fieldsWithData = [];
    const fieldsEmpty = [];
    
    if (latest.buildSuccess !== null) fieldsWithData.push('build');
    else fieldsEmpty.push('build');
    
    if (latest.simulationSuccess !== null) fieldsWithData.push('simulation');
    else fieldsEmpty.push('simulation');
    
    if (latest.validationSuccess !== null) fieldsWithData.push('validation');
    else fieldsEmpty.push('validation');
    
    if (latest.parallelStartedAt !== null) fieldsWithData.push('parallel');
    else fieldsEmpty.push('parallel');
    
    if (latest.passedBoth !== null) fieldsWithData.push('filter_judgment');
    else fieldsEmpty.push('filter_judgment');
    
    console.log('\n✅ 有数据的阶段:', fieldsWithData.join(', ') || '无');
    console.log('❌ 无数据的阶段:', fieldsEmpty.join(', ') || '无');
    
    if (fieldsWithData.length > 0) {
      console.log('\n🎉 系统能够正常记录数据！');
    } else {
      console.log('\n⚠️  警告：所有追踪字段都为空');
    }
    
    console.log('\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ 查询失败:', error);
    process.exit(1);
  }
}

checkLatestRecord();
