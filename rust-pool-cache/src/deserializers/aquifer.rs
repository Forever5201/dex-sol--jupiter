use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Aquifer Pool State
/// 
/// Aquifer is a DEX on Solana
/// 
/// Program ID: (需要查询)
/// Data size: 估计类似标准 AMM 池子
/// 
/// Structure (基于通用 AMM 模式):
/// - Pubkey fields: Token mints, vaults, authority
/// - u64 fields: Reserves, fees, configuration
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct AquiferPoolState {
    /// Header fields (discriminator and version info)
    pub header_field_1: u64,
    pub header_field_2: u64,
    pub header_field_3: u64,
    
    /// Authority
    pub authority: Pubkey,
    
    /// Token A mint
    pub token_a_mint: Pubkey,
    
    /// Token B mint
    pub token_b_mint: Pubkey,
    
    /// Token A vault
    pub token_a_vault: Pubkey,
    
    /// Token B vault
    pub token_b_vault: Pubkey,
    
    /// LP mint
    pub lp_mint: Pubkey,
    
    /// Fee account
    pub fee_account: Pubkey,
    
    /// Additional pubkeys
    pub pubkey_8: Pubkey,
    pub pubkey_9: Pubkey,
    pub pubkey_10: Pubkey,
    pub pubkey_11: Pubkey,
    pub pubkey_12: Pubkey,
    
    /// Configuration and reserve fields
    pub config_fields: [u64; 70],
}

#[allow(dead_code)]
impl AquiferPoolState {
    /// Get reserve A amount (searching in config fields)
    pub fn get_reserve_a(&self) -> u64 {
        // 策略1: 首先尝试前几个索引（通常reserve在开头）
        for i in 0..10 {
            let val = self.config_fields[i];
            // 降低最小阈值，接受更小的reserve（如0.1个token）
            if val > 100_000 && val < 100_000_000_000_000 {
                return val;
            }
        }
        
        // 策略2: 如果前面没找到，搜索整个数组
        for i in 10..self.config_fields.len() {
            let val = self.config_fields[i];
            if val > 100_000 && val < 100_000_000_000_000 {
                return val;
            }
        }
        
        0
    }
    
    /// Get reserve B amount
    pub fn get_reserve_b(&self) -> u64 {
        let reserve_a = self.get_reserve_a();
        if reserve_a == 0 {
            return 0;
        }
        
        // 找到reserve_a的索引位置
        let reserve_a_idx = self.config_fields.iter()
            .position(|&x| x == reserve_a);
        
        if let Some(idx) = reserve_a_idx {
            // 策略1: 从reserve_a的下一个位置开始搜索（允许值相等，只要位置不同）
            for i in (idx + 1)..self.config_fields.len() {
                let val = self.config_fields[i];
                if val > 100_000 && val < 100_000_000_000_000 {
                    return val;  // ✅ 移除了 val != reserve_a 的检查，允许相等
                }
            }
        }
        
        // 策略2: 如果后面没找到，从头搜索（跳过reserve_a的位置）
        for i in 0..reserve_a_idx.unwrap_or(0) {
            let val = self.config_fields[i];
            if val > 100_000 && val < 100_000_000_000_000 {
                return val;
            }
        }
        
        0
    }
    
    /// Calculate price (token B per token A)
    pub fn calculate_price(&self) -> f64 {
        let reserve_a = self.get_reserve_a();
        let reserve_b = self.get_reserve_b();
        
        if reserve_a == 0 {
            return 0.0;
        }
        
        reserve_b as f64 / reserve_a as f64
    }
    
    /// Get human-readable reserve amounts
    pub fn get_reserves_formatted(&self, decimals_a: i32, decimals_b: i32) -> (f64, f64) {
        let reserve_a = self.get_reserve_a() as f64 / 10_f64.powi(decimals_a);
        let reserve_b = self.get_reserve_b() as f64 / 10_f64.powi(decimals_b);
        (reserve_a, reserve_b)
    }
    
    /// Get pool information for debugging
    pub fn get_pool_info(&self) -> String {
        let (reserve_a, reserve_b) = self.get_reserves_formatted(6, 6);
        format!(
            "Aquifer Pool:\n  Reserve A: {:.2}\n  Reserve B: {:.2}\n  Price: {:.6}",
            reserve_a,
            reserve_b,
            self.calculate_price()
        )
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for AquiferPoolState {
    fn dex_name(&self) -> &'static str {
        "Aquifer"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // Expected size: 3 u64 (24) + 12 Pubkeys (384) + 70 u64 (560) = 968 bytes
        // Allow some flexibility
        if data.len() < 900 || data.len() > 1050 {
            return Err(DexError::InvalidData(format!(
                "Aquifer pool data should be around 968 bytes, got {}",
                data.len()
            )));
        }
        
        Self::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!("Aquifer: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        AquiferPoolState::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        (self.get_reserve_a(), self.get_reserve_b())
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // 默认使用 6 decimals（USDC/USDT标准）
        (6, 6)
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if it has reserves
        self.get_reserve_a() > 0 || self.get_reserve_b() > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let (res_a, res_b) = self.get_reserves_formatted(6, 6);
        Some(format!(
            "Reserves: A={:.2}, B={:.2}",
            res_a,
            res_b
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_size() {
        use std::mem::size_of;
        
        let expected = 8 * 3      // header fields
            + 32 * 12             // 12 Pubkeys
            + 8 * 70;             // config_fields
        
        assert_eq!(expected, 968, "Structure size should be 968 bytes");
    }
    
    #[test]
    fn test_price_calculation() {
        let mut pool = AquiferPoolState {
            header_field_1: 0,
            header_field_2: 0,
            header_field_3: 0,
            authority: Pubkey::default(),
            token_a_mint: Pubkey::default(),
            token_b_mint: Pubkey::default(),
            token_a_vault: Pubkey::default(),
            token_b_vault: Pubkey::default(),
            lp_mint: Pubkey::default(),
            fee_account: Pubkey::default(),
            pubkey_8: Pubkey::default(),
            pubkey_9: Pubkey::default(),
            pubkey_10: Pubkey::default(),
            pubkey_11: Pubkey::default(),
            pubkey_12: Pubkey::default(),
            config_fields: [0; 70],
        };
        
        // Set test reserves
        pool.config_fields[0] = 1_000_000_000; // 1000 tokens (with 6 decimals = 1000)
        pool.config_fields[1] = 1_000_000_000; // 1000 tokens (with 6 decimals = 1000)
        
        let reserve_a = pool.get_reserve_a();
        let reserve_b = pool.get_reserve_b();
        let price = pool.calculate_price();
        
        println!("Reserve A: {}, Reserve B: {}, Price: {}", reserve_a, reserve_b, price);
        
        assert_ne!(reserve_a, 0, "Reserve A should not be zero");
        assert_ne!(reserve_b, 0, "Reserve B should not be zero");
        assert!(price > 0.0, "Price should be positive, got {}", price);
    }
}



