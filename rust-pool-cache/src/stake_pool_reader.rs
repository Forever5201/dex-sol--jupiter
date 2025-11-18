/*!
 * Stake Pool Reader
 * 
 * 实时读取Marinade和Jito的stake pool状态，获取LST的理论赎回比率
 */

use anyhow::Result;
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tracing::{info, warn, debug};

/// Marinade State账户地址
const MARINADE_STATE: &str = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";

/// Jito Stake Pool账户地址
const JITO_STAKE_POOL: &str = "Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb";

/// Stake Pool缓存数据
#[derive(Debug, Clone)]
pub struct StakePoolCache {
    pub msol_rate: f64,
    pub jitosol_rate: f64,
    pub last_updated: Instant,
}

impl Default for StakePoolCache {
    fn default() -> Self {
        Self {
            msol_rate: 1.05,
            jitosol_rate: 1.04,
            last_updated: Instant::now(),
        }
    }
}

/// Stake Pool Reader
pub struct StakePoolReader {
    rpc_client: Arc<RpcClient>,
    marinade_state_address: Pubkey,
    jito_stake_pool_address: Pubkey,
    cache: Arc<RwLock<StakePoolCache>>,
    cache_ttl: Duration,
}

impl StakePoolReader {
    pub fn new(rpc_url: &str, cache_ttl_secs: u64) -> Result<Self> {
        let rpc_client = Arc::new(RpcClient::new(rpc_url.to_string()));
        let marinade_state_address = Pubkey::from_str(MARINADE_STATE)?;
        let jito_stake_pool_address = Pubkey::from_str(JITO_STAKE_POOL)?;
        
        Ok(Self {
            rpc_client,
            marinade_state_address,
            jito_stake_pool_address,
            cache: Arc::new(RwLock::new(StakePoolCache::default())),
            cache_ttl: Duration::from_secs(cache_ttl_secs),
        })
    }
    
    pub fn get_all_rates(&self) -> Result<(f64, f64)> {
        let should_update = {
            let cache = self.cache.read().unwrap();
            cache.last_updated.elapsed() > self.cache_ttl
        };
        
        if should_update {
            self.update_cache()?;
        }
        
        let cache = self.cache.read().unwrap();
        Ok((cache.msol_rate, cache.jitosol_rate))
    }
    
    pub fn update_cache(&self) -> Result<()> {
        debug!("Updating stake pool cache from chain...");
        
        let msol_rate = self.fetch_msol_rate().unwrap_or(1.05);
        let jitosol_rate = self.fetch_jitosol_rate().unwrap_or(1.04);
        
        {
            let mut cache = self.cache.write().unwrap();
            cache.msol_rate = msol_rate;
            cache.jitosol_rate = jitosol_rate;
            cache.last_updated = Instant::now();
        }
        
        info!("Stake pool cache updated: mSOL={:.6}, jitoSOL={:.6}", msol_rate, jitosol_rate);
        Ok(())
    }
    
    pub fn get_cache_info(&self) -> (f64, f64, Duration) {
        let cache = self.cache.read().unwrap();
        (cache.msol_rate, cache.jitosol_rate, cache.last_updated.elapsed())
    }
    
    fn fetch_msol_rate(&self) -> Result<f64> {
        let account_data = self.rpc_client.get_account_data(&self.marinade_state_address)?;
        
        // Marinade State 账户结构（基于逆向工程验证）：
        // Offset 432-440: msol_supply (u64)
        // Offset 440-448: total_lamports_under_control (u64)
        if account_data.len() < 448 {
            return Err(anyhow::anyhow!("Marinade state data too short: {} bytes", account_data.len()));
        }
        
        let msol_supply = u64::from_le_bytes(account_data[432..440].try_into()?);
        let lamports_under_control = u64::from_le_bytes(account_data[440..448].try_into()?);
        
        if msol_supply == 0 {
            warn!("⚠️  mSOL supply is zero, using default rate 1.05");
            return Ok(1.05);
        }
        
        // Exchange rate = total_lamports / msol_supply
        // 通常在 1.02-1.10 之间
        let rate = lamports_under_control as f64 / msol_supply as f64;
        
        // 合理性检查
        if rate < 0.9 || rate > 1.5 {
            warn!("⚠️  Suspicious mSOL rate: {:.6}, using default 1.05", rate);
            return Ok(1.05);
        }
        
        debug!("✅ mSOL rate calculated: {:.6} (supply: {}, lamports: {})", 
               rate, msol_supply, lamports_under_control);
        
        Ok(rate)
    }
    
    fn fetch_jitosol_rate(&self) -> Result<f64> {
        let account_data = self.rpc_client.get_account_data(&self.jito_stake_pool_address)?;
        
        if account_data.len() < 273 {
            return Err(anyhow::anyhow!("Jito stake pool data too short"));
        }
        
        let total_lamports = u64::from_le_bytes(account_data[257..265].try_into()?);
        let pool_token_supply = u64::from_le_bytes(account_data[265..273].try_into()?);
        
        if pool_token_supply == 0 {
            return Ok(1.04);
        }
        
        Ok(total_lamports as f64 / pool_token_supply as f64)
    }
}



