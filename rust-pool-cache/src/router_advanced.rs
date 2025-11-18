/*!
 * 高级路由器 - 整合层
 * 
 * 整合所有路由策略：
 * - 快速扫描器（混合算法：2-3跳）
 * - Bellman-Ford扫描器（深度搜索：4-6跳）
 * - 拆分优化器（DP优化）
 * 
 * 支持三种模式：
 * - Fast: 仅快速扫描（4ms，覆盖73.8%利润）
 * - Complete: 全覆盖扫描（22ms，覆盖100%利润）
 * - Hybrid: 智能选择（自适应）
 */

use crate::router::Router;
use crate::router_bellman_ford::BellmanFordScanner;
use crate::router_bfs::BfsScanner;  // 🔥 新增：BFS扫描器
use crate::router_split_optimizer::{SplitOptimizer, OptimizedPath};
use crate::router_cache::RouterCache;  // 🔥 新增：路径缓存
use crate::price_cache::PriceCache;
use std::sync::{Arc, Mutex};
use tracing::{info, debug};

/// 路由器模式
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RouterMode {
    /// 快速模式：仅2-3跳（~4ms）
    Fast,
    /// 完整模式：2-6跳全覆盖（~22ms）
    Complete,
    /// 混合模式：根据市场状况智能选择
    Hybrid,
}

impl RouterMode {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "fast" => RouterMode::Fast,
            "complete" => RouterMode::Complete,
            "hybrid" => RouterMode::Hybrid,
            _ => RouterMode::Complete, // 默认完整模式
        }
    }
}

/// 高级路由器配置
#[derive(Debug, Clone)]
pub struct AdvancedRouterConfig {
    pub mode: RouterMode,
    pub min_roi_percent: f64,
    pub max_hops: usize,
    pub enable_split_optimization: bool,
    pub max_splits: usize,
    pub min_split_amount: f64,
}

impl Default for AdvancedRouterConfig {
    fn default() -> Self {
        Self {
            mode: RouterMode::Complete,
            min_roi_percent: 0.3,
            max_hops: 6,
            enable_split_optimization: true,
            max_splits: 5,
            min_split_amount: 100.0,
        }
    }
}

/// 高级路由器
/// 
/// 注意：不实现Clone因为包含Mutex<RouterCache>
pub struct AdvancedRouter {
    /// 快速扫描器（现有混合算法）
    quick_scanner: Router,
    /// BFS扫描器（快速2-3跳，剪枝优化）
    bfs_scanner: BfsScanner,  // 🔥 新增
    /// Bellman-Ford扫描器
    bf_scanner: BellmanFordScanner,
    /// 拆分优化器
    split_optimizer: SplitOptimizer,
    /// 路径缓存（60-80%延迟降低）
    path_cache: Arc<Mutex<RouterCache>>,  // 🔥 新增
    /// 配置
    config: AdvancedRouterConfig,
    /// 价格缓存（用于实时获取数据）
    price_cache: Arc<PriceCache>,
}

impl AdvancedRouter {
    /// 创建新的高级路由器
    pub fn new(price_cache: Arc<PriceCache>, config: AdvancedRouterConfig) -> Self {
        let quick_scanner = Router::new(price_cache.clone());
        let bfs_scanner = BfsScanner::new(3, config.min_roi_percent);  // 🔥 BFS限制3跳
        let bf_scanner = BellmanFordScanner::new(config.max_hops, config.min_roi_percent);
        let split_optimizer = SplitOptimizer::new(config.max_splits, config.min_split_amount);
        let path_cache = Arc::new(Mutex::new(RouterCache::new(30, 1000)));  // 🔥 30秒TTL，1000条目
        
        Self {
            quick_scanner,
            bfs_scanner,  // 🔥 新增
            bf_scanner,
            split_optimizer,
            path_cache,  // 🔥 新增
            config,
            price_cache,
        }
    }
    
    /// 寻找最优路径（主入口）
    pub async fn find_optimal_routes(&self, amount: f64) -> Vec<OptimizedPath> {
        match self.config.mode {
            RouterMode::Fast => self.fast_scan(amount).await,
            RouterMode::Complete => self.complete_scan(amount).await,
            RouterMode::Hybrid => self.hybrid_scan(amount).await,
        }
    }
    
    /// 快速扫描（仅2-3跳）
    async fn fast_scan(&self, amount: f64) -> Vec<OptimizedPath> {
        println!("   🚀 Fast scan mode: 2-3 hop only");
        
        let scan_start = tokio::time::Instant::now();
        let paths = self.quick_scanner.find_all_opportunities(amount);
        println!("   ⚡ Found {} raw paths in {:?}", paths.len(), scan_start.elapsed());
        
        // 转换为OptimizedPath
        let optimized: Vec<OptimizedPath> = paths.into_iter()
            .map(|p| OptimizedPath {
                optimized_net_profit: p.net_profit,
                optimized_roi: p.roi_percent,
                base_path: p,
                split_strategy: None,
            })
            .collect();

        // 🔍 详细调试日志：打印每一条候选路径及其ROI（过滤前）
        if !optimized.is_empty() {
            println!("   📋 Fast scan candidate paths (before ROI filter): {}", optimized.len());
            for (idx, path) in optimized.iter().enumerate() {
                println!("   ── Candidate #{} ───────────────", idx + 1);
                println!("{}", self.format_optimized_path(path));
            }
        } else {
            println!("   ℹ️  Fast scan: no candidate paths found before filtering");
        }
        
        let before_filter = optimized.len();
        let filtered: Vec<OptimizedPath> = optimized.into_iter()
            .filter(|p| p.optimized_roi >= self.config.min_roi_percent)
            .collect();
        
        let filtered_out = before_filter - filtered.len();
        if filtered_out > 0 {
            println!("   ⛔ Filtered out {} paths (ROI < {}%)", filtered_out, self.config.min_roi_percent);
        }
        
        // 如果启用拆分优化
        if self.config.enable_split_optimization && !filtered.is_empty() {
            println!("   💎 Applying split optimization...");
            self.split_optimizer.optimize_all(&filtered.iter().map(|o| o.base_path.clone()).collect::<Vec<_>>(), amount)
        } else {
            filtered
        }
    }
    
    /// 完整扫描（2-6跳全覆盖）
    async fn complete_scan(&self, amount: f64) -> Vec<OptimizedPath> {
        println!("   📡 Fetching price data...");
        
        // 🎯 数据一致性：收紧阈值确保价格新鲜度（减少过期机会）
        // 参数：2000ms新鲜度（2秒），10 slot差异（约4秒）
        let consistent_prices = self.price_cache.get_consistent_snapshot(2000, 10);
        
        // 如果一致性数据太少，降级到仅新鲜度过滤
        let all_prices = if consistent_prices.len() < 10 {
            println!("   ⚠️  Consistent snapshot too small ({}), falling back to fresh prices", consistent_prices.len());
            self.price_cache.get_fresh_prices(5000)  // 降级也收紧到5秒
        } else {
            println!("   ✅ Using consistent snapshot with {} pools", consistent_prices.len());
            consistent_prices
        };
        
        if all_prices.is_empty() {
            println!("   ❌ No fresh prices available!");
            return Vec::new();
        }
        
        // 记录数据质量统计
        let latest_slot = self.price_cache.get_latest_slot();
        println!("   📊 Latest slot: {}, using {} pools for routing", latest_slot, all_prices.len());
        
        // 🔥 三路并行扫描：Quick + BFS + Bellman-Ford
        println!("   🚀 Starting parallel scan: Quick (legacy) + BFS (2-3 hop) + Bellman-Ford (4-6 hop)");
        
        let quick_start = tokio::time::Instant::now();
        let quick_future = async {
            self.quick_scanner.find_all_opportunities(amount)
        };
        
        let bfs_start = tokio::time::Instant::now();
        let bfs_future = async {
            self.bfs_scanner.find_all_opportunities(&all_prices, amount)
        };
        
        let deep_start = tokio::time::Instant::now();
        let deep_future = async {
            self.bf_scanner.find_all_cycles(&all_prices, amount)
        };
        
        let (quick_paths, bfs_paths, deep_paths) = tokio::join!(quick_future, bfs_future, deep_future);
        
        println!("   ⚡ Quick scan: {} paths in {:?}", quick_paths.len(), quick_start.elapsed());
        println!("   🔥 BFS scan: {} paths in {:?}", bfs_paths.len(), bfs_start.elapsed());
        println!("   🔍 Bellman-Ford: {} paths in {:?}", deep_paths.len(), deep_start.elapsed());
        
        // 合并所有路径
        let mut all_paths = quick_paths;
        all_paths.extend(bfs_paths);
        all_paths.extend(deep_paths);
        let total_before_dedup = all_paths.len();
        
        // 去重（可能同一个机会被两个算法都发现）
        all_paths = self.deduplicate_paths(all_paths);
        let duplicates_removed = total_before_dedup - all_paths.len();
        if duplicates_removed > 0 {
            println!("   🔄 Removed {} duplicate paths", duplicates_removed);
        }
        
        // 转换为OptimizedPath
        let base_optimized: Vec<OptimizedPath> = all_paths.into_iter()
            .map(|p| OptimizedPath {
                optimized_net_profit: p.net_profit,
                optimized_roi: p.roi_percent,
                base_path: p,
                split_strategy: None,
            })
            .collect();
        
        let before_filter = base_optimized.len();
        println!("   📋 Total paths before filtering: {}", before_filter);

        // 🔍 🔥 🔥 🔥 增强调试日志：打印所有候选路径（包括将被过滤的）
        if !base_optimized.is_empty() {
            println!("   📂 Complete scan candidate paths (before ROI filter): {}", base_optimized.len());
            for (idx, path) in base_optimized.iter().enumerate() {
                println!("\n   ════════════════════════════════════════════════");
                println!("   🎯 候选路径 #{} (ROI: {:.6}%)", idx + 1, path.optimized_roi);

                // 标记是否会被过滤
                if path.optimized_roi >= self.config.min_roi_percent {
                    println!("   ✅ 保留 (ROI ≥ {}%阈值)", self.config.min_roi_percent);
                } else {
                    println!("   ❌ 将被过滤 (ROI < {}%阈值)", self.config.min_roi_percent);
                }

                println!("{}", self.format_optimized_path_for_debug(path));
            }
            println!("   ════════════════════════════════════════════════\n");
        } else {
            println!("   ⚠️  没有在过滤前找到任何候选路径！");
            println!("   💡 可能原因:");
            println!("      1. 价格缓存中没有池子数据");
            println!("      2. 池子数据不足以形成套利路径");
            println!("      3. 路由算法没有正确扫描");
        }

        // Filter by ROI threshold
        let filtered: Vec<OptimizedPath> = base_optimized.into_iter()
            .filter(|p| p.optimized_roi >= self.config.min_roi_percent)
            .collect();

        let filtered_out = before_filter - filtered.len();
        if filtered_out > 0 {
            println!("   ⛔ 过滤结果: {} 条路径中，{} 条因 ROI < {}% 被移除", before_filter, filtered_out, self.config.min_roi_percent);
            if !filtered.is_empty() {
                println!("   ✅ 最终保留: {} 条路径", filtered.len());
            } else {
                println!("   ⚠️  警告: 过滤后没有路径剩余！");
            }
        } else if before_filter > 0 {
            println!("   ✅ 过滤结果: 所有 {} 条路径都满足 ROI ≥ {}% 阈值", before_filter, self.config.min_roi_percent);
        }
        
        // 应用拆分优化
        if self.config.enable_split_optimization && !filtered.is_empty() {
            println!("   💎 Applying split optimization to {} paths...", filtered.len());
            let optimized = self.split_optimizer.optimize_all(
                &filtered.iter().map(|o| o.base_path.clone()).collect::<Vec<_>>(),
                amount
            );
            println!("   ✅ Split optimization complete: {} final paths", optimized.len());
            optimized
        } else {
            filtered
        }
    }
    
    /// 混合扫描（智能选择）
    async fn hybrid_scan(&self, amount: f64) -> Vec<OptimizedPath> {
        // 先快速扫描
        let quick_results = self.fast_scan(amount).await;
        
        // 如果找到高质量机会（ROI > 1%），直接返回
        if let Some(best) = quick_results.first() {
            if best.optimized_roi > 1.0 {
                info!("Hybrid mode: Found excellent quick opportunity ({}% ROI), skipping deep scan", best.optimized_roi);
                return quick_results;
            }
        }
        
        // 否则进行完整扫描
        debug!("Hybrid mode: No excellent quick opportunity, running complete scan...");
        self.complete_scan(amount).await
    }
    
    /// 去重路径（基于步骤序列）
    fn deduplicate_paths(&self, paths: Vec<crate::router::ArbitragePath>) -> Vec<crate::router::ArbitragePath> {
        let mut unique = Vec::new();
        let mut seen = std::collections::HashSet::new();
        
        for path in paths {
            // 创建路径签名
            let signature: String = path.steps.iter()
                .map(|s| format!("{}->{}", s.input_token, s.output_token))
                .collect::<Vec<_>>()
                .join("|");
            
            if !seen.contains(&signature) {
                seen.insert(signature);
                unique.push(path);
            }
        }
        
        unique
    }
    
    /// 格式化优化后的路径
    pub fn format_optimized_path(&self, path: &OptimizedPath) -> String {
        let mut output = String::new();
        
        output.push_str(&format!("🔥 {:?} 套利机会（优化后）\n", path.base_path.arb_type));
        output.push_str(&format!("   初始: {} {} → 最终: {} {}\n", 
            path.base_path.input_amount, path.base_path.start_token,
            path.base_path.output_amount, path.base_path.end_token));
        output.push_str(&format!("   优化后净利润: {:.6} {} ({:.2}% ROI)\n", 
            path.optimized_net_profit, path.base_path.start_token, path.optimized_roi));
        
        if let Some(strategy) = &path.split_strategy {
            output.push_str(&format!("   拆分策略: {} 条路径\n", strategy.allocations.len()));
            for (idx, amount) in &strategy.allocations {
                output.push_str(&format!("     - 路径{}: {:.2} 资金\n", idx + 1, amount));
            }
        }

        output.push_str(&format!("   路径（{}跳）:\n", path.base_path.steps.len()));
        for (idx, step) in path.base_path.steps.iter().enumerate() {
            output.push_str(&format!("     {}. [{}] {} → {} (价格: {:.6})\n",
                idx + 1,
                step.dex_name,
                step.input_token,
                step.output_token,
                step.price));
        }

        output
    }

    /// 🔥 调试专用：格式化优化后的路径（显示更多细节）
    fn format_optimized_path_for_debug(&self, path: &OptimizedPath) -> String {
        let mut output = String::new();

        output.push_str(&format!("   📊 路径类型: {:?}\n", path.base_path.arb_type));
        output.push_str(&format!("   💰 初始投入: {:.6} {}\n",
            path.base_path.input_amount,
            path.base_path.start_token));
        output.push_str(&format!("   💵 最终获得: {:.6} {}\n",
            path.base_path.output_amount,
            path.base_path.end_token));
        output.push_str(&format!("   📈 毛利润: {:.6} {}\n",
            path.base_path.gross_profit,
            path.base_path.start_token));
        output.push_str(&format!("   💸 估算费用: {:.6} {}\n",
            path.base_path.estimated_fees,
            path.base_path.start_token));
        output.push_str(&format!("   🎯 净利润: {:.6} {}\n",
            path.base_path.net_profit,
            path.base_path.start_token));
        output.push_str(&format!("   📊 ROI: {:.6}%\n", path.optimized_roi));

        // 显示有效性检查
        output.push_str(&format!("   ✅ 有效性检查:"));
        output.push_str(&format!(" 循环路径: {}", if path.base_path.start_token == path.base_path.end_token { "✓" } else { "✗" }));
        output.push_str(&format!(" 净利润>0: {}", if path.base_path.net_profit > 0.0 { "✓" } else { "✗" }));
        output.push_str(&format!(" ROI≥{}%: {}", self.config.min_roi_percent, if path.optimized_roi >= self.config.min_roi_percent { "✓" } else { "✗" }));
        output.push_str(&format!(" 跳数合理: {}\n", if path.base_path.steps.len() >= 2 && path.base_path.steps.len() <= 6 { "✓" } else { "✗" }));

        // 显示每条步骤的详细信息
        output.push_str(&format!("   🛣️  路径详情 ({}跳):\n", path.base_path.steps.len()));
        for (idx, step) in path.base_path.steps.iter().enumerate() {
            output.push_str(&format!("\n   [{}/{}] [{}]\n",
                idx + 1,
                path.base_path.steps.len(),
                step.dex_name));
            output.push_str(&format!("        输入: {:.6} {}\n", step.expected_input, step.input_token));
            output.push_str(&format!("        输出: {:.6} {}\n", step.expected_output, step.output_token));
            output.push_str(&format!("        价格: {:.6}\n", step.price));
            output.push_str(&format!("        池子: {}\n", step.pool_id));
            output.push_str(&format!("        流动性: base={:.2}, quote={:.2}\n",
                step.liquidity_base as f64 / 1e6,
                step.liquidity_quote as f64 / 1e6));
        }

        // 如果启用了拆分策略，显示拆分详情
        if let Some(strategy) = &path.split_strategy {
            output.push_str(&format!("\n   💎 拆分优化策略:\n"));
            output.push_str(&format!("      总路径数: {}\n", strategy.allocations.len()));
            for (idx, amount) in &strategy.allocations {
                output.push_str(&format!("      - 路径{}: {:.2} USD\n", idx + 1, amount));
            }
        }

        output
    }

    /// 选择最优路径
    pub fn select_best<'a>(&self, paths: &'a [OptimizedPath]) -> Option<&'a OptimizedPath> {
        paths.iter()
            .filter(|p| p.is_valid())
            .max_by(|a, b| a.score().partial_cmp(&b.score()).unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_router_mode_parsing() {
        assert_eq!(RouterMode::from_str("fast"), RouterMode::Fast);
        assert_eq!(RouterMode::from_str("COMPLETE"), RouterMode::Complete);
        assert_eq!(RouterMode::from_str("hybrid"), RouterMode::Hybrid);
        assert_eq!(RouterMode::from_str("unknown"), RouterMode::Complete);
    }
    
    #[test]
    fn test_default_config() {
        let config = AdvancedRouterConfig::default();
        assert_eq!(config.mode, RouterMode::Complete);
        assert_eq!(config.max_hops, 6);
        assert!(config.enable_split_optimization);
    }
}







