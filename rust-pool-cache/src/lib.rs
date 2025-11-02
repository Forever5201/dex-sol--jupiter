// Library exports for testing
pub mod config;
pub mod price_cache;
pub mod router;
pub mod router_bellman_ford;
pub mod router_split_optimizer;
pub mod router_advanced;
pub mod database;
pub mod error_tracker;
pub mod arbitrage;              // 套利检测
pub mod opportunity_validator;  // 🎯 套利机会验证器
pub mod onchain_simulator;      // 🎯 链上模拟器
pub mod dex_interface;          // DEX接口trait
pub mod pool_factory;           // 池子工厂
pub mod deserializers;          // 反序列化器
pub mod utils;                  // 工具模块（结构体验证、数据探测）
pub mod reserve_fetcher;        // 储备金获取模块
pub mod clob_subscription;      // 🔥 CLOB多账户订阅管理器
pub mod pool_stats;             // 🔥 池子活跃度统计模块
pub mod metrics;                // 性能指标收集模块
pub mod lst_arbitrage;          // 🔥 LST折价套利模块（旧版）
pub mod stake_pool_reader;      // 🔥 Stake Pool实时数据读取（新增）
pub mod lst_enhanced_detector;  // 🔥 LST增强检测器（新增）
pub mod opportunity_merger;     // 🔥 机会合并与去重（新增）






