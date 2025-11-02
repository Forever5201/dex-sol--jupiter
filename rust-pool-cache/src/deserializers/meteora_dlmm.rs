use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Meteora DLMM (Dynamic Liquidity Market Maker) Pool State
/// 
/// Meteora DLMM uses a bin-based liquidity model where liquidity is concentrated
/// in specific price ranges (bins), similar to Uniswap V3 but with improved capital efficiency.
/// 
/// Program ID: LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo
/// 
/// Total size: 904 bytes (verified from on-chain data)
/// 
/// Key concepts:
/// - Bin: A price range where liquidity is concentrated
/// - Bin Step: The size of each price step between bins
/// - Active Bin: The current bin where trading is happening
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct MeteoraPoolState {
    /// Pool parameters
    pub parameters: PoolParameters,
    
    /// Token X mint address (typically the base token, e.g., SOL)
    pub token_x_mint: Pubkey,
    
    /// Token Y mint address (typically the quote token, e.g., USDC)
    pub token_y_mint: Pubkey,
    
    /// Reserve X vault (holds token X)
    pub reserve_x: Pubkey,
    
    /// Reserve Y vault (holds token Y)
    pub reserve_y: Pubkey,
    
    /// Oracle account (for price feeds)
    pub oracle: Pubkey,
    
    /// Fee collector token account X
    pub fee_collector_token_x: Pubkey,
    
    /// Fee collector token account Y
    pub fee_collector_token_y: Pubkey,
    
    /// Protocol fee owner
    pub protocol_fee_owner: Pubkey,
    
    /// Reward token accounts (up to 2 rewards)
    pub reward_vault_0: Pubkey,
    pub reward_vault_1: Pubkey,
    
    /// Reward mint addresses
    pub reward_mint_0: Pubkey,
    pub reward_mint_1: Pubkey,
    
    /// Current active bin ID (represents current price)
    pub active_id: i32,
    
    /// Bin step (price increment between bins)
    pub bin_step: u16,
    
    /// Status (0 = uninitialized, 1 = initialized, etc.)
    pub status: u8,
    
    /// Padding for alignment
    pub _padding0: u8,
    
    /// Protocol fee basis points
    pub protocol_fee_x: u64,
    pub protocol_fee_y: u64,
    
    /// Base fee rate
    pub base_fee_rate: u32,
    
    /// Max fee rate
    pub max_fee_rate: u32,
    
    /// Liquidity in the pool
    pub liquidity: u128,
    
    /// Reward infos
    pub reward_duration_0: u64,
    pub reward_duration_1: u64,
    
    pub reward_duration_end_0: u64,
    pub reward_duration_end_1: u64,
    
    pub reward_rate_0: u128,
    pub reward_rate_1: u128,
    
    pub reward_last_update_time_0: u64,
    pub reward_last_update_time_1: u64,
    
    pub reward_cumulative_per_share_x_0: u128,
    pub reward_cumulative_per_share_x_1: u128,
    
    /// Volatility accumulator
    pub volatility_accumulator: u32,
    
    /// Volatility reference
    pub volatility_reference: u32,
    
    /// Last updated timestamp
    pub last_update_timestamp: i64,
    
    /// Swap cap amounts
    pub swap_cap_amount: u64,
    pub swap_cap_deactivate_slot: u64,
    
    /// Whitelisted wallet
    pub whitelisted_wallet: Pubkey,
    
    /// Pre-activation swap address
    pub pre_activation_swap_address: Pubkey,
    
    /// Base key
    pub base_key: Pubkey,
    
    /// Activation type
    pub activation_type: u8,
    
    /// Padding
    pub _padding1: [u8; 7],
    
    /// Additional padding for future fields (align to 896 bytes after discriminator)
    /// 
    /// 🔥 修正：根据实际测试，结构体定义太大了
    /// 实际数据: 896 bytes
    /// 已定义字段计算:
    ///   - PoolParameters: 32
    ///   - 13 Pubkeys: 13×32 = 416
    ///   - i32 (active_id): 4
    ///   - u16 (bin_step): 2
    ///   - u8 (status): 1
    ///   - u8 (_padding0): 1
    ///   - 2 u64 (protocol_fee): 16
    ///   - 2 u32 (fee rates): 8
    ///   - u128 (liquidity): 16
    ///   - 10 u64 (reward fields): 80
    ///   - 2 u128 (reward cumulative): 32
    ///   - 2 u32 (volatility): 8
    ///   - i64 (timestamp): 8
    ///   - 2 u64 (swap cap): 16
    ///   - 3 Pubkey: 96
    ///   - u8 (activation_type): 1
    ///   - [u8;7] (_padding1): 7
    ///   ━━━━━━━━━━━━━━━━━━━━━━
    ///   总计: 744 bytes
    /// 
    /// 需要padding: 896 - 744 = 152 bytes
    pub padding: [u8; 152],
}

#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct PoolParameters {
    /// Base factor for dynamic fees
    pub base_factor: u16,
    
    /// Filter period for oracle
    pub filter_period: u16,
    
    /// Decay period for fees
    pub decay_period: u16,
    
    /// Reduction factor for fees
    pub reduction_factor: u16,
    
    /// Variable fee control
    pub variable_fee_control: u32,
    
    /// Max volatility accumulator
    pub max_volatility_accumulator: u32,
    
    /// Min bin ID
    pub min_bin_id: i32,
    
    /// Max bin ID
    pub max_bin_id: i32,
    
    /// Protocol share (in basis points)
    pub protocol_share: u16,
    
    /// Padding
    pub padding: [u8; 6],
}

#[allow(dead_code)]
impl MeteoraPoolState {
    /// Calculate price from active bin ID
    /// 
    /// Formula: price = (1 + bin_step / 10000)^active_id
    /// 
    /// The bin_step is typically a small percentage (e.g., 10 = 0.1%)
    /// and the active_id represents how many steps away from the base price.
    pub fn calculate_price(&self) -> f64 {
        let bin_step_decimal = self.bin_step as f64 / 10000.0;
        let base = 1.0 + bin_step_decimal;
        base.powi(self.active_id)
    }
    
    /// Calculate the effective price adjusted for decimals
    pub fn calculate_price_with_decimals(&self, decimals_x: u8, decimals_y: u8) -> f64 {
        let raw_price = self.calculate_price();
        let decimal_adjustment = 10_f64.powi(decimals_y as i32 - decimals_x as i32);
        raw_price * decimal_adjustment
    }
    
    /// Check if the pool is within valid price range
    pub fn is_in_range(&self) -> bool {
        self.active_id >= self.parameters.min_bin_id 
            && self.active_id <= self.parameters.max_bin_id
    }
    
    /// Get human-readable pool info
    pub fn get_pool_info(&self) -> String {
        format!(
            "Active Bin: {}, Bin Step: {}, Liquidity: {}, Base Fee: {} bps, Status: {}",
            self.active_id,
            self.bin_step,
            self.liquidity,
            self.base_fee_rate,
            self.status
        )
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for MeteoraPoolState {
    fn dex_name(&self) -> &'static str {
        "Meteora DLMM"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // Meteora DLMM accounts start with 8-byte discriminator
        if data.len() < 8 {
            return Err(DexError::DeserializationFailed(format!(
                "Meteora DLMM: Data too short: {} bytes",
                data.len()
            )));
        }
        
        let data_to_parse = &data[8..];
        
        // 🔥 尝试反序列化，如果失败则返回详细错误信息
        Self::try_from_slice(data_to_parse)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Meteora DLMM: {} (data length: {} bytes, expected ~896 bytes after discriminator)",
                e,
                data_to_parse.len()
            )))
    }
    
    fn calculate_price(&self) -> f64 {
        self.calculate_price()
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // Meteora DLMM reserves are stored in separate vault accounts
        // For now, return liquidity as a proxy for reserves
        // TODO: Query actual reserve vaults for accurate amounts
        let liquidity_u64 = (self.liquidity as u64).min(u64::MAX);
        (liquidity_u64, liquidity_u64)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // Default decimals for common pairs
        // SOL = 9, USDC/USDT = 6
        // TODO: Query token mint accounts for actual decimals
        (9, 6)
    }
    
    fn is_active(&self) -> bool {
        self.is_in_range() && self.liquidity > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(self.get_pool_info())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::size_of;
    
    #[test]
    fn test_structure_sizes() {
        println!("PoolParameters size: {}", size_of::<PoolParameters>());
        println!("MeteoraPoolState size: {}", size_of::<MeteoraPoolState>());
        println!("Expected: 896 bytes (904 - 8 discriminator)");
        
        // Verify PoolParameters is 32 bytes
        assert_eq!(size_of::<PoolParameters>(), 32, "PoolParameters should be 32 bytes");
    }
    
    #[test]
    fn test_price_calculation() {
        let pool = MeteoraPoolState {
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
                padding: [0; 6],
            },
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            oracle: Pubkey::default(),
            fee_collector_token_x: Pubkey::default(),
            fee_collector_token_y: Pubkey::default(),
            protocol_fee_owner: Pubkey::default(),
            reward_vault_0: Pubkey::default(),
            reward_vault_1: Pubkey::default(),
            reward_mint_0: Pubkey::default(),
            reward_mint_1: Pubkey::default(),
            active_id: 0,
            bin_step: 10, // 0.1%
            status: 1,
            _padding0: 0,
            protocol_fee_x: 100,
            protocol_fee_y: 100,
            base_fee_rate: 100,
            max_fee_rate: 1000,
            liquidity: 1_000_000_000,
            reward_duration_0: 0,
            reward_duration_1: 0,
            reward_duration_end_0: 0,
            reward_duration_end_1: 0,
            reward_rate_0: 0,
            reward_rate_1: 0,
            reward_last_update_time_0: 0,
            reward_last_update_time_1: 0,
            reward_cumulative_per_share_x_0: 0,
            reward_cumulative_per_share_x_1: 0,
            volatility_accumulator: 0,
            volatility_reference: 0,
            last_update_timestamp: 0,
            swap_cap_amount: 0,
            swap_cap_deactivate_slot: 0,
            whitelisted_wallet: Pubkey::default(),
            pre_activation_swap_address: Pubkey::default(),
            base_key: Pubkey::default(),
            activation_type: 0,
            _padding1: [0; 7],
            padding: [0; 200],
        };
        
        // At active_id = 0, price should be 1.0
        let price = pool.calculate_price();
        assert!((price - 1.0).abs() < 0.0001);
        
        // Test with positive active_id
        let mut pool2 = pool.clone();
        pool2.active_id = 100;
        let price2 = pool2.calculate_price();
        assert!(price2 > 1.0);
        
        // Test with negative active_id
        let mut pool3 = pool.clone();
        pool3.active_id = -100;
        let price3 = pool3.calculate_price();
        assert!(price3 < 1.0);
    }
    
    #[test]
    fn test_is_in_range() {
        let mut pool = MeteoraPoolState {
            parameters: PoolParameters {
                base_factor: 5000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 40000,
                max_volatility_accumulator: 350000,
                min_bin_id: -1000,
                max_bin_id: 1000,
                protocol_share: 1000,
                padding: [0; 6],
            },
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            oracle: Pubkey::default(),
            fee_collector_token_x: Pubkey::default(),
            fee_collector_token_y: Pubkey::default(),
            protocol_fee_owner: Pubkey::default(),
            reward_vault_0: Pubkey::default(),
            reward_vault_1: Pubkey::default(),
            reward_mint_0: Pubkey::default(),
            reward_mint_1: Pubkey::default(),
            active_id: 0,
            bin_step: 10,
            status: 1,
            _padding0: 0,
            protocol_fee_x: 100,
            protocol_fee_y: 100,
            base_fee_rate: 100,
            max_fee_rate: 1000,
            liquidity: 1_000_000_000,
            reward_duration_0: 0,
            reward_duration_1: 0,
            reward_duration_end_0: 0,
            reward_duration_end_1: 0,
            reward_rate_0: 0,
            reward_rate_1: 0,
            reward_last_update_time_0: 0,
            reward_last_update_time_1: 0,
            reward_cumulative_per_share_x_0: 0,
            reward_cumulative_per_share_x_1: 0,
            volatility_accumulator: 0,
            volatility_reference: 0,
            last_update_timestamp: 0,
            swap_cap_amount: 0,
            swap_cap_deactivate_slot: 0,
            whitelisted_wallet: Pubkey::default(),
            pre_activation_swap_address: Pubkey::default(),
            base_key: Pubkey::default(),
            activation_type: 0,
            _padding1: [0; 7],
            padding: [0; 200],
        };
        
        assert!(pool.is_in_range());
        
        pool.active_id = 1001;
        assert!(!pool.is_in_range());
        
        pool.active_id = -1001;
        assert!(!pool.is_in_range());
    }
}



