use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub websocket: WebSocketConfig,
    pub proxy: Option<ProxyConfig>,
    #[serde(default)]
    pub database: Option<DatabaseConfig>,
    pub pools: Vec<PoolConfig>,
    #[serde(default)]
    pub router: Option<RouterConfig>,
    #[serde(default)]
    pub logging: Option<LogConfig>,
    #[serde(default)]
    pub simulation: Option<SimulationConfig>,  // 🎯 链上模拟配置
    #[serde(default)]
    pub initialization: Option<InitializationConfig>,  // 🚀 池子初始化配置
    #[serde(default)]
    pub lst_detector: Option<LstDetectorConfig>,  // 🔥 LST检测器配置
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSocketConfig {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub url: String,
    #[serde(default = "default_true")]
    pub record_opportunities: bool,
    #[serde(default)]
    pub record_pool_updates: bool,
    #[serde(default = "default_true")]
    pub record_performance: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolConfig {
    pub address: String,
    pub name: String,
    #[serde(default = "default_pool_type")]
    pub pool_type: String,
}

fn default_pool_type() -> String {
    "amm_v4".to_string()
}

/// Logging configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogConfig {
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default = "default_true")]
    pub file_enabled: bool,
    #[serde(default = "default_price_change_threshold")]
    pub price_change_threshold_percent: f64,
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_price_change_threshold() -> f64 {
    1.0  // 1% price change threshold
}

/// Router configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouterConfig {
    #[serde(default = "default_router_mode")]
    pub mode: String,
    #[serde(default = "default_min_roi")]
    pub min_roi_percent: f64,
    #[serde(default = "default_max_hops")]
    pub max_hops: usize,
    #[serde(default = "default_enable_split")]
    pub enable_split_optimization: bool,
    #[serde(default)]
    pub bellman_ford: Option<BellmanFordConfig>,
    #[serde(default)]
    pub split_optimizer: Option<SplitOptimizerConfig>,
    #[serde(default)]
    pub event_driven: Option<EventDrivenConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BellmanFordConfig {
    #[serde(default = "default_max_iterations")]
    pub max_iterations: usize,
    #[serde(default = "default_convergence")]
    pub convergence_threshold: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitOptimizerConfig {
    #[serde(default = "default_max_splits")]
    pub max_splits: usize,
    #[serde(default = "default_min_split_amount")]
    pub min_split_amount: f64,
    #[serde(default = "default_slippage_model")]
    pub slippage_model: String,
}

fn default_router_mode() -> String {
    "complete".to_string()
}

fn default_min_roi() -> f64 {
    0.3
}

fn default_max_hops() -> usize {
    6
}

fn default_enable_split() -> bool {
    true
}

fn default_max_iterations() -> usize {
    10
}

fn default_convergence() -> f64 {
    0.0001
}

fn default_max_splits() -> usize {
    5
}

fn default_min_split_amount() -> f64 {
    100.0
}

fn default_slippage_model() -> String {
    "constant_product".to_string()
}

/// Event-driven router configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventDrivenConfig {
    #[serde(default = "default_event_driven_enabled")]
    pub enabled: bool,
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u64,
    #[serde(default = "default_price_change_threshold_percent")]
    pub price_change_threshold_percent: f64,
    #[serde(default = "default_validation_strategy")]
    pub validation_strategy: String,
    #[serde(default = "default_max_concurrent_scans")]
    pub max_concurrent_scans: usize,
}

fn default_event_driven_enabled() -> bool {
    true
}

fn default_debounce_ms() -> u64 {
    100
}

fn default_price_change_threshold_percent() -> f64 {
    0.5
}

fn default_validation_strategy() -> String {
    "immediate".to_string()
}

fn default_max_concurrent_scans() -> usize {
    3
}

/// 🎯 链上模拟配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationConfig {
    /// 是否启用链上模拟验证
    #[serde(default)]
    pub enabled: bool,
    /// RPC URL（用于链上查询）
    #[serde(default)]
    pub rpc_url: Option<String>,
    /// 最小置信度才触发模拟
    #[serde(default = "default_min_confidence")]
    pub min_confidence_for_simulation: f64,
    /// 最大并发模拟数
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent_simulations: usize,
    /// 模拟超时（毫秒）
    #[serde(default = "default_simulation_timeout")]
    pub simulation_timeout_ms: u64,
}

fn default_min_confidence() -> f64 {
    80.0
}

fn default_max_concurrent() -> usize {
    10
}

fn default_simulation_timeout() -> u64 {
    500
}

/// 🚀 池子初始化配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializationConfig {
    /// 是否启用启动时主动查询池子
    #[serde(default = "default_init_enabled")]
    pub enabled: bool,
    /// RPC URLs（支持多个，轮询使用）
    #[serde(default)]
    pub rpc_urls: Vec<String>,
    /// 批量查询大小（最大100）
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
    /// 查询超时（毫秒）
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    /// 失败重试次数
    #[serde(default = "default_max_retries")]
    pub max_retries: usize,
}

fn default_init_enabled() -> bool {
    true
}

fn default_batch_size() -> usize {
    100
}

fn default_timeout_ms() -> u64 {
    5000
}

fn default_max_retries() -> usize {
    3
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum PoolType {
    AmmV4,
    Clmm,
    Whirlpool,
    LifinityV2,
    Unknown,
}

impl PoolType {
    #[allow(dead_code)]
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "amm_v4" | "ammv4" | "raydium_v4" | "raydiumv4" => PoolType::AmmV4,
            "clmm" | "raydium_clmm" | "raydiumclmm" => PoolType::Clmm,
            "whirlpool" | "orca_whirlpool" | "orcawhirlpool" => PoolType::Whirlpool,
            "lifinity_v2" | "lifinityv2" | "lifinity" => PoolType::LifinityV2,
            _ => PoolType::Unknown,
        }
    }
    
    #[allow(dead_code)]
    pub fn as_str(&self) -> &'static str {
        match self {
            PoolType::AmmV4 => "Raydium AMM V4",
            PoolType::Clmm => "Raydium CLMM",
            PoolType::Whirlpool => "Orca Whirlpool",
            PoolType::LifinityV2 => "Lifinity V2",
            PoolType::Unknown => "Unknown",
        }
    }
}

/// LST Detector configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LstDetectorConfig {
    #[serde(default = "default_lst_enabled")]
    pub enabled: bool,
    #[serde(default = "default_min_discount")]
    pub min_discount_percent: f64,
    #[serde(default = "default_stake_pool_update_interval")]
    pub stake_pool_update_interval: u64,
    #[serde(default = "default_enable_triangle")]
    pub enable_triangle_arbitrage: bool,
    #[serde(default = "default_enable_multi_lst")]
    pub enable_multi_lst_arbitrage: bool,
    #[serde(default = "default_enable_redemption")]
    pub enable_redemption_path: bool,
    #[serde(default)]
    pub marinade: Option<MarinadeConfig>,
    #[serde(default)]
    pub jito: Option<JitoConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarinadeConfig {
    pub state_address: String,
    #[serde(default = "default_marinade_unstake_fee")]
    pub unstake_fee: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JitoConfig {
    pub stake_pool_address: String,
    #[serde(default = "default_jito_unstake_fee")]
    pub unstake_fee: f64,
}

fn default_lst_enabled() -> bool {
    true
}

fn default_min_discount() -> f64 {
    0.3
}

fn default_stake_pool_update_interval() -> u64 {
    300 // 5 minutes
}

fn default_enable_triangle() -> bool {
    true
}

fn default_enable_multi_lst() -> bool {
    true
}

fn default_enable_redemption() -> bool {
    true
}

fn default_marinade_unstake_fee() -> f64 {
    0.003
}

fn default_jito_unstake_fee() -> f64 {
    0.001
}

impl Config {
    /// Load configuration from a TOML file
    pub fn load_from_file(path: &str) -> Result<Self> {
        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {}", path))?;
        
        let config: Config = toml::from_str(&content)
            .with_context(|| "Failed to parse config TOML")?;
        
        // Validate configuration
        if config.websocket.url.is_empty() {
            anyhow::bail!("WebSocket URL cannot be empty");
        }
        
        if config.pools.is_empty() {
            anyhow::bail!("At least one pool must be configured");
        }
        
        for pool in &config.pools {
            if pool.address.is_empty() {
                anyhow::bail!("Pool address cannot be empty");
            }
            if pool.name.is_empty() {
                anyhow::bail!("Pool name cannot be empty");
            }
        }
        
        Ok(config)
    }
    
    /// Get the WebSocket URL
    pub fn websocket_url(&self) -> &str {
        &self.websocket.url
    }
    
    /// Get all pool configurations
    pub fn pools(&self) -> &[PoolConfig] {
        &self.pools
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_config_validation() {
        let config = Config {
            websocket: WebSocketConfig {
                url: "wss://example.com".to_string(),
            },
            proxy: None,
            database: None,
            router: None,
            logging: None,
            pools: vec![
                PoolConfig {
                    address: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2".to_string(),
                    name: "SOL/USDC".to_string(),
                    pool_type: "amm_v4".to_string(),
                },
            ],
        };
        
        assert_eq!(config.websocket_url(), "wss://example.com");
        assert_eq!(config.pools().len(), 1);
    }
}
