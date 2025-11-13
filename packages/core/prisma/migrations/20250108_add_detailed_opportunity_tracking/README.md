# 数据库迁移: 添加详细机会追踪字段

## 迁移说明

本次迁移添加了完整的机会处理追踪系统，用于记录和分析每个机会从发现到执行的完整流程。

## 新增字段分类

### 1. 构建阶段追踪 (7个字段)
- `build_started_at`: 构建开始时间
- `build_completed_at`: 构建完成时间（不含模拟）
- `build_latency_ms`: 纯构建耗时（毫秒）
- `build_success`: 构建是否成功
- `build_error`: 构建失败原因
- `transaction_size`: 交易大小（字节）
- `is_bundle_mode`: 是否使用Bundle模式

### 2. 模拟阶段追踪 (6个字段)
- `simulation_started_at`: 模拟开始时间
- `simulation_completed_at`: 模拟完成时间
- `simulation_latency_ms`: 模拟耗时（毫秒）
- `simulation_success`: 模拟是否成功
- `simulation_error`: 模拟失败原因
- `simulation_compute_units`: 模拟消耗的计算单元

### 3. 二次验证阶段追踪 (13个字段)
- `validation_started_at`: 验证开始时间
- `validation_completed_at`: 验证完成时间
- `validation_latency_ms`: 验证耗时（毫秒）
- `validation_success`: 验证是否成功
- `second_profit`: 二次验证后的利润
- `second_roi`: 二次验证后的ROI
- `price_drift`: 价格漂移比例
- `is_profitable_after_fees`: 扣费后是否盈利
- `estimated_gas_fee`: 估算的Gas费用
- `estimated_priority_fee`: 估算的优先费
- `estimated_jito_tip`: 估算的Jito Tip
- `estimated_slippage_buffer`: 估算的滑点缓冲
- `net_profit_after_fees`: 扣费后的净利润

### 4. 并行处理统计 (4个字段)
- `parallel_started_at`: 并行任务开始时间
- `parallel_completed_at`: 并行任务完成时间
- `parallel_total_latency_ms`: 并行总耗时（取最长）
- `build_total_latency_ms`: 构建+模拟总耗时

### 5. 过滤判断 (5个字段)
- `passed_simulation`: 是否通过模拟测试
- `passed_validation`: 是否通过二次验证
- `passed_both`: 是否同时通过模拟和验证
- `should_execute`: 是否应该执行
- `execution_status`: 执行状态 (pending/executed/filtered/failed)

## 运行迁移

### 方法1: 使用Prisma CLI（推荐）

```bash
# 进入core包目录
cd packages/core

# 运行迁移
pnpm prisma migrate deploy

# 重新生成Prisma客户端
pnpm prisma generate
```

### 方法2: 直接执行SQL（高级用户）

```bash
# 连接到数据库
psql $DATABASE_URL

# 执行迁移文件
\i packages/core/prisma/migrations/20250108_add_detailed_opportunity_tracking/migration.sql
```

然后运行：
```bash
cd packages/core
pnpm prisma generate
```

## 验证迁移

运行以下查询验证字段已添加：

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'opportunities'
  AND column_name LIKE '%build%'
     OR column_name LIKE '%simulation%'
     OR column_name LIKE '%validation%'
     OR column_name LIKE '%parallel%'
     OR column_name LIKE '%passed%'
ORDER BY column_name;
```

## 影响范围

- **表**: `opportunities`
- **新增字段**: 35个
- **新增索引**: 4个
- **现有数据**: 不受影响（所有新字段都是可空的）
- **应用代码**: 需要更新记录逻辑

## 回滚

如果需要回滚此迁移：

```sql
-- 删除索引
DROP INDEX IF EXISTS idx_opportunities_passed_both;
DROP INDEX IF EXISTS idx_opportunities_execution_status;
DROP INDEX IF EXISTS idx_opportunities_build_success;
DROP INDEX IF EXISTS idx_opportunities_simulation_success;

-- 删除字段
ALTER TABLE opportunities DROP COLUMN IF EXISTS build_started_at;
ALTER TABLE opportunities DROP COLUMN IF EXISTS build_completed_at;
-- ... (其他所有新字段)
```

## 注意事项

1. 此迁移是向后兼容的，不会影响现有数据
2. 所有新字段都是可空的（NULL）
3. 建议在生产环境运行前先在测试环境验证
4. 运行迁移后必须重新生成Prisma客户端
5. TypeScript类型会在重新生成Prisma客户端后自动更新
