# 机会追踪系统使用指南

## 📊 概述

本系统提供完整的机会处理追踪功能，记录从机会发现到执行的完整流程，包括：

- **并行任务追踪**：记录构建+模拟和二次验证的并行执行
- **各阶段详细数据**：构建、模拟、验证的时间、成功率、错误信息
- **费用估算**：记录Gas费、优先费、Jito Tip、滑点缓冲等
- **过滤判断**：记录各阶段通过情况和最终执行决策
- **漏斗分析**：统计各阶段的转化率和性能指标

## 🚀 快速开始

### 1. 运行数据库迁移

```bash
cd packages/core
pnpm prisma migrate deploy
pnpm prisma generate
```

### 2. 启动机器人

系统会自动记录所有机会数据到数据库。

### 3. 查看统计分析

```bash
# 分析最近24小时的数据
ts-node tools/analyze-opportunity-funnel.ts

# 分析最近48小时的数据
ts-node tools/analyze-opportunity-funnel.ts --hours=48

# 分析最近7天的数据
ts-node tools/analyze-opportunity-funnel.ts --hours=168
```

## 📈 记录的数据

### 并行任务统计

| 字段 | 说明 |
|------|------|
| `parallel_started_at` | 并行任务开始时间 |
| `parallel_completed_at` | 并行任务完成时间 |
| `parallel_total_latency_ms` | 并行总耗时（取最长路径） |
| `build_total_latency_ms` | 构建+模拟总耗时 |

### 构建阶段

| 字段 | 说明 |
|------|------|
| `build_started_at` | 构建开始时间 |
| `build_completed_at` | 构建完成时间（模拟前） |
| `build_latency_ms` | 纯构建耗时 |
| `build_success` | 构建是否成功 |
| `build_error` | 构建失败原因 |
| `transaction_size` | 交易大小（字节） |
| `is_bundle_mode` | 是否使用Bundle模式 |

### 模拟阶段

| 字段 | 说明 |
|------|------|
| `simulation_started_at` | 模拟开始时间 |
| `simulation_completed_at` | 模拟完成时间 |
| `simulation_latency_ms` | 模拟耗时 |
| `simulation_success` | 模拟是否成功 |
| `simulation_error` | 模拟失败原因 |
| `simulation_compute_units` | 消耗的计算单元 |

### 验证阶段

| 字段 | 说明 |
|------|------|
| `validation_started_at` | 验证开始时间 |
| `validation_completed_at` | 验证完成时间 |
| `validation_latency_ms` | 验证耗时 |
| `validation_success` | 验证是否成功 |
| `second_profit` | 二次验证后的利润 |
| `second_roi` | 二次验证后的ROI |
| `price_drift` | 价格漂移比例 |
| `is_profitable_after_fees` | 扣费后是否盈利 |
| `estimated_gas_fee` | 估算的Gas费 |
| `estimated_priority_fee` | 估算的优先费 |
| `estimated_jito_tip` | 估算的Jito Tip |
| `estimated_slippage_buffer` | 估算的滑点缓冲 |
| `net_profit_after_fees` | 扣费后净利润 |

### 过滤判断

| 字段 | 说明 |
|------|------|
| `passed_simulation` | 是否通过模拟测试 |
| `passed_validation` | 是否通过二次验证 |
| `passed_both` | 是否同时通过两者 |
| `should_execute` | 是否应该执行 |
| `execution_status` | 执行状态 |

## 📊 统计分析

### 漏斗分析

查看各阶段的转化率：

```
📊 机会处理漏斗分析
================================================================================

📈 总体统计
  总机会数：1000

🔨 构建阶段
  成功：950 (95.0%)
  失败：50 (5.0%)
  平均耗时：125ms

🧪 模拟阶段
  通过：800 (84.2%)
  失败：150 (15.8%)
  平均耗时：230ms

✅ 验证阶段
  通过：850 (85.0%)
  失败：150 (15.0%)
  平均耗时：180ms

🎯 综合判断
  同时通过（模拟&验证）：750 (75.0%)
  应该执行：800
  实际执行：800
  执行成功：780

⚡ 并行处理性能
  构建+模拟总耗时：355ms
  验证耗时：180ms
  串行总耗时（估算）：535ms
  并行实际耗时：360ms
  节省时间：175ms (32.7%)
```

### 矩阵分析

对比模拟和验证的一致性：

```
📊 模拟 vs 验证矩阵分析
================================================================================

                │ 验证通过      │ 验证失败      │
────────────────┼───────────────┼───────────────┤
模拟通过        │    750 (75.0%)│     50 ( 5.0%)│
                │ 平均利润:     │ 平均利润:     │
                │     0.015000  │     0.012000  │
────────────────┼───────────────┼───────────────┤
模拟失败        │    100 (10.0%)│    100 (10.0%)│
                │ 平均利润:     │               │
                │     0.008000  │               │
```

## 🔍 数据库查询示例

### 查看最近的机会

```sql
SELECT 
  id,
  discovered_at,
  expected_profit / 1e9 as profit_sol,
  build_success,
  simulation_success,
  passed_validation,
  passed_both,
  execution_status
FROM opportunities
ORDER BY discovered_at DESC
LIMIT 20;
```

### 计算通过率

```sql
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN build_success THEN 1 ELSE 0 END) as build_success_count,
  SUM(CASE WHEN passed_simulation THEN 1 ELSE 0 END) as simulation_passed_count,
  SUM(CASE WHEN passed_validation THEN 1 ELSE 0 END) as validation_passed_count,
  SUM(CASE WHEN passed_both THEN 1 ELSE 0 END) as both_passed_count,
  
  -- 计算通过率
  ROUND(100.0 * SUM(CASE WHEN build_success THEN 1 ELSE 0 END) / COUNT(*), 2) as build_success_rate,
  ROUND(100.0 * SUM(CASE WHEN passed_simulation THEN 1 ELSE 0 END) / COUNT(*), 2) as simulation_pass_rate,
  ROUND(100.0 * SUM(CASE WHEN passed_validation THEN 1 ELSE 0 END) / COUNT(*), 2) as validation_pass_rate,
  ROUND(100.0 * SUM(CASE WHEN passed_both THEN 1 ELSE 0 END) / COUNT(*), 2) as both_pass_rate
FROM opportunities
WHERE discovered_at > NOW() - INTERVAL '24 hours';
```

### 查看平均耗时

```sql
SELECT 
  AVG(build_latency_ms) as avg_build_ms,
  AVG(simulation_latency_ms) as avg_simulation_ms,
  AVG(validation_latency_ms) as avg_validation_ms,
  AVG(parallel_total_latency_ms) as avg_parallel_total_ms,
  AVG(build_total_latency_ms) as avg_build_total_ms,
  
  -- 计算并行收益
  AVG(build_total_latency_ms + validation_latency_ms) as serial_time,
  AVG(parallel_total_latency_ms) as parallel_time,
  AVG(build_total_latency_ms + validation_latency_ms - parallel_total_latency_ms) as saved_time_ms
FROM opportunities
WHERE discovered_at > NOW() - INTERVAL '24 hours'
  AND build_success = true;
```

### 查看费用估算统计

```sql
SELECT 
  COUNT(*) as validated_count,
  COUNT(CASE WHEN is_profitable_after_fees THEN 1 END) as profitable_after_fees_count,
  
  -- 平均费用（SOL）
  AVG(estimated_gas_fee / 1e9) as avg_gas_fee_sol,
  AVG(estimated_priority_fee / 1e9) as avg_priority_fee_sol,
  AVG(estimated_jito_tip / 1e9) as avg_jito_tip_sol,
  AVG(estimated_slippage_buffer / 1e9) as avg_slippage_buffer_sol,
  
  -- 平均利润（SOL）
  AVG(second_profit / 1e9) as avg_gross_profit_sol,
  AVG(net_profit_after_fees / 1e9) as avg_net_profit_sol
FROM opportunities
WHERE passed_validation = true
  AND discovered_at > NOW() - INTERVAL '24 hours';
```

## 🎯 关键指标

### 1. 构建成功率

**目标**: > 95%

**低于目标可能原因**：
- Worker缓存的quote过期
- 路由复杂度过高
- 交易大小超限

### 2. 模拟通过率

**目标**: > 80%

**低于目标可能原因**：
- 价格滑点过大
- 流动性不足
- 闪电贷参数配置问题

### 3. 验证通过率

**目标**: > 80%

**低于目标可能原因**：
- 价格漂移快
- Worker和主线程延迟大
- 市场波动剧烈

### 4. 模拟&验证一致性

**目标**: 同时通过率 > 70%

**低于目标可能原因**：
- 模拟和验证使用不同数据源
- 时间差导致价格变化
- 需要调整阈值

### 5. 并行处理收益

**目标**: 节省时间 > 30%

**低于目标可能原因**：
- 验证耗时过短（并行收益小）
- 构建+模拟总耗时过长
- 需要优化某个阶段

### 6. 费用后盈利率

**目标**: 扣费后盈利 > 60%

**低于目标可能原因**：
- Jito Tip比例过高
- 优先费估算过高
- 需要提高Worker阈值

## 🛠️ 优化建议

### 提高构建成功率

1. 减少Worker到主线程的延迟
2. 增加quote缓存时间
3. 优化路由选择策略

### 提高模拟通过率

1. 调整滑点容忍度
2. 过滤低流动性池子
3. 优化闪电贷金额计算

### 提高验证通过率

1. 缩短二次验证延迟
2. 使用相同的路由引擎
3. 调整验证阈值

### 提高并行收益

1. 优化构建逻辑减少耗时
2. 优化模拟逻辑减少RPC调用
3. 并行执行更多独立任务

### 提高费用后盈利率

1. 动态调整Jito Tip比例
2. 优化优先费估算策略
3. 提高Worker初步阈值
4. 减少不必要的费用开销

## 📝 代码示例

### 在代码中查询统计数据

```typescript
import { OpportunityAnalytics } from '@solana-arb-bot/core';

// 获取漏斗分析
const funnel = await OpportunityAnalytics.getFunnelAnalysis({
  startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
  endTime: new Date(),
});

console.log(`总机会数: ${funnel.totalOpportunities}`);
console.log(`模拟通过率: ${funnel.simulationPassRate.toFixed(1)}%`);
console.log(`验证通过率: ${funnel.validationPassRate.toFixed(1)}%`);
console.log(`并行节省: ${funnel.parallelSavingsMs.toFixed(0)}ms`);

// 获取矩阵分析
const matrix = await OpportunityAnalytics.getMatrixAnalysis({
  startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
  endTime: new Date(),
});

console.log(`模拟&验证都通过: ${matrix.simPassedValPassed}`);
console.log(`仅模拟通过: ${matrix.simPassedValFailed}`);
console.log(`仅验证通过: ${matrix.simFailedValPassed}`);

// 生成报表
const report = await OpportunityAnalytics.generateFunnelReport({
  startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
  endTime: new Date(),
});

console.log(report);
```

## 🔧 故障排查

### TypeScript类型错误

如果看到类型错误，运行：

```bash
cd packages/core
pnpm prisma generate
```

然后重启TypeScript服务器（VSCode: `Ctrl+Shift+P` → "Restart TS Server"）

### 数据库连接错误

检查 `.env` 文件中的 `DATABASE_URL`：

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"
```

### 记录数据为空

确保：
1. 数据库迁移已运行
2. 配置中 `database.enabled = true`
3. 机器人正在运行并发现机会

## 📚 相关文件

- **Schema定义**: `packages/core/prisma/schema.prisma`
- **迁移文件**: `packages/core/prisma/migrations/20250108_add_detailed_opportunity_tracking/`
- **记录器**: `packages/core/src/database/recorder.ts`
- **辅助类**: `packages/jupiter-bot/src/tracking-helper.ts`
- **统计分析**: `packages/core/src/database/analytics.ts`
- **命令行工具**: `tools/analyze-opportunity-funnel.ts`
- **主要逻辑**: `packages/jupiter-bot/src/flashloan-bot.ts`

---

**版本**: 1.0.0  
**更新日期**: 2025-01-08  
**作者**: Cascade AI
