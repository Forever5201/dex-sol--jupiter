/// ======================================================================
/// 计算器 (Calculator) - 独立计算层
/// ======================================================================
///
/// 职责：
/// 1. 接收 CalculationTask（来自 Coordinator）
/// 2. 获取状态快照
/// 3. 运行 Bellman-Ford 和 BFS 算法
/// 4. 返回套利路径
///
/// 设计原则：
/// - 纯计算，无调度逻辑
/// - 在 spawn_blocking 中运行
/// - 可独立测试
/// ======================================================================

use crate::state_layer::StateLayer;
use crate::router_bellman_ford::BellmanFordScanner;
use crate::router_bfs::BfsScanner;
use crate::router::{ArbitragePath};
use crate::coordinator::CalculationTask;
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, warn};

/// 计算器配置
#[derive(Debug, Clone)]
pub struct CalculatorConfig {
    /// 是否启用 Bellman-Ford（深度搜索）
    pub enable_bf: bool,
    /// 是否启用 BFS（快速搜索）
    pub enable_bfs: bool,
    /// Bellman-Ford 最大跳数
    pub bf_max_hops: usize,
    /// BFS 最大跳数
    pub bfs_max_hops: usize,
    /// 最小 ROI 阈值
    pub min_roi_percent: f64,
}

impl Default for CalculatorConfig {
    fn default() -> Self {
        Self {
            enable_bf: true,
            enable_bfs: true,
            bf_max_hops: 6,
            bfs_max_hops: 3,
            min_roi_percent: 0.3,
        }
    }
}

/// 计算器
pub struct Calculator {
    /// 状态层（只读访问）
    worldview: Arc<dyn StateLayer>,

    /// Bellman-Ford 扫描器
    bf_scanner: BellmanFordScanner,

    /// BFS 扫描器
    bfs_scanner: BfsScanner,

    /// 配置
    config: CalculatorConfig,
}

impl Calculator {
    /// 创建新的计算器
    pub fn new(worldview: Arc<dyn StateLayer>, config: CalculatorConfig) -> Self {
        let bf_scanner = BellmanFordScanner::new(config.bf_max_hops, config.min_roi_percent);
        let bfs_scanner = BfsScanner::new(config.bfs_max_hops, config.min_roi_percent);

        Self {
            worldview,
            bf_scanner,
            bfs_scanner,
            config,
        }
    }

    /// 执行计算任务
    ///
    /// 注意：此方法应在 spawn_blocking 中调用
    ///
    /// # 参数
    /// * `task` - 计算任务（来自 Coordinator）
    ///
    /// # 返回
    /// 发现的套利路径列表
    pub fn calculate(&self, task: &CalculationTask) -> Vec<ArbitragePath> {
        debug!(
            "📊 Calculator: Starting {:?} calculation from {}",
            task.trigger_type, task.trigger_source
        );

        // 1. 获取一致快照
        let snapshot_start = Instant::now();
        let snapshot = self.worldview.get_consistent_snapshot(2000, 10);
        let snapshot_time = snapshot_start.elapsed();

        debug!(
            "📊 Calculator: Snapshot {} pools in {:?}",
            snapshot.len(),
            snapshot_time
        );

        if snapshot.is_empty() {
            warn!("Calculator: Empty snapshot, skipping calculation");
            return Vec::new();
        }

        // 2. 运行算法
        let mut all_paths = Vec::new();

        // 2.1 BFS（快速 2-3 跳）
        if self.config.enable_bfs {
            let bfs_start = Instant::now();
            let bfs_paths = self.run_bfs(&snapshot);
            let bfs_time = bfs_start.elapsed();

            debug!(
                "🔍 BFS: Found {} paths in {:?}",
                bfs_paths.len(),
                bfs_time
            );
            all_paths.extend(bfs_paths);
        }

        // 2.2 Bellman-Ford（深度 4-6 跳）
        if self.config.enable_bf {
            let bf_start = Instant::now();
            let bf_paths = self.run_bellman_ford(&snapshot);
            let bf_time = bf_start.elapsed();

            debug!(
                "🔍 Bellman-Ford: Found {} paths in {:?}",
                bf_paths.len(),
                bf_time
            );
            all_paths.extend(bf_paths);
        }

        // 3. 去重和排序
        if !all_paths.is_empty() {
            let dedup_start = Instant::now();
            let deduped_paths = self.deduplicate_paths(all_paths);
            let dedup_time = dedup_start.elapsed();

            debug!(
                "📊 Calculator: Deduplicated to {} paths in {:?}",
                deduped_paths.len(),
                dedup_time
            );

            return deduped_paths;
        }

        debug!("✅ Calculator: Total 0 paths");

        Vec::new()
    }

    /// 运行 BFS 扫描
    fn run_bfs(&self, snapshot: &[crate::price_cache::PoolPrice]) -> Vec<ArbitragePath> {
        // BFS 已经有自己的实现，这里调用它
        self.bfs_scanner.find_all_opportunities(snapshot, 10.0)
    }

    /// 运行 Bellman-Ford 扫描
    fn run_bellman_ford(&self, snapshot: &[crate::price_cache::PoolPrice]) -> Vec<ArbitragePath> {
        // Bellman-Ford 已经有自己的实现，这里调用它
        self.bf_scanner.find_all_cycles(snapshot, 10.0)
    }

    /// 去重路径（同一路径可能从不同算法被发现）
    fn deduplicate_paths(&self, paths: Vec<ArbitragePath>) -> Vec<ArbitragePath> {
        use std::collections::HashSet;

        let mut seen = HashSet::new();
        let mut unique = Vec::new();

        for path in paths {
            // 使用路径的池子ID序列作为key
            let key: Vec<String> = path.steps.iter()
                .map(|s| s.pool_id.clone())
                .collect();

            if !seen.contains(&key) {
                seen.insert(key);
                unique.push(path);
            }
        }

        unique
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::price_cache::{PoolPrice, PriceCache};
    use crate::state_layer::StateLayer;

    fn create_test_pool_price(pool_id: &str, pair: &str, price: f64) -> PoolPrice {
        PoolPrice {
            pool_id: pool_id.to_string(),
            dex_name: "Test".to_string(),
            pair: pair.to_string(),
            base_reserve: 1000,
            quote_reserve: 1000,
            base_decimals: 6,
            quote_decimals: 6,
            price,
            last_update: Instant::now(),
            slot: 1000,
        }
    }

    #[test]
    fn test_calculator_basic() {
        let worldview = Arc::new(PriceCache::new());

        // 添加测试数据
        worldview.update_price(create_test_pool_price("pool1", "A/B", 1.0));
        worldview.update_price(create_test_pool_price("pool2", "B/C", 1.0));
        worldview.update_price(create_test_pool_price("pool3", "C/A", 1.01)); // 套利机会

        let calculator = Calculator::new(
            worldview,
            CalculatorConfig::default()
        );

        let task = CalculationTask {
            trigger_type: crate::coordinator::TriggerType::Clock,
            trigger_source: "test".to_string(),
            price_change_percent: None,
            created_at: Instant::now(),
        };

        let paths = calculator.calculate(&task);

        // 应该找到至少1个套利机会
        assert!(!paths.is_empty(), "Should find arbitrage opportunity");
    }

    #[test]
    fn test_calculator_bfs_only() {
        let worldview = Arc::new(PriceCache::new());

        worldview.update_price(create_test_pool_price("pool1", "A/B", 1.0));
        worldview.update_price(create_test_pool_price("pool2", "B/C", 1.0));
        worldview.update_price(create_test_pool_price("pool3", "C/A", 1.02)); // 2% 套利

        let config = CalculatorConfig {
            enable_bf: false,  // 禁用 BF
            enable_bfs: true,  // 只启用 BFS
            ..Default::default()
        };

        let calculator = Calculator::new(worldview, config);

        let task = CalculationTask {
            trigger_type: crate::coordinator::TriggerType::Clock,
            trigger_source: "test".to_string(),
            price_change_percent: None,
            created_at: Instant::now(),
        };

        let paths = calculator.calculate(&task);

        // 应该通过 BFS 找到机会
        assert!(!paths.is_empty(), "BFS should find arbitrage");
    }

    #[test]
    fn test_calculator_bf_only() {
        let worldview = Arc::new(PriceCache::new());

        worldview.update_price(create_test_pool_price("pool1", "A/B", 1.0));
        worldview.update_price(create_test_pool_price("pool2", "B/C", 1.0));
        worldview.update_price(create_test_pool_price("pool3", "C/D", 1.0));
        worldview.update_price(create_test_pool_price("pool4", "D/A", 1.02)); // 4跳套利

        let config = CalculatorConfig {
            enable_bf: true,   // 启用 BF
            enable_bfs: false, // 禁用 BFS
            bf_max_hops: 4,
            ..Default::default()
        };

        let calculator = Calculator::new(worldview, config);

        let task = CalculationTask {
            trigger_type: crate::coordinator::TriggerType::Clock,
            trigger_source: "test".to_string(),
            price_change_percent: None,
            created_at: Instant::now(),
        };

        let paths = calculator.calculate(&task);

        // BF 应该找到 4 跳套利
        assert!(!paths.is_empty(), "Bellman-Ford should find 4-hop arbitrage");
    }

    #[test]
    fn test_calculator_deduplication() {
        let worldview = Arc::new(PriceCache::new());

        // 创建会被多个算法发现的机会
        worldview.update_price(create_test_pool_price("pool1", "SOL/USDC", 100.0));
        worldview.update_price(create_test_pool_price("pool2", "USDC/USDT", 1.0));
        worldview.update_price(create_test_pool_price("pool3", "USDT/SOL", 1.01));

        let calculator = Calculator::new(
            worldview,
            CalculatorConfig::default()
        );

        let task = CalculationTask {
            trigger_type: crate::coordinator::TriggerType::Clock,
            trigger_source: "test".to_string(),
            price_change_percent: None,
            created_at: Instant::now(),
        };

        let paths = calculator.calculate(&task);

        // 即使有重复发现，去重后应该只有1个唯一路径
        let unique_pairs: Vec<String> = paths.iter()
            .map(|p| format!("{:?}", p.steps.iter().map(|s| &s.pool_id).collect::<Vec<_>>()))
            .collect();

        // 检查是否有重复
        for i in 0..unique_pairs.len() {
            for j in (i+1)..unique_pairs.len() {
                assert_ne!(unique_pairs[i], unique_pairs[j], "Found duplicate paths");
            }
        }
    }
}
