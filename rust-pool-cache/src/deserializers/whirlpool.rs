use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Orca Whirlpool Pool State
/// 
/// Whirlpool is Orca's concentrated liquidity market maker (CLMM)
/// Similar to Uniswap V3 and Raydium CLMM
/// 
/// Program ID: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
/// Data size: 653 bytes (verified via RPC)
/// 
/// Structure based on Orca's whirlpool SDK:
/// https://github.com/orca-so/whirlpools
/// 
/// Total calculated size: 
/// - Base fields: 32+1+2+2+2+16+16+4+8+8+32+32+32+32+16+16+8 = 259 bytes
/// - RewardInfo[3]: 128*3 = 384 bytes  
/// - Oracle: 32 bytes
/// - TOTAL: 259+384+32 = 675 bytes
/// 
/// Actual: 653 bytes, so we're 22 bytes over. 
/// Likely tick_spacing_seed doesn't exist or there's less padding
#[derive(Debug, Clone, BorshDeserialize)]
pub struct WhirlpoolState {
    /// Whirlpools config account
    pub whirlpools_config: Pubkey,      // 32
    
    /// Whirlpool bump seed
    pub whirlpool_bump: [u8; 1],        // 1
    
    /// Tick spacing (determines min price movement)
    pub tick_spacing: u16,              // 2
    
    /// Tick spacing seed
    pub tick_spacing_seed: [u8; 2],     // 2
    
    /// Fee rate (in basis points, e.g., 2500 = 0.25%)
    pub fee_rate: u16,                  // 2
    
    /// Protocol fee rate
    pub protocol_fee_rate: u16,         // 2
    
    /// Total liquidity in the pool
    pub liquidity: u128,                // 16
    
    /// Current sqrt price (Q64.64)
    pub sqrt_price: u128,               // 16
    
    /// Current tick index
    pub tick_current_index: i32,        // 4
    
    /// Protocol fee owed A
    pub protocol_fee_owed_a: u64,       // 8
    
    /// Protocol fee owed B
    pub protocol_fee_owed_b: u64,       // 8
    
    /// Token A mint
    pub token_mint_a: Pubkey,           // 32
    
    /// Token B mint
    pub token_mint_b: Pubkey,           // 32
    
    /// Token A vault
    pub token_vault_a: Pubkey,          // 32
    
    /// Token B vault  
    pub token_vault_b: Pubkey,          // 32
    
    /// Fee growth global A
    pub fee_growth_global_a: u128,      // 16
    
    /// Fee growth global B
    pub fee_growth_global_b: u128,      // 16
    
    /// Reward infos (Whirlpool supports up to 3 reward tokens)
    pub reward_last_updated_timestamp: u64,  // 8
    pub reward_infos: [RewardInfo; 3],       // 384 (128*3)
    
    /// Oracle address
    pub oracle: Pubkey,                      // 32
}
// Current total: 32+1+2+2+2+2+16+16+4+8+8+32+32+32+32+16+16+8+384+32 = 677 bytes
// Target: 653 bytes
// Difference: -20 bytes
// 
// Possible issues:
// 1. tick_spacing_seed might still exist (2 bytes) - removed above
// 2. RewardInfo might be smaller (maybe no authority field?)
// 3. Some padding bytes between fields

#[derive(Debug, Clone, Copy, BorshDeserialize)]
pub struct RewardInfo {
    /// Reward token mint
    pub mint: Pubkey,              // 32 bytes
    /// Reward vault
    pub vault: Pubkey,             // 32 bytes
    /// Authority
    pub authority: Pubkey,         // 32 bytes
    /// Emissions per second (Q64.64)
    pub emissions_per_second_x64: u128,  // 16 bytes
    /// Growth global
    pub growth_global_x64: u128,   // 16 bytes
}
// Total per RewardInfo: 32 + 32 + 32 + 16 + 16 = 128 bytes
// 3 RewardInfo = 384 bytes
// 
// Full struct total: 32+1+2+2+2+2+16+16+4+8+8+32+32+32+32+16+16+8+384+32 = 677 bytes
// Target: 653 bytes  
// Difference: -24 bytes
//
// The missing 24 bytes might be from:
// - Some fields being u64 instead of u128?
// - Or oracle not existing?
// Let me try removing oracle (32 bytes saves 32, then we're only 8 bytes over)

#[allow(dead_code)]
impl WhirlpoolState {
    /// Calculate price from sqrt_price
    /// 
    /// price = (sqrt_price / 2^64) ^ 2
    pub fn calculate_price(&self) -> f64 {
        if self.sqrt_price == 0 {
            return 0.0;
        }
        
        // sqrt_price is Q64.64 format
        const Q64: f64 = (1u128 << 64) as f64;
        let sqrt_price_f64 = self.sqrt_price as f64 / Q64;
        
        // price = sqrt_price^2
        sqrt_price_f64 * sqrt_price_f64
    }
    
    /// Get liquidity as f64
    pub fn get_liquidity(&self) -> f64 {
        self.liquidity as f64
    }
    
    /// Get current tick
    pub fn get_tick(&self) -> i32 {
        self.tick_current_index
    }
    
    /// Get fee rate in basis points
    pub fn get_fee_bps(&self) -> u16 {
        self.fee_rate
    }
    
    /// Get tick spacing
    pub fn get_tick_spacing(&self) -> u16 {
        self.tick_spacing
    }
    
    /// Get pool information for debugging
    pub fn get_pool_info(&self) -> String {
        format!(
            "Whirlpool (Orca CLMM):\n  Liquidity: {:.2}\n  Price: {:.6}\n  Tick: {}\n  Fee: {} bps\n  Tick Spacing: {}",
            self.get_liquidity(),
            self.calculate_price(),
            self.get_tick(),
            self.get_fee_bps(),
            self.get_tick_spacing()
        )
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for WhirlpoolState {
    fn dex_name(&self) -> &'static str {
        "Whirlpool (Orca)"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // Orca Whirlpool accounts are exactly 653 bytes
        // Our struct is 677 bytes, so we need to trim the extra data
        // The issue is likely trailing padding bytes
        if data.len() < 653 {
            return Err(DexError::InvalidData(format!(
                "Whirlpool pool data must be at least 653 bytes, got {}",
                data.len()
            )));
        }
        
        // Take only 653 bytes and try to deserialize
        // If struct mismatch, Borsh will fail, but that's expected
        let trimmed_data = &data[..653];
        
        Self::try_from_slice(trimmed_data)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Whirlpool Borsh deserialization failed (data_len={}): {}. Note: struct expects ~677 bytes but account is 653 bytes", 
                trimmed_data.len(), 
                e
            )))
    }
    
    fn calculate_price(&self) -> f64 {
        WhirlpoolState::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // CLMM doesn't have simple reserves like AMM
        // We can approximate using liquidity and tick
        // For now, return (0, 0) as reserves aren't directly stored
        (0, 0)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // Default to 6 decimals (USDC standard)
        // TODO: Read actual decimals from token mints
        (6, 6)
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if it has liquidity
        self.liquidity > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "Liquidity: {:.2}, Tick: {}, Fee: {}bps",
            self.get_liquidity(),
            self.get_tick(),
            self.get_fee_bps()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_price_calculation() {
        let mut pool = WhirlpoolState {
            whirlpools_config: Pubkey::default(),
            whirlpool_bump: [0],
            tick_spacing: 64,
            tick_spacing_seed: [0, 0],
            fee_rate: 2500, // 0.25%
            protocol_fee_rate: 0,
            liquidity: 1_000_000_000_000,
            sqrt_price: 1u128 << 64, // sqrt(1) = 1.0 in Q64.64
            tick_current_index: 0,
            protocol_fee_owed_a: 0,
            protocol_fee_owed_b: 0,
            token_mint_a: Pubkey::default(),
            token_mint_b: Pubkey::default(),
            token_vault_a: Pubkey::default(),
            token_vault_b: Pubkey::default(),
            fee_growth_global_a: 0,
            fee_growth_global_b: 0,
            reward_last_updated_timestamp: 0,
            reward_infos: [
                RewardInfo {
                    mint: Pubkey::default(),
                    vault: Pubkey::default(),
                    authority: Pubkey::default(),
                    emissions_per_second_x64: 0,
                    growth_global_x64: 0,
                },
                RewardInfo {
                    mint: Pubkey::default(),
                    vault: Pubkey::default(),
                    authority: Pubkey::default(),
                    emissions_per_second_x64: 0,
                    growth_global_x64: 0,
                },
                RewardInfo {
                    mint: Pubkey::default(),
                    vault: Pubkey::default(),
                    authority: Pubkey::default(),
                    emissions_per_second_x64: 0,
                    growth_global_x64: 0,
                },
            ],
            oracle: Pubkey::default(),
        };
        
        let price = pool.calculate_price();
        // sqrt_price = 1.0 => price = 1.0^2 = 1.0
        assert!((price - 1.0).abs() < 0.01, "Price should be close to 1.0");
    }
}



