/*!
 * 链上模拟器
 * 
 * 两阶段验证策略：
 * 1. 轻量级：数据质量检查（<1ms）
 * 2. 深度：链上账户状态验证（50-100ms）
 * 
 * 智能策略：只对高置信度机会进行链上验证
 */

use anyhow::{anyhow, Result};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{commitment_config::CommitmentConfig, pubkey::Pubkey};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, warn, info};

use crate::arbitrage::ArbitrageOpportunity;
use crate::pool_factory::PoolFactory;

/// 模拟结果
#[derive(Debug, Clone)]
pub struct SimulationResult {
    /// 验证的池子价格（链上最新）
    pub pool_a_verified_price: f64,
    pub pool_b_verified_price: f64,
    /// 价格偏差（相对于缓存价格）
    pub pool_a_deviation_pct: f64,
    pub pool_b_deviation_pct: f64,
    /// 预估实际利润（考虑偏差后）
    pub estimated_actual_profit_pct: f64,
    /// 模拟延迟
    pub simulation_latency_ms: u64,
    /// 链上slot
    pub verified_slot: u64,
    /// 是否仍然有利可图
    pub still_profitable: bool,
}

/// 链上模拟器配置
#[derive(Debug, Clone)]
pub struct SimulatorConfig {
    /// 最小置信度才触发模拟（节省RPC）
    pub min_confidence_for_simulation: f64,
    /// 模拟超时（毫秒）
    pub timeout_ms: u64,
    /// 最大并发模拟数
    pub max_concurrent: usize,
}

impl Default for SimulatorConfig {
    fn default() -> Self {
        Self {
            min_confidence_for_simulation: 80.0,  // 只模拟>80分的机会
            timeout_ms: 500,
            max_concurrent: 10,
        }
    }
}

/// 链上模拟器
/// 
/// 注意：这是"虚拟模拟"而非交易模拟
/// 通过重新读取池子账户状态来验证价格，而非模拟真实交易
/// 优势：
/// - 不需要构建复杂的DEX交易指令
/// - 适用于所有DEX类型
/// - 延迟低（只需getAccountInfo）
pub struct OnChainSimulator {
    rpc_client: Arc<RpcClient>,
    config: SimulatorConfig,
}

impl OnChainSimulator {
    /// 创建新的模拟器
    pub fn new(rpc_url: String, config: SimulatorConfig) -> Self {
        let rpc_client = Arc::new(RpcClient::new_with_commitment(
            rpc_url,
            CommitmentConfig::confirmed(),
        ));
        
        Self {
            rpc_client,
            config,
        }
    }
    
    /// 使用默认配置创建
    pub fn with_defaults(rpc_url: String) -> Self {
        Self::new(rpc_url, SimulatorConfig::default())
    }
    
    /// 验证套利机会是否仍然有效
    /// 
    /// 通过重新从链上读取池子状态来验证价格
    /// 
    /// # Arguments
    /// * `opportunity` - 待验证的套利机会
    /// * `confidence_score` - 轻量级验证的置信度
    /// 
    /// # Returns
    /// Some(SimulationResult) 如果通过验证，None 如果应该跳过
    pub async fn verify_opportunity(
        &self,
        opportunity: &ArbitrageOpportunity,
        confidence_score: f64,
    ) -> Option<SimulationResult> {
        // 🎯 智能过滤：低置信度不模拟
        if confidence_score < self.config.min_confidence_for_simulation {
            debug!(
                "Skipping simulation for low confidence opportunity ({:.1}%)",
                confidence_score
            );
            return None;
        }
        
        let start = Instant::now();
        
        // 从链上重新读取两个池子的状态
        let pool_a_result = self.fetch_pool_state(&opportunity.pool_a_id).await;
        let pool_b_result = self.fetch_pool_state(&opportunity.pool_b_id).await;
        
        let simulation_latency = start.elapsed().as_millis() as u64;
        
        match (pool_a_result, pool_b_result) {
            (Ok((pool_a_price, slot_a)), Ok((pool_b_price, slot_b))) => {
                // 计算价格偏差
                let deviation_a = ((pool_a_price - opportunity.pool_a_price).abs() 
                    / opportunity.pool_a_price) * 100.0;
                let deviation_b = ((pool_b_price - opportunity.pool_b_price).abs() 
                    / opportunity.pool_b_price) * 100.0;
                
                // 重新计算实际利润
                let price_diff = (pool_b_price - pool_a_price).abs();
                let avg_price = (pool_a_price + pool_b_price) / 2.0;
                let actual_profit_pct = (price_diff / avg_price) * 100.0;
                
                // 判断是否仍然有利可图（考虑0.3%手续费）
                let still_profitable = actual_profit_pct > 0.3;
                
                let verified_slot = slot_a.max(slot_b);
                
                if still_profitable {
                    info!(
                        "✅ Simulation passed: {} profit={:.2}% (cached={:.2}%) latency={}ms slot={}",
                        opportunity.pair,
                        actual_profit_pct,
                        opportunity.estimated_profit_pct,
                        simulation_latency,
                        verified_slot
                    );
                } else {
                    warn!(
                        "❌ Simulation failed: {} profit dropped to {:.2}% (was {:.2}%)",
                        opportunity.pair,
                        actual_profit_pct,
                        opportunity.estimated_profit_pct
                    );
                }
                
                Some(SimulationResult {
                    pool_a_verified_price: pool_a_price,
                    pool_b_verified_price: pool_b_price,
                    pool_a_deviation_pct: deviation_a,
                    pool_b_deviation_pct: deviation_b,
                    estimated_actual_profit_pct: actual_profit_pct,
                    simulation_latency_ms: simulation_latency,
                    verified_slot,
                    still_profitable,
                })
            }
            _ => {
                warn!("Failed to fetch pool states for simulation");
                None
            }
        }
    }
    
    /// 从链上重新读取池子状态
    /// 
    /// # Returns
    /// (price, slot)
    async fn fetch_pool_state(&self, pool_address: &str) -> Result<(f64, u64)> {
        let pubkey = Pubkey::from_str(pool_address)
            .map_err(|e| anyhow!("Invalid pubkey: {}", e))?;
        
        // 获取账户信息（包含slot）
        let response = self.rpc_client
            .get_account_with_commitment(&pubkey, CommitmentConfig::confirmed())
            .map_err(|e| anyhow!("RPC error: {}", e))?;
        
        let account = response.value
            .ok_or_else(|| anyhow!("Account not found: {}", pool_address))?;
        
        let slot = response.context.slot;
        let data = account.data;
        
        // 使用PoolFactory的静态方法自动检测并解析
        let pool = PoolFactory::create_pool_auto_detect(&data)
            .map_err(|e| anyhow!("Deserialization failed: {:?}", e))?;
        
        let price = pool.calculate_price();
        
        Ok((price, slot))
    }
    
    /// 批量验证多个机会（并发）
    /// 
    /// # Arguments
    /// * `opportunities` - (机会, 置信度) 列表
    /// 
    /// # Returns
    /// 验证通过的机会列表
    pub async fn verify_batch(
        &self,
        opportunities: Vec<(ArbitrageOpportunity, f64)>,
    ) -> Vec<(ArbitrageOpportunity, SimulationResult)> {
        use tokio::sync::Semaphore;
        
        let semaphore = Arc::new(Semaphore::new(self.config.max_concurrent));
        let mut tasks = Vec::new();
        
        for (opp, confidence) in opportunities {
            let sem = semaphore.clone();
            let simulator = self.clone();
            
            let task = tokio::spawn(async move {
                let _permit = sem.acquire().await.ok()?;
                let result = simulator.verify_opportunity(&opp, confidence).await?;
                Some((opp, result))
            });
            
            tasks.push(task);
        }
        
        // 等待所有任务完成
        let results = futures_util::future::join_all(tasks).await;
        
        // 过滤出成功的结果
        results
            .into_iter()
            .filter_map(|r| r.ok().flatten())
            .filter(|(_, sim)| sim.still_profitable)  // 只返回仍有利可图的
            .collect()
    }
}

impl Clone for OnChainSimulator {
    fn clone(&self) -> Self {
        Self {
            rpc_client: Arc::clone(&self.rpc_client),
            config: self.config.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_simulator_config() {
        let config = SimulatorConfig::default();
        assert_eq!(config.min_confidence_for_simulation, 80.0);
        assert_eq!(config.max_concurrent, 10);
    }
}

