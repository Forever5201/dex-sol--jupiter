use anyhow::{Context, Result};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt, future::join_all};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::{
    tungstenite::protocol::Message, MaybeTlsStream, WebSocketStream,
};
use tracing::{info, warn, error, debug};
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

use crate::config::{PoolConfig, ProxyConfig};
use crate::coordinator::PriceChangeEvent; // 🔥 Coordinator事件
use crate::dex_interface::DexPool;
use crate::error_tracker::ErrorTracker;
use crate::metrics::MetricsCollector;
use crate::pool_factory::PoolFactory;
use crate::pool_stats::PoolStatsCollector; // 🔥 池子统计收集器
use crate::price_cache::{PoolPrice, PriceCache};
use crate::proxy;
use crate::vault_reader::VaultReader;

#[allow(dead_code)]
type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// 订阅请求类型
#[derive(Debug, Clone)]
pub enum SubscriptionRequest {
    VaultAccount { address: String, pool_name: String },
}

pub struct WebSocketClient {
    url: String,
    metrics: Arc<MetricsCollector>,
    pool_stats: Arc<PoolStatsCollector>, // 🔥 池子活跃度统计收集器
    proxy_config: Option<ProxyConfig>,
    price_cache: Arc<PriceCache>,
    error_tracker: Arc<ErrorTracker>,
    subscription_map: Arc<Mutex<HashMap<u64, PoolConfig>>>,
    vault_pending_map: Arc<Mutex<HashMap<u64, String>>>, // 🌐 request_id -> vault地址（等待确认）
    vault_subscription_map: Arc<Mutex<HashMap<u64, String>>>, // 🌐 subscription_id -> vault地址（已确认）
    vault_reader: Arc<Mutex<VaultReader>>, // 🌐 Vault 读取器
    pool_data_cache: Arc<Mutex<HashMap<String, Vec<u8>>>>, // 🌐 缓存池子数据用于提取 vault
    last_prices: Arc<DashMap<String, f64>>, // 🔥 Track last prices for change detection (使用DashMap避免锁争用)
    price_change_threshold: f64, // 🔥 Price change threshold for logging
    vault_subscription_tx: Arc<Mutex<Option<mpsc::UnboundedSender<SubscriptionRequest>>>>, // 🌐 动态订阅channel
    rpc_url: Option<String>, // 🚀 RPC URL for proactive vault detection
    coordinator_tx: Arc<Mutex<Option<mpsc::Sender<PriceChangeEvent>>>>, // 🔥 Coordinator事件发送器
}

impl WebSocketClient {
    pub fn new(
        url: String,
        metrics: Arc<MetricsCollector>,
        proxy_config: Option<ProxyConfig>,
        price_cache: Arc<PriceCache>,
        error_tracker: Arc<ErrorTracker>,
        price_change_threshold: f64,
        rpc_url: Option<String>, // 🚀 新参数：用于主动查询vault
    ) -> Self {
        Self {
            url,
            metrics,
            pool_stats: Arc::new(PoolStatsCollector::new(price_change_threshold)), // 🔥 初始化池子统计收集器
            proxy_config,
            price_cache,
            error_tracker,
            subscription_map: Arc::new(Mutex::new(HashMap::new())),
            vault_pending_map: Arc::new(Mutex::new(HashMap::new())), // 🌐 初始化vault等待映射
            vault_subscription_map: Arc::new(Mutex::new(HashMap::new())), // 🌐 初始化vault订阅映射
            vault_reader: Arc::new(Mutex::new(VaultReader::new())), // 🌐 初始化 VaultReader
            pool_data_cache: Arc::new(Mutex::new(HashMap::new())), // 🌐 初始化池子数据缓存
            last_prices: Arc::new(DashMap::new()), // 🔥 初始化价格追踪（使用DashMap）
            price_change_threshold, // 🔥 设置价格变化阈值
            vault_subscription_tx: Arc::new(Mutex::new(None)), // 🌐 初始化为None，在连接时设置
            rpc_url, // 🚀 设置RPC URL
            coordinator_tx: Arc::new(Mutex::new(None)), // 🔥 Coordinator发送器初始化为None
        }
    }
    
    /// Set the coordinator sender (used to send price change events)
    pub fn set_coordinator_sender(&self, sender: mpsc::Sender<PriceChangeEvent>) {
        *self.coordinator_tx.lock().unwrap() = Some(sender);
        info!("(WebSocket) Coordinator sender registered");
    }

    /// Connect to the WebSocket server and start processing messages
    pub async fn run(&self, pools: Vec<PoolConfig>) -> Result<()> {
        loop {
            match self.connect_and_process(&pools).await {
                Ok(_) => {
                    println!("⚠️  WebSocket connection closed normally");
                }
                Err(e) => {
                    eprintln!("❌ WebSocket error: {}. Reconnecting in 5 seconds...", e);
                }
            }

            sleep(Duration::from_secs(5)).await;
        }
    }
    
    /// Process messages from an already-connected WebSocket stream
    /// This version is used when the connection is established in the main task
    pub async fn run_with_stream(
        &self,
        ws_stream: proxy::WsStream,
        pools: Vec<PoolConfig>,
    ) -> Result<()> {
        println!("📨 Starting message processing with pre-connected stream");
        
        loop {
            match self.process_stream(ws_stream, &pools).await {
                Ok(_) => {
                    println!("⚠️  WebSocket connection closed normally");
                    // Connection closed, try to reconnect
                    break;
                }
                Err(e) => {
                    eprintln!("❌ WebSocket error: {}. Reconnecting in 5 seconds...", e);
                    break;
                }
            }
        }
        
        // If we get here, connection was lost. Try to reconnect using the old method.
        println!("🔄 Connection lost, switching to auto-reconnect mode...");
        self.run(pools).await
    }
    
    async fn connect_and_process(&self, pools: &[PoolConfig]) -> Result<()> {
        println!("🔌 Connecting to WebSocket: {}", self.url);
        
        // Check if proxy is configured and enabled
        let ws_stream = if let Some(proxy_cfg) = &self.proxy_config {
            if proxy_cfg.enabled {
                println!("🌐 Using proxy: {}:{}", proxy_cfg.host, proxy_cfg.port);
                proxy::connect_via_proxy(&proxy_cfg.host, proxy_cfg.port, &self.url).await?
            } else {
                println!("🌐 Proxy disabled, connecting directly");
                proxy::connect_direct(&self.url).await?
            }
        } else {
            println!("🌐 No proxy configured, connecting directly");
            proxy::connect_direct(&self.url).await?
        };
        
        println!("✅ WebSocket connected successfully");
        
        // Delegate to process_stream
        self.process_stream(ws_stream, pools).await
    }
    
    /// Process messages from a connected WebSocket stream
    async fn process_stream(
        &self,
        ws_stream: proxy::WsStream,
        pools: &[PoolConfig],
    ) -> Result<()> {
        let (mut write, mut read) = ws_stream.split();
        
        // 🌐 创建动态订阅channel
        let (vault_tx, mut vault_rx) = mpsc::unbounded_channel::<SubscriptionRequest>();
        {
            let mut tx_lock = self.vault_subscription_tx.lock().unwrap();
            *tx_lock = Some(vault_tx);
        }
        
        // 订阅ID计数器（池子使用1-N，vault使用10000+）
        let mut next_subscription_id = pools.len() as u64 + 10000;
        
        // Subscribe to all pools
        for (idx, pool) in pools.iter().enumerate() {
            let subscribe_msg = json!({
                "jsonrpc": "2.0",
                "id": idx + 1,
                "method": "accountSubscribe",
                "params": [
                    pool.address,
                    {
                        "encoding": "base64",
                        "commitment": "confirmed"
                    }
                ]
            });
            
            write
                .send(Message::Text(subscribe_msg.to_string()))
                .await
                .context("Failed to send subscribe message")?;
            
            debug!("Subscribed to {} ({})", pool.name, pool.address);
        }
        
        info!("Waiting for pool updates from {} pools...", pools.len());
        info!("🌐 Dynamic vault subscription enabled");
        
        // 🔥 关键修复：立即主动查询所有池子状态，触发vault订阅
        // 不等待WebSocket更新（Phoenix冷门池子可能几分钟都没交易）
        if let Some(rpc_url) = &self.rpc_url {
            let rpc_client = Arc::new(RpcClient::new_with_timeout(
                rpc_url.clone(),
                Duration::from_secs(5)
            ));
            
            // 在后台异步执行，不阻塞WebSocket处理
            tokio::spawn({
                let self_clone = self.clone_for_proactive_fetch();
                let pools_clone = pools.to_vec();
                async move {
                    // 等待1秒让WebSocket订阅完全建立
                    sleep(Duration::from_millis(1000)).await;
                    
                    if let Err(e) = self_clone.proactively_trigger_vault_subscriptions(
                        &pools_clone,
                        rpc_client
                    ).await {
                        error!("Proactive vault subscription failed: {}", e);
                    }
                }
            });
        } else {
            warn!("No RPC URL provided, vault pools may take longer to activate");
        }
        
        // 🌐 使用select!同时处理WebSocket消息和动态订阅请求
        loop {
            tokio::select! {
                // 处理WebSocket消息
                message = read.next() => {
                    match message {
                        Some(Ok(Message::Text(text))) => {
                            if let Err(e) = self.handle_message(&text, pools).await {
                                eprintln!("⚠️  Error handling message: {}", e);
                            }
                        }
                        Some(Ok(Message::Close(_))) => {
                            println!("⚠️  Server closed the connection");
                            break;
                        }
                        Some(Err(e)) => {
                            eprintln!("❌ WebSocket error: {}", e);
                            break;
                        }
                        None => {
                            println!("⚠️  WebSocket stream ended");
                            break;
                        }
                        _ => {}
                    }
                }
                
                // 🌐 处理动态订阅请求
                Some(req) = vault_rx.recv() => {
                    match req {
                        SubscriptionRequest::VaultAccount { address, pool_name } => {
                            next_subscription_id += 1;
                            let request_id = next_subscription_id;
                            
                            // 记录到pending map（等待服务器确认）
                            {
                                let mut pending = self.vault_pending_map.lock().unwrap();
                                pending.insert(request_id, address.clone());
                            }
                            
                            let subscribe_msg = json!({
                                "jsonrpc": "2.0",
                                "id": request_id,
                                "method": "accountSubscribe",
                                "params": [
                                    address,
                                    {
                                        "encoding": "base64",
                                        "commitment": "confirmed"
                                    }
                                ]
                            });
                            
                            if let Err(e) = write.send(Message::Text(subscribe_msg.to_string())).await {
                                error!("Failed to subscribe to vault {}: {}", address, e);
                                // 订阅失败，从pending中移除
                                let mut pending = self.vault_pending_map.lock().unwrap();
                                pending.remove(&request_id);
                            } else {
                                info!("🌐 Subscribed to vault {} for pool {}", &address[0..8], pool_name);
                            }
                        }
                    }
                }
            }
        }
        
        // 清理channel
        {
            let mut tx_lock = self.vault_subscription_tx.lock().unwrap();
            *tx_lock = None;
        }
        
        Ok(())
    }
    
    async fn handle_message(&self, text: &str, pools: &[PoolConfig]) -> Result<()> {
        let start_time = Instant::now();
        
        let msg: serde_json::Value = serde_json::from_str(text)
            .context("Failed to parse JSON message")?;
        
        // Check if this is an account notification
        if msg.get("method").and_then(|m| m.as_str()) == Some("accountNotification") {
            self.handle_account_notification(&msg, start_time).await?;
        } else if msg.get("result").is_some() {
            // This is a subscription response
            let id = msg.get("id").and_then(|i| i.as_u64()).unwrap_or(0);
            let subscription_id = msg.get("result").and_then(|r| r.as_u64()).unwrap_or(0);
            
            // Map subscription_id to pool config (id is 1-indexed, pools is 0-indexed)
            if id > 0 && (id as usize) <= pools.len() {
                let pool_config = pools[(id - 1) as usize].clone();
                self.subscription_map.lock().unwrap().insert(subscription_id, pool_config.clone());
                
                // 🔥 Record pool subscription stats
                self.pool_stats.record_subscription(&pool_config.name, &pool_config.address);
                
                debug!("✅ Pool subscription confirmed: id={}, subscription_id={}, pool={}", 
                       id, subscription_id, pool_config.name);
            } else if id >= 10000 {
                // 🌐 这是vault账户订阅（ID >= 10000）
                // 从pending map中获取vault地址，转移到subscription map
                let vault_address = {
                    let mut pending = self.vault_pending_map.lock().unwrap();
                    pending.remove(&id)
                };
                
                if let Some(address) = vault_address {
                    self.vault_subscription_map.lock().unwrap().insert(subscription_id, address.clone());
                    info!("✅ Vault subscription confirmed: request_id={}, subscription_id={}, vault={}", 
                           id, subscription_id, &address[0..8]);
                } else {
                    warn!("Vault subscription confirmed but not found in pending map: id={}", id);
                }
            } else {
                debug!("Subscription confirmed: id={}, subscription_id={}", id, subscription_id);
            }
        }
        
        Ok(())
    }
    
    async fn handle_account_notification(
        &self,
        msg: &serde_json::Value,
        start_time: Instant,
    ) -> Result<()> {
        // Extract the base64-encoded account data
        let data_array = msg
            .pointer("/params/result/value/data")
            .and_then(|d| d.as_array())
            .context("Missing data field")?;
        
        let base64_data = data_array
            .get(0)
            .and_then(|d| d.as_str())
            .context("Missing base64 data")?;
        
        // Get subscription ID to find the correct pool
        let subscription_id = msg
            .pointer("/params/subscription")
            .and_then(|s| s.as_u64())
            .context("Missing subscription ID")?;

        // Decode base64 first (需要先解码来检查数据大小)
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(base64_data)
            .context("Failed to decode base64")?;

        let slot = msg
            .pointer("/params/result/context/slot")
            .and_then(|s| s.as_u64())
            .unwrap_or(0);

        // ✅ 调试日志：验证slot提取
        if slot == 0 {
            warn!(
                subscription_id = subscription_id,
                "⚠️ Received account notification with slot=0, data_len={}",
                decoded.len()
            );
        } else {
            debug!(
                subscription_id = subscription_id,
                slot = slot,
                "✅ Received account notification with valid slot"
            );
        }
        
        // 🌐 检查是否是 vault 账户更新（165 字节 = SPL Token Account）
        if decoded.len() == 165 {
            // 这是Token账户，从vault_subscription_map中查找vault地址
            let vault_address = {
                let vault_map = self.vault_subscription_map.lock().unwrap();
                vault_map.get(&subscription_id).cloned()
            };
            
            if let Some(address) = vault_address {
                // 找到了vault地址，更新vault余额（带上正确的slot）
                return self.handle_vault_update(&address, &decoded, slot).await;
            } else {
                // 不是我们订阅的vault，可能是其他Token账户
                debug!("Received 165-byte account update (not a registered vault), subscription_id={}", subscription_id);
                return Ok(());
            }
        }
        
        // 🔧 处理其他小尺寸账户（82字节等）- 这些是Solana网络的其他账户更新
        // 通常是: Program derived addresses, Metadata accounts, 或其他非池子账户
        if decoded.len() < 200 && decoded.len() != 165 {
            // 检查是否在我们的订阅映射中
            let is_known = {
                let map = self.subscription_map.lock().unwrap();
                map.contains_key(&subscription_id)
            } || {
                let vault_map = self.vault_subscription_map.lock().unwrap();
                vault_map.contains_key(&subscription_id)
            };
            
            if !is_known {
                // 不是我们订阅的账户，静默忽略（降低日志噪音）
                debug!("Ignoring small account update (unknown subscription): id={}, len={}", subscription_id, decoded.len());
                return Ok(());
            }
        }
        
        // 🔥 修复：先检查是否是vault订阅
        // 如果是vault，获取vault地址并处理
        let vault_address_opt = {
            let vault_map = self.vault_subscription_map.lock().unwrap();
            vault_map.get(&subscription_id).cloned()
        };
        
        if let Some(vault_address) = vault_address_opt {
            // 这是一个vault订阅的更新
            debug!("Received vault update: subscription_id={}, vault={}, len={}",
                subscription_id, vault_address, decoded.len());
            return self.handle_vault_update(&vault_address, &decoded, slot).await;
        }
        
        // 不是vault，查找pool配置
        let pool_config = {
            let map = self.subscription_map.lock().unwrap();
            map.get(&subscription_id).cloned()
        };
        
        let pool_config = match pool_config {
            Some(config) => config,
            None => {
                warn!("Received update for unknown subscription ID: {}, data_len={}", subscription_id, decoded.len());
                return Ok(());
            }
        };
        
        let pool_name = &pool_config.name;
        let pool_type_str = &pool_config.pool_type;
        let pool_address = &pool_config.address;
        
        // ========================================
        // New Trait-based Approach
        // ========================================
        
        // Try to create pool using factory
        let pool_result = if pool_type_str == "unknown" || pool_type_str.is_empty() {
            // Auto-detect pool type
            PoolFactory::create_pool_auto_detect(&decoded)
        } else {
            // Use specified pool type
            PoolFactory::create_pool(pool_type_str, &decoded)
        };
        
        match pool_result {
            Ok(pool) => {
                // Check if pool is active
                if !pool.is_active() {
                    // Silently skip inactive pools
                    return Ok(());
                }
                
                // 🌐 检查池子是否需要 vault 读取
                if let Some((vault_a, vault_b)) = pool.get_vault_addresses() {
                    // 🔥 关键修复：检查vault是否已注册，而不是检查池子是否在缓存中
                    // 这样即使池子在RPC初始化时已激活，也会触发vault订阅
                    let vault_a_str = vault_a.to_string();
                    let vault_b_str = vault_b.to_string();
                    
                    let vault_already_registered = {
                        let vault_reader = self.vault_reader.lock().unwrap();
                        vault_reader.is_vault_account(&vault_a_str) && vault_reader.is_vault_account(&vault_b_str)
                    };
                    
                    if !vault_already_registered {
                        // 首次处理，需要注册并订阅vault
                        let mut pool_cache = self.pool_data_cache.lock().unwrap();
                        pool_cache.insert(pool_address.clone(), decoded.clone());
                        drop(pool_cache);
                        
                        info!(
                            pool = %pool_name,
                            "Pool requires vault data, subscribing and waiting for vault updates..."
                        );
                        
                        // 注册 vault
                        let vault_a_str = vault_a.to_string();
                        let vault_b_str = vault_b.to_string();
                        
                        {
                            let mut vault_reader = self.vault_reader.lock().unwrap();
                            vault_reader.register_pool_vaults(
                                pool_address,
                                &vault_a_str,
                                &vault_b_str
                            );
                        }
                        
                        println!("🌐 [{}] Detected vault addresses:", pool_name);
                        println!("   ├─ Vault A: {}", vault_a_str);
                        println!("   └─ Vault B: {}", vault_b_str);
                        
                        // 🚀 发送动态订阅请求
                        if let Some(tx) = self.vault_subscription_tx.lock().unwrap().as_ref() {
                            // 订阅Vault A
                            if let Err(e) = tx.send(SubscriptionRequest::VaultAccount {
                                address: vault_a_str.clone(),
                                pool_name: pool_name.to_string(),
                            }) {
                                error!("Failed to send vault A subscription request: {}", e);
                            }
                            
                            // 订阅Vault B
                            if let Err(e) = tx.send(SubscriptionRequest::VaultAccount {
                                address: vault_b_str.clone(),
                                pool_name: pool_name.to_string(),
                            }) {
                                error!("Failed to send vault B subscription request: {}", e);
                            }
                            
                            println!("   ✅ Vault subscription requests sent!");
                        } else {
                            warn!("Vault subscription channel not available");
                        }
                        
                    // 🔥 关键修复：不再阻塞等待vault数据
                    // 让池子先激活，vault数据到达后会自动更新价格
                    info!(pool = %pool_name, "Vault subscribed, pool will activate with initial data");
                    // 注意：不再return，继续处理池子
                    }
                }
                
                // Use unified update method
                self.update_cache_from_pool(pool.as_ref(), &pool_config, pool_name, slot, start_time);
            }
            Err(e) => {
                // Record error with deduplication
                let error_key = format!("{}_{}", pool_type_str, "deserialize_failed");
                let error_msg = format!("{}: {}, Expected vs Actual size issue", pool_name, e);
                
                self.error_tracker.record_error(&error_key, error_msg).await;
                
                error!(
                    pool = %pool_name,
                    pool_type = %pool_type_str,
                    data_len = decoded.len(),
                    error = %e,
                    "Failed to deserialize pool"
                );
            }
        }
        
        Ok(())
    }
    
    /// Clone necessary fields for proactive vault fetching in spawned task
    fn clone_for_proactive_fetch(&self) -> Self {
        Self {
            url: self.url.clone(),
            metrics: self.metrics.clone(),
            pool_stats: self.pool_stats.clone(), // 🔥 Clone pool stats collector
            proxy_config: self.proxy_config.clone(),
            price_cache: self.price_cache.clone(),
            error_tracker: self.error_tracker.clone(),
            subscription_map: self.subscription_map.clone(),
            vault_pending_map: self.vault_pending_map.clone(),
            vault_subscription_map: self.vault_subscription_map.clone(),
            vault_reader: self.vault_reader.clone(),
            pool_data_cache: self.pool_data_cache.clone(),
            last_prices: self.last_prices.clone(),
            price_change_threshold: self.price_change_threshold,
            vault_subscription_tx: self.vault_subscription_tx.clone(),
            rpc_url: self.rpc_url.clone(),
            coordinator_tx: self.coordinator_tx.clone(),
        }
    }
    
    /// 🚀 主动通过RPC查询池子并触发vault检测
    /// 解决Phoenix CLOB等冷门池子长时间无WebSocket更新的问题
    /// 🔥 使用并行查询架构，避免串行阻塞
    async fn proactively_trigger_vault_subscriptions(
        &self,
        pools: &[PoolConfig],
        rpc_client: Arc<RpcClient>,
    ) -> Result<()> {
        info!("🚀 Proactively fetching pool states to trigger vault subscriptions...");
        
        // 收集所有需要查询的池子（Phoenix、SolFi、Raydium CLMM、Orca Whirlpool）
        let target_pools: Vec<_> = pools.iter()
            .filter(|pool| {
                let pool_type_lower = pool.pool_type.to_lowercase();
                pool_type_lower.contains("phoenix") 
                    || pool_type_lower.contains("solfi")
                    || pool_type_lower.contains("clmm")
                    || pool_type_lower.contains("whirlpool")
            })
            .collect();
        
        info!("📋 Found {} vault-dependent pools to query", target_pools.len());
        
        // 🚀 并行发起所有RPC查询
        let futures: Vec<_> = target_pools.iter().map(|pool_config| {
            let rpc_clone = rpc_client.clone();
            let pool_name = pool_config.name.clone();
            let pool_address = pool_config.address.clone();
            let pool_type = pool_config.pool_type.clone();
            let address_str = pool_config.address.clone();
            
            async move {
                // 解析池子地址
                let pubkey = match Pubkey::from_str(&address_str) {
                    Ok(pk) => pk,
                    Err(e) => {
                        warn!("❌ Invalid pubkey for {}: {}", pool_name, e);
                        return None;
                    }
                };
                
                // 🔥 使用spawn_blocking避免阻塞Tokio运行时
                let account_result = tokio::task::spawn_blocking(move || {
                    rpc_clone.get_account(&pubkey)
                }).await;
                
                match account_result {
                    Ok(Ok(account)) => {
                        Some((pool_name, pool_address, pool_type, account.data))
                    }
                    Ok(Err(e)) => {
                        warn!("❌ RPC error fetching {}: {}", pool_name, e);
                        None
                    }
                    Err(e) => {
                        error!("❌ Task error fetching {}: {}", pool_name, e);
                        None
                    }
                }
            }
        }).collect();
        
        // 等待所有查询完成
        let results = join_all(futures).await;
        
        // 统计并处理结果
        let mut fetched_count = 0;
        let mut vault_triggered_count = 0;
        
        for result in results.into_iter().flatten() {
            let (pool_name, pool_address, pool_type, data) = result;
            fetched_count += 1;
            
            // 解析池子数据，触发vault检测
            match PoolFactory::create_pool(&pool_type, &data) {
                Ok(pool) => {
                    if let Some((vault_a, vault_b)) = pool.get_vault_addresses() {
                        let vault_a_str = vault_a.to_string();
                        let vault_b_str = vault_b.to_string();
                        
                        // 检查vault是否已注册
                        let vault_already_registered = {
                            let vault_reader = self.vault_reader.lock().unwrap();
                            vault_reader.is_vault_account(&vault_a_str) && 
                            vault_reader.is_vault_account(&vault_b_str)
                        };
                        
                        if !vault_already_registered {
                            // 注册vault
                            {
                                let mut vault_reader = self.vault_reader.lock().unwrap();
                                vault_reader.register_pool_vaults(
                                    &pool_address,
                                    &vault_a_str,
                                    &vault_b_str
                                );
                            }
                            
                            info!("🌐 Proactively detected vaults for {}: {}, {}", 
                                  pool_name, &vault_a_str[0..8], &vault_b_str[0..8]);
                            
                            // 发送订阅请求
                            if let Some(tx) = self.vault_subscription_tx.lock().unwrap().as_ref() {
                                let _ = tx.send(SubscriptionRequest::VaultAccount {
                                    address: vault_a_str.clone(),
                                    pool_name: pool_name.clone(),
                                });
                                let _ = tx.send(SubscriptionRequest::VaultAccount {
                                    address: vault_b_str.clone(),
                                    pool_name: pool_name.clone(),
                                });
                                
                                vault_triggered_count += 1;
                            }
                        } else {
                            info!("✓ Vaults already registered for {}, fetching initial balances...", pool_name);
                        }
                        
                        // 🔥 关键修复：无论vault是否已注册，都查询初始余额
                        // 这确保即使vault在RPC阶段已注册，也能获得初始数据
                        // ✅ 修复：获取当前slot并传递给价格重新计算
                        let current_slot = match rpc_client.get_slot() {
                            Ok(slot) => slot,
                            Err(e) => {
                                warn!("Failed to get current slot: {}, using 0", e);
                                0
                            }
                        };

                        self.fetch_and_update_vault_balances(
                            &rpc_client,
                            &vault_a,
                            &vault_b,
                            &pool_address,
                            &pool_name,
                            current_slot,
                        ).await;
                    }
                }
                Err(e) => {
                    warn!("❌ Failed to parse {}: {}", pool_name, e);
                }
            }
        }
        
        info!("✅ Proactive fetch completed: {} pools fetched, {} vault subscriptions triggered", 
              fetched_count, vault_triggered_count);
        
        Ok(())
    }
    
    /// 🔥 新增：批量查询vault余额并更新
    async fn fetch_and_update_vault_balances(
        &self,
        rpc_client: &Arc<RpcClient>,
        vault_a: &Pubkey,
        vault_b: &Pubkey,
        pool_address: &str,
        pool_name: &str,
        slot: u64,  // ✅ 修复：接收 slot 参数
    ) {
        // 并行查询两个vault
        let rpc_a = rpc_client.clone();
        let rpc_b = rpc_client.clone();
        let vault_a_clone = *vault_a;
        let vault_b_clone = *vault_b;

        info!("🔍 Fetching vault balances for {} via RPC...", pool_name);

        let (result_a, result_b) = tokio::join!(
            tokio::task::spawn_blocking(move || rpc_a.get_account(&vault_a_clone)),
            tokio::task::spawn_blocking(move || rpc_b.get_account(&vault_b_clone))
        );

        // 处理vault A
        match result_a {
            Ok(Ok(account_a)) => {
                let vault_a_str = vault_a.to_string();

                // 更新VaultReader（传递原始数据）
                let amount_result = {
                    let mut vault_reader = self.vault_reader.lock().unwrap();
                    vault_reader.update_vault(&vault_a_str, &account_a.data)
                };

                match amount_result {
                    Ok(amount) => {
                        info!("💰 Fetched initial balance for vault A of {}: {}", pool_name, amount);
                    }
                    Err(e) => {
                        warn!("❌ Failed to update vault A balance for {}: {}", pool_name, e);
                    }
                }
            }
            Ok(Err(e)) => {
                warn!("❌ RPC error fetching vault A for {}: {}", pool_name, e);
            }
            Err(e) => {
                warn!("❌ Task error fetching vault A for {}: {}", pool_name, e);
            }
        }

        // 处理vault B
        match result_b {
            Ok(Ok(account_b)) => {
                let vault_b_str = vault_b.to_string();

                // 更新VaultReader（传递原始数据）
                let amount_result = {
                    let mut vault_reader = self.vault_reader.lock().unwrap();
                    vault_reader.update_vault(&vault_b_str, &account_b.data)
                };

                match amount_result {
                    Ok(amount) => {
                        info!("💰 Fetched initial balance for vault B of {}: {}", pool_name, amount);
                    }
                    Err(e) => {
                        warn!("❌ Failed to update vault B balance for {}: {}", pool_name, e);
                    }
                }
            }
            Ok(Err(e)) => {
                warn!("❌ RPC error fetching vault B for {}: {}", pool_name, e);
            }
            Err(e) => {
                warn!("❌ Task error fetching vault B for {}: {}", pool_name, e);
            }
        }

        // 🔥 触发价格重新计算（带正确的slot）
        // ✅ 修复：传递 slot 参数而不是使用硬编码的0
        self.trigger_pool_price_recalculation(pool_address, pool_name, slot).await;
    }
    
    /// 🔥 新增：触发池子价格重新计算
    async fn trigger_pool_price_recalculation(&self, pool_address: &str, pool_name: &str, slot: u64) {
        // 获取池子配置和数据
        let (pool_config, pool_data) = {
            let subscription_map = self.subscription_map.lock().unwrap();
            let cache = self.pool_data_cache.lock().unwrap();

            let config = subscription_map.values()
                .find(|p| p.address == pool_address)
                .cloned();
            let data = cache.get(pool_address).cloned();

            (config, data)
        };

        if let (Some(config), Some(data)) = (pool_config, pool_data) {
            // 解析池子并重新计算价格
            if let Ok(pool) = PoolFactory::create_pool(&config.pool_type, &data) {
                let start_time = std::time::Instant::now();
                // ✅ 修复：传递正确的slot而不是硬编码为0
                self.update_cache_from_pool(pool.as_ref(), &config, pool_name, slot, start_time);
                info!("🔄 Recalculated price for {} after fetching vault balances (slot={})", pool_name, slot);
            }
        }
    }
    
    /// 🌐 处理 vault 账户更新
    async fn handle_vault_update(
        &self,
        vault_address: &str,
        data: &[u8],
        slot: u64,  // ✅ 修复：添加slot参数
    ) -> Result<()> {
        // 检查是否是已注册的 vault
        let is_vault = {
            let vault_reader = self.vault_reader.lock().unwrap();
            vault_reader.is_vault_account(vault_address)
        };
        
        if !is_vault {
            // 不是 vault 账户，忽略
            return Ok(());
        }
        
        // 🔍 Log vault data length for debugging Token-2022 issues
        debug!(
            vault = %vault_address,
            data_len = data.len(),
            slot = slot,
            "Received vault update"
        );
        
        // 🔥 关键修复：分离锁的作用域，避免死锁
        // 在同一个作用域内获取所有需要的数据，然后立即释放锁
        let (amount_result, pool_addresses) = {
            let mut vault_reader = self.vault_reader.lock().unwrap();
            // 更新vault余额
            let amount = vault_reader.update_vault(vault_address, data);
            // 获取使用此vault的池子列表
            let pools = if amount.is_ok() {
                vault_reader.get_pools_for_vault(vault_address)
            } else {
                Vec::new()
            };
            (amount, pools)
        }; // MutexGuard在这里被drop，锁已释放
        
        // 处理结果（此时已不持有任何锁）
        match amount_result {
            Ok(amount) => {
                debug!(vault = %vault_address, amount = %amount, "Vault balance updated");
                
                // 🚨 Critical fix: Trigger price recalculation for related pools
                // 一次性获取所有需要的数据（避免嵌套锁）
                let configs_and_data: Vec<_> = {
                        let subscription_map = self.subscription_map.lock().unwrap();
                    let cache = self.pool_data_cache.lock().unwrap();
                    
                    pool_addresses.into_iter()
                        .filter_map(|pool_addr| {
                            let config = subscription_map.values()
                            .find(|p| p.address == pool_addr)
                                .cloned()?;
                            let data = cache.get(&pool_addr).cloned()?;
                            Some((config, data))
                        })
                        .collect()
                        };
                        
                // 安全处理（不持有任何锁）
                for (config, data) in configs_and_data {
                    info!(pool = %config.name, "Recalculating price after vault update (slot={})", slot);

                    // 🔥 Record vault update stats
                    self.pool_stats.record_vault_update(&config.name);

                    if let Ok(pool) = PoolFactory::create_pool(&config.pool_type, &data) {
                        let start_time = Instant::now();
                        // ✅ 修复：传递正确的slot
                        self.update_cache_from_pool(pool.as_ref(), &config, &config.name, slot, start_time);
                    }
                }
            }
            Err(e) => {
                warn!(vault = %vault_address, error = %e, "Failed to update vault");
            }
        }
        
        Ok(())
    }
    
    /// Unified method to update cache from any DexPool implementation
    /// 
    /// This eliminates code duplication across different DEX types
    fn update_cache_from_pool(
        &self,
        pool: &dyn DexPool,
        pool_config: &PoolConfig,
        pool_name: &str,
        slot: u64,
        start_time: Instant,
    ) {
        let latency = start_time.elapsed();
        let latency_micros = latency.as_micros() as u64;
        
        // 🌐 获取储备量（优先从 VaultReader 读取）
        let (base_reserve, quote_reserve) = {
            let vault_reader = self.vault_reader.lock().unwrap();
            if let Some(reserves) = vault_reader.get_pool_reserves(&pool_config.address) {
                // 从 vault 读取实际储备量
                reserves
            } else {
                // 从池子账户直接读取
                pool.get_reserves()
            }
        };
        
        // 优先使用 DexPool 自带的价格计算（Phoenix等CLOB依赖该值）
        let mut price = pool.calculate_price();

        if price == 0.0 {
            // Fallback: 使用储备计算（适用于AMM/CLMM）
            if base_reserve > 0 && quote_reserve > 0 {
                let (base_decimals, quote_decimals) = pool.get_decimals();
                let base_f64 = base_reserve as f64 / 10f64.powi(base_decimals as i32);
                let quote_f64 = quote_reserve as f64 / 10f64.powi(quote_decimals as i32);
                // 🚨 Critical fix: Prevent division by zero
                if base_f64 > 0.0 {
                    price = quote_f64 / base_f64;
                }
            }
        }
        
        let (base_decimals, quote_decimals) = pool.get_decimals();
        let dex_name = pool.dex_name();
        
        // 🚨 Critical fix: Handle zero price for vault-based pools
        if price == 0.0 {
            // 检查是否是vault-based池子（SolFi V2, GoonFi等）或CLMM池子
            let is_vault_based = pool.get_vault_addresses().is_some();
            let is_clmm = dex_name.contains("CLMM") || dex_name.contains("Concentrated");
            
            if is_vault_based || is_clmm {
                // Vault池子或CLMM池子允许以price=0激活，等待后续数据
                debug!(pool = %pool_name, dex = %dex_name, 
                    "Pool with price=0 (vault-based={}, clmm={}), will update after data arrives", 
                    is_vault_based, is_clmm);
                // 不return，继续执行更新缓存逻辑
            } else {
                // 非vault/非CLMM池子的price=0是错误，跳过
                debug!(pool = %pool_name, "Skipping non-vault pool with zero price");
            return;
        }
        }
        
        // Calculate human-readable reserves
        let base_reserve_readable = base_reserve as f64 / 10f64.powi(base_decimals as i32);
        let quote_reserve_readable = quote_reserve as f64 / 10f64.powi(quote_decimals as i32);
        
        // Record metrics
        self.metrics.record(pool_name.to_string(), latency_micros);
        
        // 🔥 Record pool stats - price update
        self.pool_stats.record_price_update(pool_name, price);
        
        // Update price cache
        let pool_price = PoolPrice {
            pool_id: pool_config.address.clone(),
            dex_name: dex_name.to_string(),
            pair: pool_name.to_string(),
            base_reserve,
            quote_reserve,
            base_decimals,
            quote_decimals,
            price,
            last_update: Instant::now(),
            slot,  // 🎯 记录slot用于数据一致性
        };

        self.price_cache.update_price(pool_price);

        // 🔥 Send price change event to Coordinator
        // Calculate price change percentage
        let price_change_percent = if let Some(entry) = self.last_prices.get(pool_name) {
            let last_price = *entry.value();

            if last_price == 0.0 || price == 0.0 {
                // Handle zero price case
                if last_price != price {
                    1.0 // 100% change (or -100%) for logging/signaling
                } else {
                    0.0
                }
            } else {
                let change = ((price - last_price) / last_price * 100.0).abs();
                if change.is_finite() {
                    change / 100.0 // Convert to decimal (e.g., 0.15% -> 0.0015)
                } else {
                    0.0
                }
            }
        } else {
            0.01 // First update - treat as 1% change to trigger Coordinator
        };

        // Send to Coordinator if sender is registered
        if let Some(tx) = self.coordinator_tx.lock().unwrap().as_ref() {
            let event = PriceChangeEvent {
                pool_id: pool_config.address.clone(),
                pool_name: pool_name.to_string(),
                pair: pool_name.to_string(), // Assuming pool_name is like "SOL/USDC"
                price_change_percent,
                old_price: if price_change_percent > 0.0 { Some(self.last_prices.get(pool_name).map_or(0.0, |v| *v.value())) } else { None },
                new_price: price,
                timestamp: Instant::now(),
            };

            // Use try_send to avoid blocking
            match tx.try_send(event) {
                Ok(_) => debug!(pool = %pool_name, "Price change event sent to Coordinator"),
                Err(e) => warn!(pool = %pool_name, error = %e, "Failed to send event to Coordinator (channel full)"),
            }
        }

        // 🔥 Check price change and only log if significant
        let should_log = {
            let price_changed = if let Some(entry) = self.last_prices.get(pool_name) {
                let last_price = *entry.value();
                
                // 🚨 修复：如果last_price=0或price=0，特殊处理避免除以0
                if last_price == 0.0 || price == 0.0 {
                    // 从0更新到非0价格，或从非0到0，都视为显著变化
                    last_price != price
                } else {
                    // 正常情况：计算价格变化百分比
                let change_pct = ((price - last_price) / last_price * 100.0).abs();
                    
                if !change_pct.is_finite() {
                    warn!(pool = %pool_name, price, last_price, 
                              "Invalid price change (NaN/Infinity)");
                        return;
                }
                    
                change_pct >= self.price_change_threshold
                }
            } else {
                true  // 首次更新，总是记录
            };
            
            if price_changed {
                self.last_prices.insert(pool_name.to_string(), price);
            }
            
            price_changed
        };
        
        if should_log {
            info!(
                pool = %pool_name,
                dex = %dex_name,
                price = %price,
                base_reserve = %base_reserve_readable,
                quote_reserve = %quote_reserve_readable,
                latency_us = latency_micros,
                slot = slot,
                "Pool price updated (significant change)"
            );
        } else {
            debug!(
                pool = %pool_name,
                price = %price,
                latency_us = latency_micros,
                "Pool price updated (minor change)"
            );
        }
    }
    
    /// 🔥 Get pool stats collector for external access
    pub fn pool_stats(&self) -> Arc<PoolStatsCollector> {
        Arc::clone(&self.pool_stats)
    }
}

