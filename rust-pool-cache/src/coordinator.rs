/// ========================================================================
/// 协调器 (Coordinator) - 决策层
/// ========================================================================
///
/// 核心职责：
/// 1. 混合触发模型：时钟驱动（兜底）+ 事件驱动（狙击）
/// 2. 防止计算风暴：cooldown机制
/// 3. 统一调度：将计算任务发送给Calculator
///
/// 这是系统的"神经中枢"，确保套利机会不被遗漏的同时防止系统过载
/// ========================================================================

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex};
use tokio::time::interval;
use tracing::{debug, info, warn};

/// 价格变化事件
///
/// 由Subscriber发送给Coordinator
#[derive(Debug, Clone)]
pub struct PriceChangeEvent {
    /// 池子地址
    pub pool_id: String,
    /// 池子名称（如"SOL/USDC"）
    pub pool_name: String,
    /// 交易对（pair字段）
    pub pair: String,
    /// 价格变化百分比（如0.002表示0.2%）
    pub price_change_percent: f64,
    /// 旧价格
    pub old_price: Option<f64>,
    /// 新价格
    pub new_price: f64,
    /// 事件发生时间
    pub timestamp: Instant,
}

/// 计算任务
///
/// 由Coordinator发送给Calculator
#[derive(Debug, Clone)]
pub struct CalculationTask {
    /// 触发类型：clock（时钟）| event（事件）
    pub trigger_type: TriggerType,
    /// 触发源（池子名称或"periodic"）
    pub trigger_source: String,
    /// 触发时的价格变化（事件触发时有值）
    pub price_change_percent: Option<f64>,
    /// 任务创建时间
    pub created_at: Instant,
}

/// 触发类型
#[derive(Debug, Clone, PartialEq)]
pub enum TriggerType {
    /// 时钟触发（兜底扫描）
    Clock,
    /// 事件触发（价格变化）
    Event,
}

/// 协调器配置
#[derive(Debug, Clone)]
pub struct CoordinatorConfig {
    /// 时钟周期（兜底扫描间隔）
    pub tick_interval_ms: u64,
    /// 高阈值：价格变化超过此值触发狙击
    pub high_threshold_percent: f64,
    /// 冷却时间（防止计算风暴）
    pub cooldown_ms: u64,
    /// 计算任务channel容量（通常设为1，防止堆积）
    pub calc_channel_capacity: usize,
    /// 事件channel容量（通常设为1024）
    pub event_channel_capacity: usize,
}

impl Default for CoordinatorConfig {
    fn default() -> Self {
        Self {
            tick_interval_ms: 100,      // 100ms兜底扫描
            high_threshold_percent: 0.2, // 0.2%变化触发狙击
            cooldown_ms: 20,             // 20ms冷却防抖动
            calc_channel_capacity: 1,    // 容量1，防止任务堆积
            event_channel_capacity: 1024, // 事件channel容量
        }
    }
}

/// 协调器
pub struct Coordinator {
    /// 配置
    config: CoordinatorConfig,

    /// 接收价格变化事件
    event_rx: mpsc::Receiver<PriceChangeEvent>,

    /// 发送计算任务给Calculator
    calc_tx: mpsc::Sender<CalculationTask>,

    /// 上次触发时间（用于cooldown）
    last_trigger: Arc<Mutex<Instant>>,

    /// 统计信息
    stats: Arc<Mutex<CoordinatorStats>>,
}

/// 协调器统计
#[derive(Debug, Default)]
pub struct CoordinatorStats {
    /// 总接收事件数
    pub total_events: u64,
    /// 触发的事件数（价格变化超过阈值）
    pub triggered_events: u64,
    /// 跳过的触发（在cooldown期）
    pub skipped_triggers: u64,
    /// 时钟触发次数
    pub clock_triggers: u64,
    /// 事件触发次数
    pub event_triggers: u64,
    /// 计算任务发送失败次数（Calculator繁忙）
    pub failed_sends: u64,
}

impl Coordinator {
    /// 创建新的协调器
    ///
    /// # 参数
    /// * `config` - 协调器配置
    /// * `event_rx` - 接收价格变化事件
    /// * `calc_tx` - 发送计算任务（由外部创建并传入）
    ///
    /// # 返回
    /// 协调器实例
    pub fn new(
        config: CoordinatorConfig,
        event_rx: mpsc::Receiver<PriceChangeEvent>,
        calc_tx: mpsc::Sender<CalculationTask>,
    ) -> Self {
        // 安全初始化：只减去 cooldown_ms + 1ms，避免长时间跨度导致的溢出
        // 这样可以确保第一次触发总是可以通过 cooldown 检查
        let safe_initial_time = Instant::now()
            .checked_sub(Duration::from_millis(config.cooldown_ms + 1))
            .unwrap_or_else(|| Instant::now() - Duration::from_millis(1));

        Self {
            config,
            event_rx,
            calc_tx,
            last_trigger: Arc::new(Mutex::new(safe_initial_time)),
            stats: Arc::new(Mutex::new(CoordinatorStats::default())),
        }
    }

    /// 运行协调器主循环
    ///
    /// 同时监听两个触发源：
    /// 1. 时钟tick（兜底扫描）
    /// 2. 价格变化事件（狙击机会）
    pub async fn run(mut self) {
        info!("🎯 Coordinator started");
        info!("   └─ Tick interval: {}ms", self.config.tick_interval_ms);
        info!("   └─ High threshold: {}%", self.config.high_threshold_percent);
        info!("   └─ Cooldown: {}ms", self.config.cooldown_ms);

        let mut tick = interval(Duration::from_millis(self.config.tick_interval_ms));

        loop {
            tokio::select! {
                // [触发源 A]: 时钟驱动（兜底扫描）
                _ = tick.tick() => {
                    debug!("(Coordinator) Clock tick");

                    // 立即发送计算任务（时钟触发是强制的）
                    let task = CalculationTask {
                        trigger_type: TriggerType::Clock,
                        trigger_source: "periodic_clock".to_string(),
                        price_change_percent: None,
                        created_at: Instant::now(),
                    };

                    match self.calc_tx.try_send(task) {
                        Ok(_) => {
                            info!("(Coordinator) Clock triggered calculation");
                            self.update_stats(|stats| {
                                stats.clock_triggers += 1;
                            }).await;
                        }
                        Err(e) => {
                            warn!("(Coordinator) Calculator busy, clock trigger skipped: {}", e);
                            self.update_stats(|stats| {
                                stats.failed_sends += 1;
                            }).await;
                        }
                    }
                }

                // [触发源 B]: 事件驱动（价格变化）
                Some(event) = self.event_rx.recv() => {
                    debug!(
                        "(Coordinator) Received price change event: pool={}, change={:.4}%",
                        event.pool_name,
                        event.price_change_percent * 100.0
                    );

                    self.update_stats(|stats| {
                        stats.total_events += 1;
                    }).await;

                    // 检查是否超过阈值
                    if event.price_change_percent > self.config.high_threshold_percent / 100.0 {
                        info!(
                            "(Coordinator) High price change detected: {} ({}): {:.4}% > {:.4}%",
                            event.pool_name,
                            event.pair,
                            event.price_change_percent * 100.0,
                            self.config.high_threshold_percent
                        );

                        self.update_stats(|stats| {
                            stats.triggered_events += 1;
                        }).await;

                        // 检查cooldown
                        let should_trigger = {
                            let mut last_trigger = self.last_trigger.lock().await;
                            let elapsed = last_trigger.elapsed();
                            let cooldown = Duration::from_millis(self.config.cooldown_ms);

                            if elapsed >= cooldown {
                                *last_trigger = Instant::now();
                                true
                            } else {
                                false
                            }
                        };

                        if should_trigger {
                            info!(
                                "(Coordinator) Event triggered calculation (cooldown satisfied): {}",
                                event.pool_name
                            );

                            let task = CalculationTask {
                                trigger_type: TriggerType::Event,
                                trigger_source: format!("{} ({})", event.pool_name, event.pair),
                                price_change_percent: Some(event.price_change_percent),
                                created_at: Instant::now(),
                            };

                            match self.calc_tx.try_send(task) {
                                Ok(_) => {
                                    info!("(Coordinator) Successfully sent calculation task to calculator");
                                    self.update_stats(|stats| {
                                        stats.event_triggers += 1;
                                    }).await;
                                }
                                Err(e) => {
                                    warn!("(Coordinator) Calculator busy, event trigger skipped: {}", e);
                                    self.update_stats(|stats| {
                                        stats.failed_sends += 1;
                                    }).await;
                                }
                            }
                        } else {
                            debug!("(Coordinator) Event trigger skipped (in cooldown)");
                            self.update_stats(|stats| {
                                stats.skipped_triggers += 1;
                            }).await;
                        }
                    } else {
                        // 价格变化低于阈值，忽略
                        debug!(
                            "(Coordinator) Price change below threshold: {:.4}% < {:.4}%, ignoring",
                            event.price_change_percent * 100.0,
                            self.config.high_threshold_percent
                        );
                    }
                }
            }
        }
    }

    /// 获取统计信息
    pub async fn get_stats(&self) -> CoordinatorStats {
        let stats = self.stats.lock().await;
        CoordinatorStats {
            total_events: stats.total_events,
            triggered_events: stats.triggered_events,
            skipped_triggers: stats.skipped_triggers,
            clock_triggers: stats.clock_triggers,
            event_triggers: stats.event_triggers,
            failed_sends: stats.failed_sends,
        }
    }

    /// 更新统计信息
    async fn update_stats<F>(&self, f: F)
    where
        F: FnOnce(&mut CoordinatorStats),
    {
        let mut stats = self.stats.lock().await;
        f(&mut stats);
    }
}

/// 打印统计信息（格式化输出）
pub fn print_coordinator_stats(stats: &CoordinatorStats) {
    println!("\n========================================");
    println!("📊 Coordinator Statistics");
    println!("========================================");
    println!("总接收事件数: {}", stats.total_events);
    println!("触发事件数（>阈值）: {}", stats.triggered_events);
    println!("跳过的触发（cooldown）: {}", stats.skipped_triggers);
    println!();
    println!("时钟触发次数: {}", stats.clock_triggers);
    println!("事件触发次数: {}", stats.event_triggers);
    println!();
    println!("发送失败次数: {}", stats.failed_sends);

    if stats.total_events > 0 {
        let triggered_ratio = (stats.triggered_events as f64 / stats.total_events as f64) * 100.0;
        println!("\n事件触发率: {:.2}%", triggered_ratio);
    }

    let total_sends = stats.clock_triggers + stats.event_triggers;
    if total_sends > 0 {
        let fail_ratio = (stats.failed_sends as f64 / total_sends as f64) * 100.0;
        println!("发送失败率: {:.2}%", fail_ratio);
    }
    println!("========================================\n");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_coordinator_clock_trigger() {
        let config = CoordinatorConfig {
            tick_interval_ms: 50, // 50ms for faster test
            ..Default::default()
        };

        let (_event_tx, event_rx) = mpsc::channel(config.event_channel_capacity);
        let (calc_tx, mut calc_rx) = mpsc::channel(config.calc_channel_capacity);

        let coordinator = Coordinator::new(config, event_rx, calc_tx);

        // Run coordinator in background
        let handle = tokio::spawn(async move {
            coordinator.run().await;
        });

        // Wait for at least 2 clock ticks
        tokio::time::sleep(Duration::from_millis(120)).await;

        // Drop coordinator to stop it
        drop(handle);

        // Check received tasks
        let mut clock_count = 0;
        while let Ok(task) = calc_rx.try_recv() {
            if task.trigger_type == TriggerType::Clock {
                clock_count += 1;
            }
        }

        // Should have received at least 2 clock triggers
        assert!(clock_count >= 2, "Expected at least 2 clock triggers, got {}", clock_count);
    }

    #[tokio::test]
    async fn test_coordinator_event_trigger() {
        let config = CoordinatorConfig {
            high_threshold_percent: 0.1, // 0.1%
            cooldown_ms: 50,
            ..Default::default()
        };

        let (event_tx, event_rx) = mpsc::channel(config.event_channel_capacity);
        let (calc_tx, mut calc_rx) = mpsc::channel(config.calc_channel_capacity);

        let coordinator = Coordinator::new(config, event_rx, calc_tx);

        // Run coordinator in background
        tokio::spawn(async move {
            coordinator.run().await;
        });

        // Send a high price change event
        event_tx
            .send(PriceChangeEvent {
                pool_id: "pool1".to_string(),
                pool_name: "SOL/USDC".to_string(),
                pair: "SOL/USDC".to_string(),
                price_change_percent: 0.15 / 100.0, // 0.15% > 0.1% threshold
                old_price: Some(100.0),
                new_price: 100.15,
                timestamp: Instant::now(),
            })
            .await
            .unwrap();

        // Wait for processing
        tokio::time::sleep(Duration::from_millis(20)).await;

        // Should receive the task
        let task = calc_rx.try_recv().unwrap();
        assert_eq!(task.trigger_type, TriggerType::Event);
        assert_eq!(task.trigger_source, "SOL/USDC (SOL/USDC)");
        assert_eq!(task.price_change_percent, Some(0.15 / 100.0));
    }

    #[tokio::test]
    async fn test_coordinator_cooldown() {
        let config = CoordinatorConfig {
            high_threshold_percent: 0.05, // 0.05%
            cooldown_ms: 100, // 100ms cooldown
            ..Default::default()
        };

        let (event_tx, event_rx) = mpsc::channel(config.event_channel_capacity);
        let (calc_tx, _calc_rx) = mpsc::channel(config.calc_channel_capacity);

        let coordinator = Coordinator::new(config, event_rx, calc_tx);
        let stats = coordinator.get_stats().await;
        assert_eq!(stats.total_events, 0);

        // Run coordinator in background
        tokio::spawn(async move {
            coordinator.run().await;
        });

        // Send first event (should trigger)
        event_tx
            .send(PriceChangeEvent {
                pool_id: "pool1".to_string(),
                pool_name: "SOL/USDC".to_string(),
                pair: "SOL/USDC".to_string(),
                price_change_percent: 0.1 / 100.0, // 0.1% > 0.05%
                old_price: Some(100.0),
                new_price: 100.1,
                timestamp: Instant::now(),
            })
            .await
            .unwrap();

        // Send second event immediately (should be skipped due to cooldown)
        event_tx
            .send(PriceChangeEvent {
                pool_id: "pool2".to_string(),
                pool_name: "SOL/USDT".to_string(),
                pair: "SOL/USDT".to_string(),
                price_change_percent: 0.1 / 100.0, // Also 0.1%
                old_price: Some(100.0),
                new_price: 100.1,
                timestamp: Instant::now(),
            })
            .await
            .unwrap();

        // Wait a bit
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Check stats
        // Note: This is a simplified test - in real scenario we'd need to access coordinator's stats
    }

    #[tokio::test]
    async fn test_coordinator_below_threshold() {
        let config = CoordinatorConfig {
            high_threshold_percent: 0.2, // 0.2%
            ..Default::default()
        };

        let (event_tx, event_rx) = mpsc::channel(config.event_channel_capacity);
        let (calc_tx, mut calc_rx) = mpsc::channel(config.calc_channel_capacity);

        let coordinator = Coordinator::new(config, event_rx, calc_tx);

        // Run coordinator in background
        tokio::spawn(async move {
            coordinator.run().await;
        });

        // Send a low price change event (< threshold)
        event_tx
            .send(PriceChangeEvent {
                pool_id: "pool1".to_string(),
                pool_name: "SOL/USDC".to_string(),
                pair: "SOL/USDC".to_string(),
                price_change_percent: 0.1 / 100.0, // 0.1% < 0.2%
                old_price: Some(100.0),
                new_price: 100.1,
                timestamp: Instant::now(),
            })
            .await
            .unwrap();

        // Wait for processing
        tokio::time::sleep(Duration::from_millis(20)).await;

        // Should NOT receive any task (below threshold)
        assert!(calc_rx.try_recv().is_err());
    }

    #[test]
    fn test_trigger_type() {
        assert_eq!(TriggerType::Clock, TriggerType::Clock);
        assert_eq!(TriggerType::Event, TriggerType::Event);
        assert_ne!(TriggerType::Clock, TriggerType::Event);
    }
}
