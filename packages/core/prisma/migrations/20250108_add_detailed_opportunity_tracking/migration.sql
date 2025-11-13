-- Migration: Add detailed opportunity tracking fields
-- Description: 添加构建、模拟、验证各阶段的详细追踪字段，支持并行处理统计和过滤判断

-- ==================== 构建阶段追踪字段 ====================
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS build_started_at TIMESTAMPTZ(6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS build_completed_at TIMESTAMPTZ(6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS build_latency_ms INTEGER;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS build_success BOOLEAN;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS build_error TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS transaction_size INTEGER;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS is_bundle_mode BOOLEAN;

-- ==================== 模拟阶段追踪字段 ====================
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS simulation_started_at TIMESTAMPTZ(6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS simulation_completed_at TIMESTAMPTZ(6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS simulation_latency_ms INTEGER;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS simulation_success BOOLEAN;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS simulation_error TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS simulation_compute_units INTEGER;

-- ==================== 二次验证阶段追踪字段 ====================
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS validation_started_at TIMESTAMPTZ(6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS validation_completed_at TIMESTAMPTZ(6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS validation_latency_ms INTEGER;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS validation_success BOOLEAN;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS second_profit BIGINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS second_roi DECIMAL(10, 4);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS price_drift DECIMAL(10, 6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS is_profitable_after_fees BOOLEAN;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS estimated_gas_fee BIGINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS estimated_priority_fee BIGINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS estimated_jito_tip BIGINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS estimated_slippage_buffer BIGINT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS net_profit_after_fees BIGINT;

-- ==================== 并行处理统计字段 ====================
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS parallel_started_at TIMESTAMPTZ(6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS parallel_completed_at TIMESTAMPTZ(6);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS parallel_total_latency_ms INTEGER;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS build_total_latency_ms INTEGER;

-- ==================== 过滤判断字段 ====================
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS passed_simulation BOOLEAN;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS passed_validation BOOLEAN;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS passed_both BOOLEAN;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS should_execute BOOLEAN;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS execution_status VARCHAR(20);

-- ==================== 创建索引以提升查询性能 ====================
CREATE INDEX IF NOT EXISTS idx_opportunities_passed_both ON opportunities(passed_both);
CREATE INDEX IF NOT EXISTS idx_opportunities_execution_status ON opportunities(execution_status);
CREATE INDEX IF NOT EXISTS idx_opportunities_build_success ON opportunities(build_success);
CREATE INDEX IF NOT EXISTS idx_opportunities_simulation_success ON opportunities(simulation_success);

-- ==================== 添加注释 ====================
COMMENT ON COLUMN opportunities.build_started_at IS '构建阶段开始时间';
COMMENT ON COLUMN opportunities.build_completed_at IS '构建阶段完成时间（不含模拟）';
COMMENT ON COLUMN opportunities.build_latency_ms IS '纯构建耗时（毫秒）';
COMMENT ON COLUMN opportunities.build_success IS '构建是否成功';
COMMENT ON COLUMN opportunities.build_error IS '构建失败原因';
COMMENT ON COLUMN opportunities.transaction_size IS '交易大小（字节）';
COMMENT ON COLUMN opportunities.is_bundle_mode IS '是否使用Bundle模式';

COMMENT ON COLUMN opportunities.simulation_started_at IS '模拟阶段开始时间';
COMMENT ON COLUMN opportunities.simulation_completed_at IS '模拟阶段完成时间';
COMMENT ON COLUMN opportunities.simulation_latency_ms IS '模拟耗时（毫秒）';
COMMENT ON COLUMN opportunities.simulation_success IS '模拟是否成功';
COMMENT ON COLUMN opportunities.simulation_error IS '模拟失败原因';
COMMENT ON COLUMN opportunities.simulation_compute_units IS '模拟消耗的计算单元';

COMMENT ON COLUMN opportunities.validation_started_at IS '二次验证开始时间';
COMMENT ON COLUMN opportunities.validation_completed_at IS '二次验证完成时间';
COMMENT ON COLUMN opportunities.validation_latency_ms IS '验证耗时（毫秒）';
COMMENT ON COLUMN opportunities.validation_success IS '验证是否成功';
COMMENT ON COLUMN opportunities.second_profit IS '二次验证后的利润';
COMMENT ON COLUMN opportunities.second_roi IS '二次验证后的ROI';
COMMENT ON COLUMN opportunities.price_drift IS '价格漂移比例';
COMMENT ON COLUMN opportunities.is_profitable_after_fees IS '扣除所有费用后是否盈利';
COMMENT ON COLUMN opportunities.estimated_gas_fee IS '估算的Gas费用';
COMMENT ON COLUMN opportunities.estimated_priority_fee IS '估算的优先费';
COMMENT ON COLUMN opportunities.estimated_jito_tip IS '估算的Jito Tip';
COMMENT ON COLUMN opportunities.estimated_slippage_buffer IS '估算的滑点缓冲';
COMMENT ON COLUMN opportunities.net_profit_after_fees IS '扣除费用后的净利润';

COMMENT ON COLUMN opportunities.parallel_started_at IS '并行任务开始时间';
COMMENT ON COLUMN opportunities.parallel_completed_at IS '并行任务完成时间';
COMMENT ON COLUMN opportunities.parallel_total_latency_ms IS '并行总耗时（取最长）';
COMMENT ON COLUMN opportunities.build_total_latency_ms IS '构建+模拟总耗时';

COMMENT ON COLUMN opportunities.passed_simulation IS '是否通过模拟测试';
COMMENT ON COLUMN opportunities.passed_validation IS '是否通过二次验证';
COMMENT ON COLUMN opportunities.passed_both IS '是否同时通过模拟和验证';
COMMENT ON COLUMN opportunities.should_execute IS '是否应该执行';
COMMENT ON COLUMN opportunities.execution_status IS '执行状态: pending/executed/filtered/failed';
