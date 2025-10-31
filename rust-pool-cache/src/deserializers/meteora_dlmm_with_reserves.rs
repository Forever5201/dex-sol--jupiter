///! Meteora DLMM Pool State - 带储备金支持的版本
///! 
///! 这个版本在MeteoraPoolStateImproved的基础上，
///! 添加了从vault账户动态获取储备金的支持

use crate::dex_interface::{DexPool, DexError};
use crate::reserve_fetcher::ReserveFetcher;
use crate::deserializers::meteora_dlmm_improved::MeteoraPoolStateImproved;

/// Meteora DLMM Pool State（扩展版）
/// 
/// 在基础结构之上添加运行时储备金缓存
pub struct MeteoraPoolStateWithReserves {
    /// 基础池子状态
    pub base: MeteoraPoolStateImproved,
    
    /// 缓存的储备金（从vault读取）
    cached_reserves: Option<(u64, u64)>,
    
    /// 缓存的decimals
    cached_decimals: Option<(u8, u8)>,
}

impl MeteoraPoolStateWithReserves {
    /// 从基础状态创建
    pub fn from_base(base: MeteoraPoolStateImproved) -> Self {
        Self {
            base,
            cached_reserves: None,
            cached_decimals: None,
        }
    }
    
    /// 从RPC获取实时储备金
    /// 
    /// # Arguments
    /// * `rpc_url` - RPC端点地址
    /// 
    /// # Returns
    /// * `Ok(())` - 储备金已缓存
    /// * `Err(DexError)` - RPC调用失败
    pub fn fetch_reserves(&mut self, rpc_url: &str) -> Result<(), DexError> {
        let fetcher = ReserveFetcher::new(rpc_url);
        
        // 获取储备金
        let reserves = fetcher.fetch_reserves(
            &self.base.reserve_x,
            &self.base.reserve_y,
        )?;
        
        self.cached_reserves = Some(reserves);
        
        // 获取decimals
        let decimals_x = fetcher.fetch_mint_decimals(&self.base.token_x_mint)?;
        let decimals_y = fetcher.fetch_mint_decimals(&self.base.token_y_mint)?;
        
        self.cached_decimals = Some((decimals_x, decimals_y));
        
        Ok(())
    }
    
    /// 获取格式化后的储备金（考虑decimals）
    pub fn get_reserves_formatted(&self) -> Option<(f64, f64)> {
        match (self.cached_reserves, self.cached_decimals) {
            (Some((rx, ry)), Some((dx, dy))) => {
                let rx_f = rx as f64 / 10f64.powi(dx as i32);
                let ry_f = ry as f64 / 10f64.powi(dy as i32);
                Some((rx_f, ry_f))
            }
            _ => None,
        }
    }
}

impl DexPool for MeteoraPoolStateWithReserves {
    fn dex_name(&self) -> &'static str {
        "Meteora DLMM (With Reserves)"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        let base = MeteoraPoolStateImproved::from_account_data(data)?;
        Ok(Self::from_base(base))
    }
    
    fn calculate_price(&self) -> f64 {
        self.base.calculate_price()
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // 如果有缓存的储备金，使用缓存
        // 否则返回0（表示需要手动获取）
        self.cached_reserves.unwrap_or((0, 0))
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        self.cached_decimals.unwrap_or((9, 6)) // 默认: SOL/USDC
    }
    
    fn is_active(&self) -> bool {
        self.base.is_active()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let mut info = self.base.get_additional_info().unwrap_or_default();
        
        if let Some((rx, ry)) = self.get_reserves_formatted() {
            info.push_str(&format!(", Reserves: {:.4} / {:.4}", rx, ry));
        } else {
            info.push_str(", Reserves: Not fetched (call fetch_reserves())");
        }
        
        Some(info)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_from_base() {
        use crate::deserializers::meteora_dlmm_improved::PoolParameters;
        
        let base = MeteoraPoolStateImproved {
            parameters: PoolParameters {
                base_factor: 5000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 40000,
                max_volatility_accumulator: 350000,
                min_bin_id: -443636,
                max_bin_id: 443636,
                protocol_share: 1000,
                _padding: [0; 6],
            },
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            oracle: Pubkey::default(),
            fee_owner: Pubkey::default(),
            lock_releaser: Pubkey::default(),
            activation_point: Pubkey::default(),
            bin_array_bitmap_extension: Pubkey::default(),
            reserved_pubkey_1: Pubkey::default(),
            reserved_pubkey_2: Pubkey::default(),
            reserved_pubkey_3: Pubkey::default(),
            active_id: 0,
            bin_step: 25,
            status: 1,
            _padding1: 0,
            protocol_fee_x: 0,
            protocol_fee_y: 0,
            base_fee_rate: 100,
            max_fee_rate: 1000,
            swap_cap_deactivate_slot: 0,
            swap_cap_amount: 0,
            last_updated_at: 0,
            whitelisted_wallet: Pubkey::default(),
            bin_array_bitmap: [0; 2],
            reserved: [0; 376],
        };
        
        let pool_with_reserves = MeteoraPoolStateWithReserves::from_base(base);
        assert_eq!(pool_with_reserves.dex_name(), "Meteora DLMM (With Reserves)");
        assert_eq!(pool_with_reserves.get_reserves(), (0, 0)); // Not fetched yet
    }
    
    #[test]
    fn test_reserves_formatting() {
        use crate::deserializers::meteora_dlmm_improved::PoolParameters;
        
        let base = MeteoraPoolStateImproved {
            parameters: PoolParameters {
                base_factor: 5000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 40000,
                max_volatility_accumulator: 350000,
                min_bin_id: -443636,
                max_bin_id: 443636,
                protocol_share: 1000,
                _padding: [0; 6],
            },
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            oracle: Pubkey::default(),
            fee_owner: Pubkey::default(),
            lock_releaser: Pubkey::default(),
            activation_point: Pubkey::default(),
            bin_array_bitmap_extension: Pubkey::default(),
            reserved_pubkey_1: Pubkey::default(),
            reserved_pubkey_2: Pubkey::default(),
            reserved_pubkey_3: Pubkey::default(),
            active_id: 0,
            bin_step: 25,
            status: 1,
            _padding1: 0,
            protocol_fee_x: 0,
            protocol_fee_y: 0,
            base_fee_rate: 100,
            max_fee_rate: 1000,
            swap_cap_deactivate_slot: 0,
            swap_cap_amount: 0,
            last_updated_at: 0,
            whitelisted_wallet: Pubkey::default(),
            bin_array_bitmap: [0; 2],
            reserved: [0; 376],
        };
        
        let mut pool_with_reserves = MeteoraPoolStateWithReserves::from_base(base);
        
        // 模拟设置储备金
        pool_with_reserves.cached_reserves = Some((1_000_000_000, 100_000_000)); // 1 SOL, 100 USDC
        pool_with_reserves.cached_decimals = Some((9, 6));
        
        let (rx, ry) = pool_with_reserves.get_reserves_formatted().unwrap();
        assert!((rx - 1.0).abs() < 0.0001);    // 1 SOL
        assert!((ry - 100.0).abs() < 0.0001);  // 100 USDC
    }
}

