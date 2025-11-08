/// 🔥 池子活跃度统计模块
/// 
/// 功能：
/// - 追踪每个池子的订阅次数
/// - 记录价格更新频率
/// - 监控价格变化幅度
/// - 提供时间窗口统计
/// - 生成专业级分析报告

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use std::sync::Arc;
use tracing::info;

/// 单个池子的统计信息
#[derive(Debug, Clone)]
pub struct PoolStats {
    /// 池子名称
    pub pool_name: String,
    /// 池子地址
    pub pool_address: String,
    /// 首次订阅时间
    pub first_subscription: DateTime<Utc>,
    /// 最后订阅时间
    pub last_subscription: DateTime<Utc>,
    /// 总订阅次数（累计）
    pub total_subscriptions: u64,
    /// 价格更新次数
    pub price_updates: u64,
    /// 最后价格
    pub last_price: Option<f64>,
    /// 价格变化次数（超过阈值）
    pub significant_price_changes: u64,
    /// 最大价格变化百分比
    pub max_price_change_percent: f64,
    /// 总价格变化累计（绝对值）
    pub cumulative_price_change: f64,
    /// Vault更新次数
    pub vault_updates: u64,
    /// 错误次数
    pub error_count: u64,
}

impl PoolStats {
    /// 创建新的池子统计
    pub fn new(pool_name: String, pool_address: String) -> Self {
        let now = Utc::now();
        Self {
            pool_name,
            pool_address,
            first_subscription: now,
            last_subscription: now,
            total_subscriptions: 1,
            price_updates: 0,
            last_price: None,
            significant_price_changes: 0,
            max_price_change_percent: 0.0,
            cumulative_price_change: 0.0,
            vault_updates: 0,
            error_count: 0,
        }
    }

    /// 记录订阅事件
    pub fn record_subscription(&mut self) {
        self.total_subscriptions += 1;
        self.last_subscription = Utc::now();
    }

    /// 记录价格更新
    pub fn record_price_update(&mut self, new_price: f64, threshold: f64) {
        self.price_updates += 1;

        if let Some(last_price) = self.last_price {
            let change_percent = ((new_price - last_price) / last_price * 100.0).abs();
            
            // 累计价格变化
            self.cumulative_price_change += change_percent;

            // 更新最大变化
            if change_percent > self.max_price_change_percent {
                self.max_price_change_percent = change_percent;
            }

            // 记录显著变化
            if change_percent >= threshold {
                self.significant_price_changes += 1;
            }
        }

        self.last_price = Some(new_price);
    }

    /// 记录vault更新
    pub fn record_vault_update(&mut self) {
        self.vault_updates += 1;
    }

    /// 记录错误
    pub fn record_error(&mut self) {
        self.error_count += 1;
    }

    /// 计算活跃度分数 (0-100)
    pub fn activity_score(&self) -> f64 {
        let now = Utc::now();
        let duration_secs = (now - self.first_subscription).num_seconds().max(1) as f64;
        
        // 更新频率得分 (0-40分)
        let update_rate = (self.price_updates as f64 / duration_secs) * 60.0; // 每分钟更新次数
        let update_score = (update_rate * 10.0).min(40.0);
        
        // 订阅频率得分 (0-20分)
        let sub_rate = (self.total_subscriptions as f64 / duration_secs) * 3600.0; // 每小时订阅次数
        let sub_score = (sub_rate * 2.0).min(20.0);
        
        // 价格活跃度得分 (0-30分)
        let price_activity = if self.price_updates > 0 {
            (self.significant_price_changes as f64 / self.price_updates as f64) * 100.0
        } else {
            0.0
        };
        let price_score = (price_activity * 0.3).min(30.0);
        
        // Vault活跃度得分 (0-10分)
        let vault_score = (self.vault_updates as f64).min(10.0);
        
        update_score + sub_score + price_score + vault_score
    }

    /// 获取运行时长（秒）
    pub fn uptime_seconds(&self) -> i64 {
        (Utc::now() - self.first_subscription).num_seconds()
    }
}

/// 池子统计收集器
#[derive(Clone)]
pub struct PoolStatsCollector {
    /// 所有池子的统计信息
    stats: Arc<DashMap<String, PoolStats>>,
    /// 价格变化阈值（百分比）
    price_change_threshold: f64,
}

impl PoolStatsCollector {
    /// 创建新的统计收集器
    pub fn new(price_change_threshold: f64) -> Self {
        Self {
            stats: Arc::new(DashMap::new()),
            price_change_threshold,
        }
    }

    /// 记录池子订阅
    pub fn record_subscription(&self, pool_name: &str, pool_address: &str) {
        let key = pool_name.to_string();
        
        self.stats
            .entry(key.clone())
            .and_modify(|stats| stats.record_subscription())
            .or_insert_with(|| PoolStats::new(key, pool_address.to_string()));
    }

    /// 记录价格更新
    pub fn record_price_update(&self, pool_name: &str, price: f64) {
        if let Some(mut stats) = self.stats.get_mut(pool_name) {
            stats.record_price_update(price, self.price_change_threshold);
            // 🔥 每次价格更新也算一次订阅活动（WebSocket消息接收）
            stats.record_subscription();
        }
    }

    /// 记录vault更新
    pub fn record_vault_update(&self, pool_name: &str) {
        if let Some(mut stats) = self.stats.get_mut(pool_name) {
            stats.record_vault_update();
        }
    }

    /// 记录错误
    pub fn record_error(&self, pool_name: &str) {
        if let Some(mut stats) = self.stats.get_mut(pool_name) {
            stats.record_error();
        }
    }

    /// 获取所有池子统计
    pub fn get_all_stats(&self) -> Vec<PoolStats> {
        self.stats
            .iter()
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// 获取单个池子统计
    pub fn get_pool_stats(&self, pool_name: &str) -> Option<PoolStats> {
        self.stats.get(pool_name).map(|entry| entry.value().clone())
    }

    /// 获取活跃池子数量
    pub fn active_pools_count(&self) -> usize {
        self.stats.len()
    }

    /// 获取总订阅次数
    pub fn total_subscriptions(&self) -> u64 {
        self.stats
            .iter()
            .map(|entry| entry.value().total_subscriptions)
            .sum()
    }

    /// 获取总更新次数
    pub fn total_updates(&self) -> u64 {
        self.stats
            .iter()
            .map(|entry| entry.value().price_updates)
            .sum()
    }

    /// 打印统计摘要
    pub fn print_summary(&self, time_window_seconds: i64) {
        let all_stats = self.get_all_stats();
        
        // 过滤时间窗口内的池子
        let active_stats: Vec<_> = all_stats
            .iter()
            .filter(|s| s.uptime_seconds() <= time_window_seconds)
            .collect();

        println!("\n╔═══════════════════════════════════════════════════════════════════════════╗");
        println!("║              🔥 池子活跃度统计报告 - 时间窗口: {}秒             ║", time_window_seconds);
        println!("╠═══════════════════════════════════════════════════════════════════════════╣");
        println!("║  总池子数:          {:>8}                                              ║", all_stats.len());
        println!("║  活跃池子数:        {:>8}                                              ║", active_stats.len());
        println!("║  总订阅次数:        {:>8}                                              ║", self.total_subscriptions());
        println!("║  总更新次数:        {:>8}                                              ║", self.total_updates());
        println!("╚═══════════════════════════════════════════════════════════════════════════╝\n");
    }

    /// 打印详细统计（TOP N池子）- 显示每分钟订阅次数
    pub fn print_detailed_stats(&self, top_n: usize, time_window_seconds: i64) {
        let mut all_stats = self.get_all_stats();
        
        // 过滤时间窗口内的池子
        all_stats.retain(|s| s.uptime_seconds() <= time_window_seconds);
        
        // 按订阅次数排序（显示最活跃的）
        all_stats.sort_by(|a, b| {
            b.total_subscriptions
                .cmp(&a.total_subscriptions)
        });

        let display_count = all_stats.len().min(top_n);

        println!("\n╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗");
        println!("║                          🏆 TOP {} 最活跃池子详细统计（按订阅次数排序）                                           ║", display_count);
        println!("╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣");
        println!("║ 排名 │ 池子名称                    │ 累计订阅 │ 每分钟订阅 │ 更新  │ 显著变化 │ 最大变化% │ Vault │ 活跃度 ║");
        println!("╠═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╣");

        for (idx, stats) in all_stats.iter().take(display_count).enumerate() {
            let pool_name_display = if stats.pool_name.len() > 25 {
                format!("{}...", &stats.pool_name[..22])
            } else {
                format!("{:<25}", stats.pool_name)
            };

            // 计算每分钟订阅次数
            let duration_mins = (stats.uptime_seconds() as f64 / 60.0).max(0.0001);
            let subs_per_min = (stats.total_subscriptions as f64 / duration_mins) as u64;

            println!(
                "║ {:>4} │ {} │ {:>8} │ {:>10} │ {:>5} │ {:>8} │ {:>8.2}% │ {:>5} │ {:>6.1} ║",
                idx + 1,
                pool_name_display,
                stats.total_subscriptions,
                subs_per_min,
                stats.price_updates,
                stats.significant_price_changes,
                stats.max_price_change_percent,
                stats.vault_updates,
                stats.activity_score()
            );
        }

        println!("╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝\n");
    }

    /// 打印每分钟统计 + DEX分组统计
    pub fn print_per_minute_stats(&self) {
        let all_stats = self.get_all_stats();
        
        // 只统计最近1分钟内有更新的池子
        let recent_stats: Vec<_> = all_stats
            .iter()
            .filter(|s| {
                let seconds_since_last_sub = (Utc::now() - s.last_subscription).num_seconds();
                seconds_since_last_sub <= 60
            })
            .collect();

        if recent_stats.is_empty() {
            return;
        }

        let total_subs_per_min: u64 = recent_stats
            .iter()
            .map(|s| {
                let duration = (Utc::now() - s.first_subscription).num_seconds().max(1) as f64;
                ((s.total_subscriptions as f64 / duration) * 60.0) as u64
            })
            .sum();

        let total_updates_per_min: u64 = recent_stats
            .iter()
            .map(|s| {
                let duration = (Utc::now() - s.first_subscription).num_seconds().max(1) as f64;
                ((s.price_updates as f64 / duration) * 60.0) as u64
            })
            .sum();

        println!("\n┌─────────────────────────────────────────────────────────┐");
        println!("│  📊 每分钟统计 (最近60秒活跃的池子)                   │");
        println!("├─────────────────────────────────────────────────────────┤");
        println!("│  活跃池子:          {:>8}                           │", recent_stats.len());
        println!("│  订阅/分钟:         {:>8}                           │", total_subs_per_min);
        println!("│  更新/分钟:         {:>8}                           │", total_updates_per_min);
        println!("└─────────────────────────────────────────────────────────┘\n");
        
        // 🔥 按DEX分组统计
        self.print_dex_group_stats();
    }
    
    /// 🔥 按DEX分组统计每个池子的订阅次数
    pub fn print_dex_group_stats(&self) {
        use std::collections::HashMap;
        
        let all_stats = self.get_all_stats();
        
        // 按DEX分组
        let mut dex_groups: HashMap<String, Vec<&PoolStats>> = HashMap::new();
        
        for stats in &all_stats {
            // 从池子名称提取DEX名称（括号内的部分）
            let dex_name = if let Some(start) = stats.pool_name.rfind('(') {
                if let Some(end) = stats.pool_name.rfind(')') {
                    stats.pool_name[start+1..end].to_string()
                } else {
                    "Unknown".to_string()
                }
            } else {
                "Unknown".to_string()
            };
            
            dex_groups.entry(dex_name).or_insert_with(Vec::new).push(stats);
        }
        
        // 按DEX的总订阅次数排序
        let mut dex_list: Vec<_> = dex_groups.iter().collect();
        dex_list.sort_by(|a, b| {
            let a_total: u64 = a.1.iter().map(|s| s.total_subscriptions).sum();
            let b_total: u64 = b.1.iter().map(|s| s.total_subscriptions).sum();
            b_total.cmp(&a_total)
        });
        
        println!("╔════════════════════════════════════════════════════════════════════════╗");
        println!("║                  📊 按DEX分组统计（订阅活跃度）                       ║");
        println!("╠════════════════════════════════════════════════════════════════════════╣");
        println!("║ DEX名称              │ 池子数 │ 累计订阅  │ 平均订阅/池 │ 占比      ║");
        println!("╠════════════════════════════════════════════════════════════════════════╣");
        
        let grand_total: u64 = all_stats.iter().map(|s| s.total_subscriptions).sum();
        
        for (dex_name, pools) in dex_list {
            let pool_count = pools.len();
            let total_subs: u64 = pools.iter().map(|s| s.total_subscriptions).sum();
            let avg_subs = if pool_count > 0 { total_subs / pool_count as u64 } else { 0 };
            let percentage = if grand_total > 0 {
                (total_subs as f64 / grand_total as f64) * 100.0
            } else {
                0.0
            };
            
            let dex_display = if dex_name.len() > 18 {
                format!("{}...", &dex_name[..15])
            } else {
                format!("{:<18}", dex_name)
            };
            
            println!(
                "║ {}   │ {:>6} │ {:>9} │ {:>11} │ {:>6.1}%  ║",
                dex_display,
                pool_count,
                total_subs,
                avg_subs,
                percentage
            );
        }
        
        println!("╠════════════════════════════════════════════════════════════════════════╣");
        println!("║ 合计                 │ {:>6} │ {:>9} │ {:>11} │ 100.0%  ║",
            all_stats.len(),
            grand_total,
            if all_stats.len() > 0 { grand_total / all_stats.len() as u64 } else { 0 }
        );
        println!("╚════════════════════════════════════════════════════════════════════════╝\n");
    }

    /// 生成JSON格式的统计报告（用于外部分析）
    pub fn generate_json_report(&self) -> String {
        let all_stats = self.get_all_stats();
        
        let json_items: Vec<String> = all_stats
            .iter()
            .map(|s| {
                format!(
                    r#"{{
    "pool_name": "{}",
    "pool_address": "{}",
    "total_subscriptions": {},
    "price_updates": {},
    "significant_price_changes": {},
    "max_price_change_percent": {:.4},
    "cumulative_price_change": {:.4},
    "vault_updates": {},
    "error_count": {},
    "activity_score": {:.2},
    "uptime_seconds": {}
}}"#,
                    s.pool_name,
                    s.pool_address,
                    s.total_subscriptions,
                    s.price_updates,
                    s.significant_price_changes,
                    s.max_price_change_percent,
                    s.cumulative_price_change,
                    s.vault_updates,
                    s.error_count,
                    s.activity_score(),
                    s.uptime_seconds()
                )
            })
            .collect();

        format!("[\n{}\n]", json_items.join(",\n"))
    }

    /// 日志输出关键指标
    pub fn log_metrics(&self) {
        info!(
            pools = self.active_pools_count(),
            subscriptions = self.total_subscriptions(),
            updates = self.total_updates(),
            "Pool activity metrics"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pool_stats_creation() {
        let stats = PoolStats::new("SOL/USDC".to_string(), "test_addr".to_string());
        assert_eq!(stats.pool_name, "SOL/USDC");
        assert_eq!(stats.total_subscriptions, 1);
        assert_eq!(stats.price_updates, 0);
    }

    #[test]
    fn test_record_subscription() {
        let mut stats = PoolStats::new("SOL/USDC".to_string(), "test_addr".to_string());
        stats.record_subscription();
        assert_eq!(stats.total_subscriptions, 2);
    }

    #[test]
    fn test_record_price_update() {
        let mut stats = PoolStats::new("SOL/USDC".to_string(), "test_addr".to_string());
        
        stats.record_price_update(100.0, 0.1);
        assert_eq!(stats.price_updates, 1);
        assert_eq!(stats.last_price, Some(100.0));
        
        stats.record_price_update(101.0, 0.1);
        assert_eq!(stats.price_updates, 2);
        assert!(stats.max_price_change_percent > 0.0);
    }

    #[test]
    fn test_collector_operations() {
        let collector = PoolStatsCollector::new(0.1);
        
        collector.record_subscription("SOL/USDC", "addr1");
        collector.record_subscription("SOL/USDC", "addr1");
        collector.record_price_update("SOL/USDC", 100.0);  // 内部会再调用1次record_subscription
        
        assert_eq!(collector.active_pools_count(), 1);
        // ⭐ 2次显式订阅 + 1次价格更新中的隐式订阅 = 3
        assert_eq!(collector.total_subscriptions(), 3);
        assert_eq!(collector.total_updates(), 1);
        
        let stats = collector.get_pool_stats("SOL/USDC").unwrap();
        assert_eq!(stats.total_subscriptions, 3);  // 修正期望值
        assert_eq!(stats.price_updates, 1);
    }

    #[test]
    fn test_activity_score() {
        let mut stats = PoolStats::new("SOL/USDC".to_string(), "test_addr".to_string());
        
        // 模拟高活跃度
        for _ in 0..100 {
            stats.record_price_update(100.0, 0.1);
        }
        
        let score = stats.activity_score();
        assert!(score > 0.0);
        assert!(score <= 100.0);
    }
}

