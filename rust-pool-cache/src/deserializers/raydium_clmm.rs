use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Raydium CLMM (Concentrated Liquidity Market Maker) Pool State
/// 
/// CLMM pools use concentrated liquidity similar to Uniswap V3
/// Data length: 1544 bytes (verified from on-chain data 2025-10-28)
/// 
/// Note: Previous assumption of 1728 bytes was incorrect.
/// Actual structure is 184 bytes smaller.
#[derive(Debug, Clone, BorshSerialize, BorshDeserialize)]
pub struct RaydiumClmmPoolState {
    /// Bump seed for PDA
    pub bump: [u8; 1],
    
    /// AMM configuration (similar to AMM V4)
    pub amm_config: Pubkey,
    
    /// Pool creator
    pub owner: Pubkey,
    
    /// Token vault A
    pub token_vault_0: Pubkey,
    
    /// Token vault B  
    pub token_vault_1: Pubkey,
    
    /// LP mint for this pool
    pub lp_mint: Pubkey,
    
    /// Token mint A
    pub token_mint_0: Pubkey,
    
    /// Token mint B
    pub token_mint_1: Pubkey,
    
    /// Token program for vault A
    pub token_program_0: Pubkey,
    
    /// Token program for vault B
    pub token_program_1: Pubkey,
    
    /// Observation account
    pub observation_key: Pubkey,
    
    /// Protocol fees
    pub protocol_fees_token_0: u64,
    pub protocol_fees_token_1: u64,
    
    /// Swap fees
    pub swap_in_amount_token_0: u128,
    pub swap_out_amount_token_1: u128,
    pub swap_in_amount_token_1: u128,
    pub swap_out_amount_token_0: u128,
    
    /// Pool status
    pub status: u8,
    
    /// Pool status bit flags
    pub status_bit_flag: u8,
    
    /// Token decimals
    pub mint_decimals_0: u8,
    pub mint_decimals_1: u8,
    
    /// Tick spacing (for price ranges)
    pub tick_spacing: u16,
    
    /// Padding for alignment (2 bytes)
    pub _padding0: u16,
    
    /// Liquidity
    pub liquidity: u128,
    
    /// Current tick (price)
    pub tick_current: i32,
    
    /// Protocol fee rate
    pub protocol_fee_rate: u32,
    
    /// Trading fee rate
    pub trade_fee_rate: u32,
    
    /// Tick array bitmap extension
    pub tick_array_bitmap: [u64; 16],
    
    /// Total fees token A
    pub total_fees_token_0: u64,
    
    /// Total fees claimed token A
    pub total_fees_claimed_token_0: u64,
    
    /// Total fees token B
    pub total_fees_token_1: u64,
    
    /// Total fees claimed token B
    pub total_fees_claimed_token_1: u64,
    
    /// Fund fees token A
    pub fund_fees_token_0: u64,
    
    /// Fund fees token B
    pub fund_fees_token_1: u64,
    
    /// Open time
    pub open_time: u64,
    
    /// Recent epoch
    pub recent_epoch: u64,
    
    /// Padding/reserved space  
    /// Actual size calculation:
    /// - bump: 1
    /// - 10 Pubkeys: 320
    /// - protocol_fees: 16
    /// - swap amounts (4 u128): 64
    /// - status fields: 2
    /// - decimals: 2
    /// - tick_spacing: 2
    /// - _padding0: 2
    /// - liquidity: 16
    /// - tick_current: 4
    /// - fee rates: 8
    /// - tick_array_bitmap: 128
    /// - fees fields: 48
    /// - time fields: 16
    /// Total so far: 629 bytes
    /// Target: 1544 bytes
    /// Padding needed: 1544 - 629 = 915 bytes
    /// 
    /// 🚨 Critical fix: Use byte array instead of u64 array
    /// Borsh deserialization requires exact byte-level matching
    /// u64 arrays have alignment requirements that may not match on-chain layout
    pub padding: [u8; 915],
}

#[allow(dead_code)]
impl RaydiumClmmPoolState {
    /// Calculate price from tick
    /// In CLMM, price = 1.0001^tick
    pub fn calculate_price(&self) -> f64 {
        let tick = self.tick_current as f64;
        // Price = 1.0001^tick
        let price = 1.0001_f64.powf(tick);
        
        // Adjust for decimals
        let decimal_adjustment = 10_f64.powi(
            self.mint_decimals_1 as i32 - self.mint_decimals_0 as i32
        );
        
        price * decimal_adjustment
    }
    
    /// Get effective reserves based on current liquidity
    /// This is an approximation as CLMM doesn't have traditional reserves
    pub fn get_effective_reserves(&self) -> (f64, f64) {
        let liquidity = self.liquidity as f64;
        let price = self.calculate_price();
        
        // Approximate reserves from liquidity and price
        // reserve_0 ≈ L / sqrt(P)
        // reserve_1 ≈ L * sqrt(P)
        let sqrt_price = price.sqrt();
        
        let base_reserve = liquidity / sqrt_price;
        let quote_reserve = liquidity * sqrt_price;
        
        // Adjust for decimals
        let base_reserve = base_reserve / 10_f64.powi(self.mint_decimals_0 as i32);
        let quote_reserve = quote_reserve / 10_f64.powi(self.mint_decimals_1 as i32);
        
        (base_reserve, quote_reserve)
    }
    
    /// Check if pool is open for trading
    pub fn is_open(&self) -> bool {
        self.status == 1 && self.open_time > 0
    }
    
    /// Get pool type identifier
    pub fn pool_type() -> &'static str {
        "Raydium CLMM"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_price_calculation() {
        let pool = RaydiumClmmPoolState {
            bump: [1],
            amm_config: Pubkey::default(),
            owner: Pubkey::default(),
            token_vault_0: Pubkey::default(),
            token_vault_1: Pubkey::default(),
            lp_mint: Pubkey::default(),
            token_mint_0: Pubkey::default(),
            token_mint_1: Pubkey::default(),
            token_program_0: Pubkey::default(),
            token_program_1: Pubkey::default(),
            observation_key: Pubkey::default(),
            protocol_fees_token_0: 0,
            protocol_fees_token_1: 0,
            swap_in_amount_token_0: 0,
            swap_out_amount_token_1: 0,
            swap_in_amount_token_1: 0,
            swap_out_amount_token_0: 0,
            status: 1,
            status_bit_flag: 0,
            mint_decimals_0: 9,
            mint_decimals_1: 6,
            tick_spacing: 10,
            _padding0: 0,
            liquidity: 1_000_000_000_000,
            tick_current: 0,
            protocol_fee_rate: 300,
            trade_fee_rate: 2500,
            tick_array_bitmap: [0; 16],
            total_fees_token_0: 0,
            total_fees_claimed_token_0: 0,
            total_fees_token_1: 0,
            total_fees_claimed_token_1: 0,
            fund_fees_token_0: 0,
            fund_fees_token_1: 0,
            open_time: 1000000,
            recent_epoch: 0,
            padding: [0; 915],
        };
        
        let price = pool.calculate_price();
        // At tick=0, price should be 1.0 (adjusted for decimals)
        assert!((price - 1000.0).abs() < 0.1);
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for RaydiumClmmPoolState {
    fn dex_name(&self) -> &'static str {
        "Raydium CLMM"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        Self::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!("Raydium CLMM: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        self.calculate_price()
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // For CLMM, we approximate reserves from liquidity
        // This is not accurate but provides a rough estimate
        let liquidity = self.liquidity as f64;
        let price = self.calculate_price();
        let sqrt_price = price.sqrt();
        
        let reserve_0 = (liquidity / sqrt_price) as u64;
        let reserve_1 = (liquidity * sqrt_price) as u64;
        
        (reserve_0, reserve_1)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (self.mint_decimals_0, self.mint_decimals_1)
    }
    
    fn is_active(&self) -> bool {
        // CLMM池子只要有liquidity就是active
        // 不依赖status字段，因为有些池子status可能不是标准值
        // 但仍然有流动性和正常交易
        self.liquidity > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "Tick: {}, Liquidity: {}, Price: {:.6}",
            self.tick_current,
            self.liquidity,
            self.calculate_price()
        ))
    }
}

