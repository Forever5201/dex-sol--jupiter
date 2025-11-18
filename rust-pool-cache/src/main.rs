mod api;
mod arbitrage;
mod config;
mod coordinator;            // 🔥 协调器（混合触发）
mod database;
mod dex_interface;
mod deserializers;
mod error_tracker;
mod metrics;
mod pool_factory;
mod pool_stats;             // 🔥 池子活跃度统计模块
mod price_cache;
mod dashmap_state;          // 🔥 DashMap状态层实现
mod state_layer_factory;    // 🔥 状态层工厂
mod proxy;
mod router;
mod router_bellman_ford;
mod router_bfs;             // 🔥 BFS路由器
mod router_split_optimizer;
mod router_cache;           // 🔥 路径缓存
mod router_advanced;
mod state_layer;            // 🔥 通用状态层接口
mod websocket;
mod vault_reader;
mod opportunity_validator;  // 🎯 套利机会验证器
mod onchain_simulator;      // 🎯 链上模拟器
mod pool_initializer;       // 🚀 池子初始化器
mod lst_arbitrage;          // 🔥 LST折价套利模块（旧版）
mod stake_pool_reader;      // 🔥 Stake Pool实时数据读取（新增）
mod lst_enhanced_detector;  // 🔥 LST增强检测器（新增）
mod opportunity_merger;     // 🔥 机会合并与去重（新增）
mod mint_decimals_cache;

use anyhow::Result;
use solana_client::rpc_client::RpcClient;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::pubkey::Pubkey;
use std::env;
use std::sync::Arc;
use std::time::Instant;
use tokio::time::{interval, sleep, Duration};
use tokio::task;
use tokio::sync::mpsc;
use tracing::{info, error, warn, debug};
use tracing_subscriber::{fmt, EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

use config::Config;
use database::{DatabaseManager, DatabaseConfig};
use error_tracker::ErrorTracker;
use metrics::MetricsCollector;
use price_cache::PriceCache;
use router_advanced::{AdvancedRouter, AdvancedRouterConfig, RouterMode};
use websocket::WebSocketClient;
use crate::mint_decimals_cache::init_global_mint_cache;
use crate::pool_factory::PoolFactory;
use crate::price_cache::PoolPrice;

use crate::stake_pool_reader::StakePoolReader;
use crate::lst_enhanced_detector::{LstEnhancedDetector, LstDetectorConfig};
use crate::opportunity_merger::OpportunityMerger;
use crate::config::PoolConfig;
use std::str::FromStr;

// Phoenix pool refresh worker (moved outside main function)
async fn phoenix_refresh_worker(
    pools: Vec<PoolConfig>,
    rpc_url: String,
    price_cache: Arc<PriceCache>,
) {
    const STALE_THRESHOLD_MS: u64 = 3000;
    const MIN_REFRESH_INTERVAL_SECS: u64 = 5;
    const FULL_REFRESH_TICKS: u64 = 6; // 6 * 5s ≈ 30s (legacy cadence)

    let rpc_client = Arc::new(RpcClient::new_with_commitment(
        rpc_url.clone(),
        CommitmentConfig::confirmed(),
    ));

    let mut tick_counter: u64 = 0;

    loop {
        tick_counter = tick_counter.wrapping_add(1);
        let force_refresh = tick_counter % FULL_REFRESH_TICKS == 0;

        for pool in &pools {
            if !pool.pool_type.to_lowercase().contains("phoenix") {
                continue;
            }

            let is_stale = price_cache.is_price_stale(&pool.address, STALE_THRESHOLD_MS);
            if !is_stale && !force_refresh {
                continue;
            }

            let pubkey = match Pubkey::from_str(&pool.address) {
                Ok(key) => key,
                Err(e) => {
                    warn!("Invalid Phoenix pubkey {}: {}", pool.address, e);
                    continue;
                }
            };

            let rpc_clone = rpc_client.clone();
            match task::spawn_blocking(move || {
                rpc_clone.get_account_with_commitment(&pubkey, CommitmentConfig::confirmed())
            })
            .await
            {
                Ok(Ok(response)) => {
                    if let Some(account) = response.value {
                        match PoolFactory::create_pool(&pool.pool_type, &account.data) {
                            Ok(pool_state) => {
                                let price = pool_state.calculate_price();
                                if price == 0.0 {
                                    continue;
                                }
                                let (base_reserve, quote_reserve) = pool_state.get_reserves();
                                let (base_decimals, quote_decimals) = pool_state.get_decimals();
                                let pool_price = PoolPrice {
                                    pool_id: pool.address.clone(),
                                    dex_name: pool_state.dex_name().to_string(),
                                    pair: pool.pair.clone(),  // 🔥 FIX: 使用 pair 而不是 name
                                    price,
                                    base_reserve: base_reserve as u64,
                                    quote_reserve: quote_reserve as u64,
                                    base_decimals,
                                    quote_decimals,
                                    last_update: std::time::Instant::now(),
                                    slot: response.context.slot,
                                };
                                price_cache.update_price(pool_price);
                            }
                            Err(e) => {
                                warn!("Failed to parse Phoenix pool {}: {}", pool.address, e);
                            }
                        }
                    }
                }
                Ok(Err(e)) => {
                    warn!("RPC error for Phoenix pool {}: {}", pool.address, e);
                }
                Err(e) => {
                    warn!("Task join error for Phoenix pool {}: {}", pool.address, e);
                }
            }
        }

        sleep(Duration::from_secs(MIN_REFRESH_INTERVAL_SECS)).await;
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 4)]
async fn main() -> Result<()> {
    // Initialize logging system first
    init_logging()?;
    
    // Print banner
    print_banner();
    
    // Load configuration
    let config_path = env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".to_string());
    
    info!("Loading configuration from: {}", config_path);
    let config = Config::load_from_file(&config_path)?;
    
    info!("Configuration loaded successfully");
    info!("WebSocket URL: {}", config.websocket_url());
    info!("Pools to monitor: {}", config.pools().len());
    for pool in config.pools() {
        info!("  - {} ({})", pool.name, pool.address);
    }

    // Display proxy configuration
    if let Some(proxy) = &config.proxy {
        if proxy.enabled {
            info!("Proxy: {}:{} (enabled)", proxy.host, proxy.port);
        } else {
            info!("Proxy: disabled");
        }
    } else {
        info!("Proxy: not configured");
    }
    
    // Initialize error tracker
    let error_tracker = Arc::new(ErrorTracker::new());
    
    // Initialize metrics collector
    let metrics = Arc::new(MetricsCollector::new(1000));
    
    // Initialize price cache
    let price_cache = Arc::new(PriceCache::new());
    
    // Initialize global mint decimals cache (used by WhirlpoolState price calculation)
    let rpc_url_for_mints = config.initialization
        .as_ref()
        .and_then(|init| init.rpc_urls.first())
        .map(|s| s.as_str())
        .unwrap_or("https://api.mainnet-beta.solana.com");
    init_global_mint_cache(rpc_url_for_mints);
    
    // 🚀 Initialize pools proactively (if enabled)
    if let Some(init_config) = &config.initialization {
        if init_config.enabled && !init_config.rpc_urls.is_empty() {
            println!("🚀 Initializing pools via RPC batch query...");
            println!("   RPC endpoints: {}", init_config.rpc_urls.len());
            println!("   Pools to query: {}", config.pools().len());
            println!("   Batch size: {}", init_config.batch_size);
            println!("   Max retries: {}", init_config.max_retries);
            
            let initializer = pool_initializer::PoolInitializer::new(
                init_config.rpc_urls.clone(),
                init_config.timeout_ms,
            );
            
            let pool_addresses: Vec<String> = config
                .pools()
                .iter()
                .map(|p| p.address.clone())
                .collect();
            
            match initializer
                .fetch_pool_accounts(&pool_addresses, init_config.max_retries)
                .await
            {
                Ok(accounts_data) => {
                    let mut activated = 0;
                    let mut pools_needing_vaults: Vec<(String, String, String, String)> = Vec::new(); // (pool_name, pool_addr, vault_a, vault_b)
                    
                    for (idx, account_data) in accounts_data.iter().enumerate() {
                        if let Some(data) = account_data {
                            let pool_config = &config.pools()[idx];
                            
                            // 尝试解析并激活池子
                            match pool_factory::PoolFactory::create_pool(
                                &pool_config.pool_type,
                                data,
                            ) {
                                Ok(pool) => {
                                    if pool.is_active() {
                                        // 添加到价格缓存
                                        let (base_reserve, quote_reserve) = pool.get_reserves();
                                        let price = pool.calculate_price();
                                        let (base_decimals, quote_decimals) = pool.get_decimals();
                                        
                                        price_cache.update_price(price_cache::PoolPrice {
                                            pool_id: pool_config.address.clone(),
                                            dex_name: pool.dex_name().to_string(),
                                            pair: pool_config.pair.clone(),  // 🔥 FIX: 使用 pair 而不是 name
                                            base_reserve,
                                            quote_reserve,
                                            base_decimals,
                                            quote_decimals,
                                            price,
                                            last_update: std::time::Instant::now(),
                                            slot: 0, // 初始化时slot为0
                                        });
                                        
                                        activated += 1;
                                        info!("   ✅ Activated: {} ({})", pool_config.name, pool.dex_name());
                                        
                                        // 🔥 关键修复：在RPC初始化时就记录需要vault的池子
                                        if let Some((vault_a, vault_b)) = pool.get_vault_addresses() {
                                            let vault_a_str = vault_a.to_string();
                                            let vault_b_str = vault_b.to_string();
                                            info!("   📌 Pre-registering vaults for {}: {}, {}", 
                                                  pool_config.name, 
                                                  &vault_a_str[0..8],
                                                  &vault_b_str[0..8]);
                                            pools_needing_vaults.push((
                                                pool_config.name.clone(),
                                                pool_config.address.clone(),
                                                vault_a_str,
                                                vault_b_str
                                            ));
                                        }
                                    } else {
                                        info!("   ⚠️  Inactive: {} (no reserves)", pool_config.name);
                                    }
                                }
                                Err(e) => {
                                    info!("   ⚠️  Failed to parse: {} - {}", pool_config.name, e);
                                }
                            }
                        } else {
                            let pool_config = &config.pools()[idx];
                            info!("   ❌ Not found: {}", pool_config.name);
                        }
                    }
                    
                    println!(
                        "✅ Initialized {}/{} pools successfully",
                        activated,
                        pool_addresses.len()
                    );
                    
                    if !pools_needing_vaults.is_empty() {
                        println!("📌 {} pools need vault subscription (will subscribe after WebSocket connects)\n", pools_needing_vaults.len());
                    } else {
                        println!();
                    }
                }
                Err(e) => {
                    warn!(
                        "⚠️  Pool initialization failed: {}, continuing with WebSocket only",
                        e
                    );
                }
            }
        } else if let Some(init_config) = &config.initialization {
            if !init_config.enabled {
                println!("ℹ️  Pool initialization disabled in config\n");
            } else if init_config.rpc_urls.is_empty() {
                println!("⚠️  Pool initialization enabled but no RPC URLs configured\n");
            }
        }
    } else {
        println!("ℹ️  Pool initialization not configured\n");
    }
    
    // Initialize database (if enabled)
    let db_manager = if let Some(db_config) = &config.database {
        if db_config.enabled {
            println!("🗄️  Initializing database...");
            match DatabaseManager::new(DatabaseConfig {
                enabled: db_config.enabled,
                url: db_config.url.clone(),
                record_opportunities: db_config.record_opportunities,
                record_pool_updates: db_config.record_pool_updates,
                record_performance: db_config.record_performance,
            }).await {
                Ok(mut db) => {
                    db.set_subscription_start();
                    Some(Arc::new(tokio::sync::Mutex::new(db)))
                }
                Err(e) => {
                    eprintln!("⚠️  Database initialization failed: {}", e);
                    eprintln!("   Continuing without database recording...");
                    None
                }
            }
        } else {
            println!("   Database: disabled");
            None
        }
    } else {
        println!("   Database: not configured");
        None
    };

    // 🚨 Phoenix价格刷新 - 防止WebSocket长时间无更新导致价格陈旧
    let phoenix_pools: Vec<PoolConfig> = config
        .pools()
        .iter()
        .cloned()
        .filter(|p| p.pool_type.to_lowercase().contains("phoenix"))
        .collect();

    let phoenix_refresh_handle = if !phoenix_pools.is_empty() {
        if let Some(rpc_url) = config
            .initialization
            .as_ref()
            .and_then(|init| init.rpc_urls.first())
            .cloned()
        {
            println!("🛰️  Starting Phoenix price refresher ({} pools)...", phoenix_pools.len());
            let price_cache_clone = price_cache.clone();
            Some(tokio::spawn(async move {
                phoenix_refresh_worker(phoenix_pools, rpc_url, price_cache_clone).await;
            }))
        } else {
            warn!("Phoenix pools configured but no RPC URL available for refresher");
            None
        }
    } else {
        None
    };
    println!();
    
    // 🔥 Initialize StakePoolReader for LST Enhanced Detector
    let stake_pool_reader = if let Some(lst_config) = &config.lst_detector {
        if lst_config.enabled {
            println!("🔥 Initializing Stake Pool Reader for LST detection...");
            
            // Get RPC URL from initialization config
            let rpc_url = config.initialization
                .as_ref()
                .and_then(|init| init.rpc_urls.first())
                .map(|s| s.as_str())
                .unwrap_or("https://api.mainnet-beta.solana.com");
            
            println!("   RPC URL: {}", rpc_url);
            println!("   Cache TTL: {}s", lst_config.stake_pool_update_interval);
            
            match StakePoolReader::new(rpc_url, lst_config.stake_pool_update_interval) {
                Ok(reader) => {
                    let reader: Arc<StakePoolReader> = Arc::new(reader);
                    
                    // Initial update to fetch theoretical rates
                    match reader.update_cache() {
                        Ok(_) => {
                            let (msol_rate, jitosol_rate, _) = reader.get_cache_info();
                            println!("   ✅ Stake pool cache initialized:");
                            println!("      mSOL rate: {:.6}", msol_rate);
                            println!("      jitoSOL rate: {:.6}", jitosol_rate);
                        }
                        Err(e) => {
                            warn!("⚠️  Failed to initialize stake pool cache: {}", e);
                            warn!("   Using default theoretical rates (mSOL: 1.05, jitoSOL: 1.04)");
                        }
                    }
                    
                    Some(reader)
                }
                Err(e) => {
                    warn!("⚠️  Failed to create StakePoolReader: {}", e);
                    warn!("   LST Enhanced Detector will be disabled");
                    None
                }
            }
        } else {
            println!("ℹ️  LST Detector disabled in config\n");
            None
        }
    } else {
        println!("ℹ️  LST Detector not configured\n");
        None
    };
    println!();
    
    // ✅ FIX: Connect WebSocket in MAIN task (avoids spawn scheduling issue)
    println!("🔌 Establishing WebSocket connection in main task...");
    println!("   URL: {}", config.websocket_url());
    
    let ws_stream = match proxy::connect_direct(config.websocket_url()).await {
        Ok(stream) => {
            println!("✅ WebSocket connected successfully!");
            stream
        }
        Err(e) => {
            eprintln!("❌ Failed to connect to WebSocket: {}", e);
            eprintln!("   Please check your network connection and RPC endpoint");
            return Err(e);
        }
    };
    
    // Get price change threshold from config
    let price_change_threshold = config.logging
        .as_ref()
        .map(|l| l.price_change_threshold_percent)
        .unwrap_or(1.0);
    
    // 🔥 Initialize Coordinator (混合触发模型 + 计算风暴防护)
    println!("\n🎯 Initializing Coordinator...");
    let (event_tx, event_rx) = mpsc::channel(1024);  // 事件channel（高容量）
    let (calc_tx, calc_rx) = mpsc::channel(1);       // 计算任务channel（容量1，防止堆积）

    let coordinator_config = coordinator::CoordinatorConfig {
        tick_interval_ms: 100,          // 100ms时钟兜底扫描
        high_threshold_percent: 0.2,     // 0.2%价格变化触发快速扫描
        cooldown_ms: 20,                 // 20ms冷却防抖动
        event_channel_capacity: 1024,
        calc_channel_capacity: 1,
    };

    let coordinator = coordinator::Coordinator::new(coordinator_config, event_rx, calc_tx);
    let coordinator_handle = tokio::spawn(async move {
        info!("🎯 Coordinator task started");
        coordinator.run().await;
    });

    // 🔥 Initialize WebSocket client (with Coordinator event sender)
    info!("Initializing WebSocket client...");

    // 🚀 获取RPC URL用于主动查询vault
    let rpc_url_for_vault = config.initialization
        .as_ref()
        .and_then(|init| init.rpc_urls.first().cloned());

    let ws_client = WebSocketClient::new(
        config.websocket_url().to_string(),
        metrics.clone(),
        config.proxy.clone(),
        price_cache.clone(),
        error_tracker.clone(),
        price_change_threshold,
        rpc_url_for_vault, // 🚀 传入RPC URL用于主动触发vault订阅
    );

    // 🔥 Register Coordinator sender with WebSocket client
    ws_client.set_coordinator_sender(event_tx);

    info!("✅ WebSocket client configured with Coordinator");
    
    // 🔥 Get pool stats collector before moving ws_client
    let pool_stats = ws_client.pool_stats();
    let pool_stats_for_shutdown = pool_stats.clone(); // 🔥 Clone for shutdown handler
    
    // Spawn WebSocket processing task with the already-connected stream
    info!("Starting WebSocket message processing task...");
    let pools = config.pools().to_vec();
    let ws_handle = tokio::spawn(async move {
        if let Err(e) = ws_client.run_with_stream(ws_stream, pools).await {
            error!("Fatal WebSocket error: {}", e);
        }
    });
    
    // Spawn metrics reporting task
    println!("📊 Starting metrics reporting task...");
    let metrics_clone = metrics.clone();
    let metrics_handle = tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(60));
        
        loop {
            ticker.tick().await;
            metrics_clone.print_stats(60);
        }
    });
    
    // Spawn advanced arbitrage router task
    println!("⚡ Starting advanced arbitrage router with Bellman-Ford + DP optimization...");
    let price_cache_clone = price_cache.clone();
    let db_manager_clone = db_manager.clone();
    let router_config = if let Some(ref router_cfg) = config.router {
        AdvancedRouterConfig {
            mode: RouterMode::from_str(&router_cfg.mode),
            min_roi_percent: router_cfg.min_roi_percent,
            max_hops: router_cfg.max_hops,
            enable_split_optimization: router_cfg.enable_split_optimization,
            max_splits: router_cfg.split_optimizer.as_ref().map(|s| s.max_splits).unwrap_or(5),
            min_split_amount: router_cfg.split_optimizer.as_ref().map(|s| s.min_split_amount).unwrap_or(100.0),
        }
    } else {
        AdvancedRouterConfig::default()
    };

    // 🔥 Initialize Coordinator and Calculator channels
    println!("\n🎯 Initializing Coordinator and Calculator channels...");
    let (event_tx, event_rx) = mpsc::channel(1024);  // 事件channel（高容量）
    let (calc_tx, mut calc_rx) = mpsc::channel(1);   // 计算任务channel（容量1，防止堆积）
    info!("   └─ Event channel capacity: 1024");
    info!("   └─ Calculation channel capacity: 1 (prevents task堆积)");

    // 🔥 Initialize Coordinator (mix trigger + storm protection)
    println!("\n🎯 Initializing Coordinator...");
    let coordinator_config = coordinator::CoordinatorConfig {
        tick_interval_ms: 100,          // 100ms clock sweep
        high_threshold_percent: 0.2,     // 0.2% price change triggers fast scan
        cooldown_ms: 20,                 // 20ms cooldown anti-jitter
        event_channel_capacity: 1024,
        calc_channel_capacity: 1,
    };

    let coordinator = coordinator::Coordinator::new(coordinator_config, event_rx, calc_tx);
    let coordinator_handle = tokio::spawn(async move {
        info!("🎯 Coordinator task started");
        coordinator.run().await;
    });

    // 🔥 Initialize Calculator task (listens to calc_rx, executes scans)
    println!("\n🧮 Starting Calculator task...");
    let calculator_router = Arc::new(AdvancedRouter::new(price_cache.clone(), router_config.clone()));
    let calculator_handle = tokio::spawn(async move {
        info!("🧮 Calculator task started, waiting for tasks from Coordinator...");

        while let Some(task) = calc_rx.recv().await {
            debug!("🧮 Received calculation task: {:?} from {}", task.trigger_type, task.trigger_source);

            // Only scan if there's a trigger
            let sol_amount = 10.0;
            let sol_price = 140.0;
            let initial_amount_usd = sol_amount * sol_price;

            info!("🔍 Starting arbitrage scan (triggered by: {})", task.trigger_source);

            // Run router scan
            let paths = calculator_router.find_optimal_routes(initial_amount_usd).await;

            let total_paths = paths.len();
            info!("⏱️  Scan completed, found {} opportunities", total_paths);

            // Log or process opportunities here
            if !paths.is_empty() {
                println!("\n🔥 Found {} arbitrage opportunities!", total_paths);
                for (idx, path) in paths.iter().enumerate() {
                    println!("   Opportunity #{}: {:.4}% ROI", idx + 1, path.optimized_roi);
                }
            }
        }

        info!("🧮 Calculator task shutdown (calc_rx closed)");
    });

    let arbitrage_handle = if config.router.as_ref()
        .and_then(|r| r.event_driven.as_ref())
        .map(|e| e.enabled)
        .unwrap_or(false)
    {
        // 🎯 Event-driven mode
        let event_config = config.router.as_ref().unwrap().event_driven.as_ref().unwrap().clone();

        let stake_pool_reader_for_task = stake_pool_reader.clone();

        tokio::spawn(async move {
            // 🔥 DEPRECATED: Old event-driven logic disabled - Coordinator and Calculator now handle all triggers
            info!("⚠️  Legacy event-driven router is DISABLED - Coordinator and Calculator are now handling all triggers");

            // Keep this task alive but do nothing
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                info!("⚠️  Legacy event-driven router task is idle (Coordinator is active)");
            }
        })
    } else {
        // 🎯 Non-event-driven mode - return a dummy handle for compatibility
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
        })
    };

    // 🎯 创建链上模拟器（如果配置启用）
    let simulator = if let Some(sim_config) = &config.simulation {
        if sim_config.enabled {
            let rpc_url = sim_config.rpc_url.clone()
                .unwrap_or_else(|| {
                    // 从WebSocket URL转换为HTTP URL
                    config.websocket_url().replace("wss://", "https://").replace("ws://", "http://")
                });
            
            info!("🎯 Initializing on-chain simulator...");
            info!("   RPC URL: {}", rpc_url.chars().take(50).collect::<String>());
            info!("   Min confidence: {:.1}%", sim_config.min_confidence_for_simulation);
            info!("   Max concurrent: {}", sim_config.max_concurrent_simulations);
            
            let sim_cfg = onchain_simulator::SimulatorConfig {
                min_confidence_for_simulation: sim_config.min_confidence_for_simulation,
                timeout_ms: sim_config.simulation_timeout_ms,
                max_concurrent: sim_config.max_concurrent_simulations,
            };
            
            Some(Arc::new(onchain_simulator::OnChainSimulator::new(rpc_url, sim_cfg)))
        } else {
            info!("ℹ️  On-chain simulation disabled");
            None
        }
    } else {
        info!("ℹ️  On-chain simulation not configured");
        None
    };
    
    // Spawn HTTP API server LAST (starts in background)
    info!("Starting HTTP API server on port 3001...");
    let api_handle = {
        let price_cache_clone = price_cache.clone();
        let error_tracker_api = error_tracker.clone();
        let simulator_clone = simulator.clone();
        tokio::spawn(async move {
            if let Err(e) = api::start_api_server(price_cache_clone, error_tracker_api, simulator_clone, 3001).await {
                error!("API server error: {}", e);
            }
        })
    };
    
    println!("\n✅ All tasks started successfully!\n");
    
    // Wait for tasks to complete (they run indefinitely)
    tokio::select! {
        _ = ws_handle => {
            eprintln!("WebSocket task terminated");
        }
        _ = metrics_handle => {
            eprintln!("Metrics task terminated");
        }
        _ = arbitrage_handle => {
            eprintln!("Arbitrage scanner terminated");
        }
        _ = api_handle => {
            eprintln!("API server terminated");
        }
        _ = async {
            if let Some(handle) = phoenix_refresh_handle {
                let _ = handle.await;
            }
        } => {
            eprintln!("Phoenix refresher terminated");
        }
        _ = tokio::signal::ctrl_c() => {
            println!("\n\n🛑 Received Ctrl+C, shutting down...");
            
            // Print final statistics
            println!("\n📊 Final Statistics:");
            metrics.print_stats(60);
            
            // 🔥 Print detailed pool activity statistics
            println!("\n🔥 Pool Activity Statistics:");
            pool_stats_for_shutdown.print_summary(3600); // Last hour
            pool_stats_for_shutdown.print_detailed_stats(20, 3600); // Top 20 pools
            
            // Print cache stats
            let (pools, pairs) = price_cache.get_stats();
            println!("\n💾 Cache Statistics:");
            println!("   Cached pools: {}", pools);
            println!("   Unique pairs: {:?}", pairs);
            
            println!("👋 Goodbye!\n");
        }
    }
    
    Ok(())
}

/// Initialize the logging system with dual output
fn init_logging() -> Result<()> {
    // Create logs directory if it doesn't exist
    std::fs::create_dir_all("logs").ok();
    
    // File appender with daily rotation
    let file_appender = RollingFileAppender::new(
        Rotation::DAILY,
        "logs",
        "rust-pool-cache.log",
    );
    
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    
    // Determine log level from environment variable or default to INFO
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));
    
    // Build the subscriber with dual layers
    tracing_subscriber::registry()
        .with(env_filter)
        // Terminal layer: colored, human-readable
        .with(
            fmt::layer()
                .with_writer(std::io::stdout)
                .with_ansi(true)
                .with_target(false)
                .compact()
        )
        // File layer: JSON format for analysis
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .json()
        )
        .init();
    
    // Prevent the guard from being dropped
    std::mem::forget(_guard);
    
    Ok(())
}

fn print_banner() {
    println!("\n╔═══════════════════════════════════════════════════════════╗");
    println!("║                                                           ║");
    println!("║   🦀 Solana Pool Cache - Prototype Version 0.1.0          ║");
    println!("║                                                           ║");
    println!("║   Real-time WebSocket subscription to Raydium pools      ║");
    println!("║   Measuring latency and validating Borsh deserialization ║");
    println!("║                                                           ║");
    println!("╚═══════════════════════════════════════════════════════════╝\n");
}

