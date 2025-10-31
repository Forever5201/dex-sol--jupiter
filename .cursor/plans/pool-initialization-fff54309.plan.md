<!-- fff54309-aeeb-4a36-8bf6-fcef84c07279 8097f15d-086a-49bd-97a1-36a8b2e885be -->
# 池子初始化RPC查询方案

## 实施策略

基于Helius文档确认的信息：

- 免费版限速：10 req/s
- getMultipleAccounts最多100个账户/次
- 27个池子只需1次批量调用
- 使用两个API key轮询避免限速

## 文件修改

### 1. 配置文件 (config.toml)

添加初始化RPC配置段：

```toml
# ============================================
# 池子初始化配置
# ============================================
[initialization]
# 是否启用启动时主动查询池子
enabled = true

# RPC URLs（支持多个，轮询使用）
rpc_urls = [
  "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683",
  "https://mainnet.helius-rpc.com/?api-key=<第二个KEY>"  # 用户需填写
]

# 批量查询大小（最大100）
batch_size = 27

# 查询超时（毫秒）
timeout_ms = 5000

# 失败重试次数
max_retries = 3
```

### 2. 配置结构 (src/config.rs)

在Config结构体中添加：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    // ... existing fields
    #[serde(default)]
    pub initialization: Option<InitializationConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializationConfig {
    #[serde(default = "default_init_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub rpc_urls: Vec<String>,
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_max_retries")]
    pub max_retries: usize,
}

fn default_init_enabled() -> bool { true }
fn default_batch_size() -> usize { 100 }
fn default_timeout_ms() -> u64 { 5000 }
fn default_max_retries() -> usize { 3 }
```

### 3. 新建初始化模块 (src/pool_initializer.rs)

创建负责批量查询的模块：

```rust
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn, debug};

pub struct PoolInitializer {
    rpc_clients: Vec<RpcClient>,
    current_index: std::sync::atomic::AtomicUsize,
}

impl PoolInitializer {
    pub fn new(rpc_urls: Vec<String>, timeout_ms: u64) -> Self {
        let rpc_clients = rpc_urls.iter().map(|url| {
            RpcClient::new_with_timeout(
                url.clone(), 
                Duration::from_millis(timeout_ms)
            )
        }).collect();
        
        Self {
            rpc_clients,
            current_index: std::sync::atomic::AtomicUsize::new(0),
        }
    }
    
    // 轮询获取RPC客户端（负载均衡）
    fn get_next_client(&self) -> &RpcClient {
        let index = self.current_index.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        &self.rpc_clients[index % self.rpc_clients.len()]
    }
    
    // 批量查询池子账户
    pub async fn fetch_pool_accounts(
        &self,
        pool_addresses: &[String],
        max_retries: usize,
    ) -> Result<Vec<Option<Vec<u8>>>, anyhow::Error> {
        // 转换地址
        let pubkeys: Vec<Pubkey> = pool_addresses
            .iter()
            .filter_map(|addr| Pubkey::from_str(addr).ok())
            .collect();
        
        info!("🔍 Fetching {} pool accounts via RPC...", pubkeys.len());
        
        // 重试逻辑
        for attempt in 0..=max_retries {
            let client = self.get_next_client();
            
            match client.get_multiple_accounts(&pubkeys) {
                Ok(accounts) => {
                    let valid_count = accounts.iter().filter(|a| a.is_some()).count();
                    info!("✅ Fetched {}/{} valid pool accounts", valid_count, pubkeys.len());
                    
                    // 提取account data
                    let data: Vec<Option<Vec<u8>>> = accounts
                        .into_iter()
                        .map(|acc| acc.map(|a| a.data))
                        .collect();
                    
                    return Ok(data);
                }
                Err(e) => {
                    warn!("⚠️  RPC query failed (attempt {}/{}): {}", attempt + 1, max_retries + 1, e);
                    if attempt < max_retries {
                        tokio::time::sleep(Duration::from_millis(100 * (attempt as u64 + 1))).await;
                    }
                }
            }
        }
        
        Err(anyhow::anyhow!("Failed to fetch pool accounts after {} attempts", max_retries + 1))
    }
}
```

### 4. 主程序集成 (src/main.rs)

在WebSocket连接之前插入初始化逻辑：

```rust
// 在 line 78 (Initialize price cache) 之后添加：

// 🚀 Initialize pools proactively (if enabled)
if let Some(init_config) = &config.initialization {
    if init_config.enabled && !init_config.rpc_urls.is_empty() {
        println!("🚀 Initializing pools via RPC batch query...");
        
        let initializer = pool_initializer::PoolInitializer::new(
            init_config.rpc_urls.clone(),
            init_config.timeout_ms,
        );
        
        let pool_addresses: Vec<String> = config.pools()
            .iter()
            .map(|p| p.address.clone())
            .collect();
        
        match initializer.fetch_pool_accounts(&pool_addresses, init_config.max_retries).await {
            Ok(accounts_data) => {
                let mut activated = 0;
                
                for (idx, account_data) in accounts_data.iter().enumerate() {
                    if let Some(data) = account_data {
                        let pool_config = &config.pools()[idx];
                        
                        // 尝试解析并激活池子
                        if let Ok(pool) = pool_factory::PoolFactory::create_pool(
                            &pool_config.pool_type,
                            data,
                        ) {
                            if pool.is_active() {
                                // 添加到价格缓存
                                let (base_reserve, quote_reserve) = pool.get_reserves();
                                let price = pool.calculate_price();
                                let (base_decimals, quote_decimals) = pool.get_decimals();
                                
                                price_cache.update_price(price_cache::PoolPrice {
                                    pool_id: pool_config.address.clone(),
                                    dex_name: pool.dex_name().to_string(),
                                    pair: pool_config.name.clone(),
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
                            }
                        }
                    }
                }
                
                println!("✅ Initialized {}/{} pools successfully\n", activated, pool_addresses.len());
            }
            Err(e) => {
                warn!("⚠️  Pool initialization failed: {}, continuing with WebSocket only", e);
            }
        }
    }
}
```

### 5. 模块声明 (src/lib.rs 或 src/main.rs)

添加：

```rust
mod pool_initializer;
```

## 实施效果

- 启动后立即查询27个池子（1次RPC调用，<1秒）
- 使用两个API key轮询，避免限速
- 预期激活15-20个池子（无需等待交易触发）
- 降低对WebSocket推送的依赖
- 剩余7-12个池子等待WebSocket推送

## 风险控制

1. 如果第二个API key未配置，仅使用第一个
2. 如果RPC调用失败，自动降级到纯WebSocket模式
3. 重试机制处理临时网络问题
4. 超时设置避免启动阻塞