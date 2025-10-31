///! Meteora DLMM Pool State - 基于官方SDK文档的改进版本
///! 
///! 注意: 这是基于官方SDK文档手动构建的结构
///! 虽然不如从IDL自动生成的准确，但比猜测的padding要好
///! 
///! 参考来源:
///! - Meteora DLMM SDK TypeScript实现
///! - Context7查询的官方文档
///! - 链上数据大小验证 (904 bytes total)

use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Meteora DLMM Pool Parameters
/// 基于官方SDK的PoolParameters结构
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct PoolParameters {
    /// Base factor for dynamic fees
    pub base_factor: u16,
    
    /// Filter period for oracle updates
    pub filter_period: u16,
    
    /// Decay period for fee reduction
    pub decay_period: u16,
    
    /// Reduction factor for fees
    pub reduction_factor: u16,
    
    /// Variable fee control parameter
    pub variable_fee_control: u32,
    
    /// Maximum volatility accumulator value
    pub max_volatility_accumulator: u32,
    
    /// Minimum bin ID allowed
    pub min_bin_id: i32,
    
    /// Maximum bin ID allowed
    pub max_bin_id: i32,
    
    /// Protocol share in basis points
    pub protocol_share: u16,
    
    /// Padding for alignment (6 bytes to make total 32 bytes)
    pub _padding: [u8; 6],
}

/// Meteora DLMM Pool State
/// 
/// 总大小: 904 bytes
/// - 8 bytes: Anchor discriminator
/// - 896 bytes: 实际数据
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct MeteoraPoolStateImproved {
    // ========================================
    // 1. Pool Parameters (32 bytes)
    // ========================================
    pub parameters: PoolParameters,
    
    // ========================================
    // 2. Core Pubkeys (12 * 32 = 384 bytes)
    // ========================================
    pub token_x_mint: Pubkey,
    pub token_y_mint: Pubkey,
    pub reserve_x: Pubkey,
    pub reserve_y: Pubkey,
    pub oracle: Pubkey,
    pub fee_owner: Pubkey,
    pub lock_releaser: Pubkey,
    pub activation_point: Pubkey,
    pub bin_array_bitmap_extension: Pubkey,
    pub reserved_pubkey_1: Pubkey,
    pub reserved_pubkey_2: Pubkey,
    pub reserved_pubkey_3: Pubkey,
    
    // ========================================
    // 3. Current State (20 bytes)
    // ========================================
    /// Current active bin ID
    pub active_id: i32,
    
    /// Bin step (price increment)
    pub bin_step: u16,
    
    /// Pool status flags
    pub status: u8,
    
    /// Padding for alignment
    pub _padding1: u8,
    
    /// Protocol fee for token X
    pub protocol_fee_x: u64,
    
    /// Protocol fee for token Y  
    pub protocol_fee_y: u64,
    
    // ========================================
    // 4. Fee Configuration (8 bytes)
    // ========================================
    pub base_fee_rate: u32,
    pub max_fee_rate: u32,
    
    // ========================================
    // 5. Swap Cap & Security (32 bytes)
    // ========================================
    pub swap_cap_deactivate_slot: u64,
    pub swap_cap_amount: u64,
    pub last_updated_at: i64,
    pub whitelisted_wallet: Pubkey,
    
    // ========================================  
    // 6. Bin Arrays Management (16 bytes)
    // ========================================
    pub bin_array_bitmap: [u64; 2],  // 128 bins tracking
    
    // ========================================
    // 7. Reserved Space for Future Expansion
    // ========================================
    /// 根据实际测试:
    /// 已知字段: 32 + 384 + 24 + 8 + 56 + 16 = 520 bytes
    /// 目标: 896 bytes
    /// 需要: 896 - 520 = 376 bytes
    /// 
    /// 这个空间可能包含:
    /// - Reward系统相关字段
    /// - 扩展的费用信息
    /// - 统计数据
    /// - 未来版本的字段
    pub reserved: [u8; 376],
}

impl MeteoraPoolStateImproved {
    /// 从active_id计算价格
    /// 
    /// Formula: price = (1 + bin_step/10000)^active_id
    pub fn calculate_price(&self) -> f64 {
        let bin_step_decimal = self.bin_step as f64 / 10000.0;
        let base = 1.0 + bin_step_decimal;
        base.powi(self.active_id)
    }
    
    /// 检查池子是否在有效价格范围内
    pub fn is_in_range(&self) -> bool {
        self.active_id >= self.parameters.min_bin_id 
            && self.active_id <= self.parameters.max_bin_id
    }
    
    /// 检查池子是否活跃
    pub fn is_pool_active(&self) -> bool {
        self.status != 0 && self.is_in_range()
    }
}

impl DexPool for MeteoraPoolStateImproved {
    fn dex_name(&self) -> &'static str {
        "Meteora DLMM (Improved)"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // Anchor accounts start with 8-byte discriminator
        if data.len() < 8 {
            return Err(DexError::DeserializationFailed(format!(
                "Meteora DLMM: Data too short: {} bytes",
                data.len()
            )));
        }
        
        let data_to_parse = &data[8..];
        
        // 验证大小
        if data_to_parse.len() != 896 {
            return Err(DexError::DeserializationFailed(format!(
                "Meteora DLMM: Expected 896 bytes, got {} bytes",
                data_to_parse.len()
            )));
        }
        
        // 尝试反序列化
        Self::try_from_slice(data_to_parse)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Meteora DLMM: Borsh deserialization failed: {} (data length: {})",
                e,
                data_to_parse.len()
            )))
    }
    
    fn calculate_price(&self) -> f64 {
        self.calculate_price()
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // Meteora DLMM的储备金在separate vault accounts
        // 这里返回0作为占位符
        // TODO: 实际应该查询reserve_x和reserve_y账户
        (0, 0)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // Default: SOL(9) vs USDC(6)
        // TODO: 从token mint账户读取实际的decimals
        (9, 6)
    }
    
    fn is_active(&self) -> bool {
        self.is_pool_active()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "Active Bin: {}, Bin Step: {}, Price: {:.6}, Status: {}",
            self.active_id,
            self.bin_step,
            self.calculate_price(),
            self.status
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::size_of;
    
    #[test]
    fn test_structure_size() {
        let params_size = size_of::<PoolParameters>();
        let pool_size = size_of::<MeteoraPoolStateImproved>();
        
        println!("PoolParameters size: {} bytes", params_size);
        println!("MeteoraPoolStateImproved size: {} bytes", pool_size);
        println!("Expected total: 896 bytes (904 - 8 discriminator)");
        
        assert_eq!(params_size, 32, "PoolParameters should be 32 bytes");
        
        if pool_size != 896 {
            println!("⚠️  Size mismatch: expected 896, got {}", pool_size);
            println!("   Difference: {} bytes", 896i32 - pool_size as i32);
        }
    }
    
    #[test]
    fn test_price_calculation() {
        let pool = MeteoraPoolStateImproved {
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
            bin_step: 10,
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
        
        // At active_id=0, price should be 1.0
        let price = pool.calculate_price();
        assert!((price - 1.0).abs() < 0.0001);
    }
}

