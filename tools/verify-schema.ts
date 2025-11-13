#!/usr/bin/env tsx
/**
 * 验证数据库Schema
 */

import { initDatabase, getDatabase } from '../packages/core/src/database';

async function verifySchema() {
  console.log('\n🔍 验证数据库Schema...\n');
  
  try {
    await initDatabase();
    const db = getDatabase();
    
    // 查询opportunities表的所有列
    const columns = await db.$queryRaw<Array<{ column_name: string; data_type: string }>>`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'opportunities'
      AND (
        column_name LIKE '%parallel%' OR
        column_name LIKE '%build%' OR
        column_name LIKE '%simulation%' OR
        column_name LIKE '%validation%' OR
        column_name LIKE '%passed%'
      )
      ORDER BY column_name
    `;
    
    console.log('📊 追踪相关字段:');
    console.log('='.repeat(60));
    
    if (columns.length === 0) {
      console.log('❌ 未找到追踪字段！迁移可能未正确应用。');
      console.log('\n请运行:');
      console.log('  cd packages/core');
      console.log('  pnpm prisma migrate deploy');
      console.log('  pnpm prisma generate');
    } else {
      columns.forEach(col => {
        console.log(`✅ ${col.column_name.padEnd(35)} ${col.data_type}`);
      });
      console.log('\n✅ 共找到 ' + columns.length + ' 个追踪字段');
    }
    
    console.log('='.repeat(60) + '\n');
    
    // 测试单个机会的数据
    const testOpp = await db.opportunity.findFirst({
      orderBy: { id: 'desc' },
      select: {
        id: true,
        buildSuccess: true,
        buildLatencyMs: true,
        simulationSuccess: true,
        simulationLatencyMs: true,
        validationSuccess: true,
        validationLatencyMs: true,
        passedSimulation: true,
        passedValidation: true,
        passedBoth: true,
      },
    });
    
    if (testOpp) {
      console.log('📝 最新机会记录（ID: ' + testOpp.id + '):');
      console.log('  构建成功:', testOpp.buildSuccess);
      console.log('  构建耗时:', testOpp.buildLatencyMs, 'ms');
      console.log('  模拟成功:', testOpp.simulationSuccess);
      console.log('  模拟耗时:', testOpp.simulationLatencyMs, 'ms');
      console.log('  验证成功:', testOpp.validationSuccess);
      console.log('  验证耗时:', testOpp.validationLatencyMs, 'ms');
      console.log('  通过模拟:', testOpp.passedSimulation);
      console.log('  通过验证:', testOpp.passedValidation);
      console.log('  同时通过:', testOpp.passedBoth);
    }
    
    console.log('\n✅ Schema验证完成！\n');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ 验证失败:', error);
    process.exit(1);
  }
}

verifySchema();
