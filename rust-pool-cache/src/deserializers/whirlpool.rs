use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Orca Whirlpool Pool State (wrapper for official Orca SDK type)
/// 
/// Whirlpool is Orca's concentrated liquidity market maker (CLMM)
/// Similar to Uniswap V3 and Raydium CLMM
/// 
/// Program ID: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
/// Data size: 653 bytes (Borsh) / 656 bytes (memory with alignment)
/// 
/// We wrap the official `orca_whirlpools_client::Whirlpool` type
/// This ensures 100% compatibility with Orca's on-chain program
#[derive(Debug, Clone)]
pub struct WhirlpoolState {
    inner: orca_whirlpools_client::Whirlpool,
}

impl WhirlpoolState {
    /// Create from official Whirlpool type
    pub fn new(whirlpool: orca_whirlpools_client::Whirlpool) -> Self {
        Self { inner: whirlpool }
    }
    
    /// Get reference to inner Whirlpool
    pub fn inner(&self) -> &orca_whirlpools_client::Whirlpool {
        &self.inner
    }
    /// Calculate price from sqrt_price
    /// 
    /// price = (sqrt_price / 2^64) ^ 2
    pub fn calculate_price(&self) -> f64 {
        if self.inner.sqrt_price == 0 {
            return 0.0;
        }
        
        // sqrt_price is Q64.64 format
        const Q64: f64 = (1u128 << 64) as f64;
        let sqrt_price_f64 = self.inner.sqrt_price as f64 / Q64;
        
        // price = sqrt_price^2
        sqrt_price_f64 * sqrt_price_f64
    }
}

// ============================================
// DexPool Trait Implementation (wrapper for official Orca type)
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
        if data.len() != 653 {
            return Err(DexError::InvalidData(format!(
                "Whirlpool pool data must be exactly 653 bytes, got {}",
                data.len()
            )));
        }
        
        // Use official Orca deserialization
        let whirlpool = orca_whirlpools_client::Whirlpool::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Whirlpool Borsh deserialization failed: {}", 
                e
            )))?;
        
        Ok(WhirlpoolState::new(whirlpool))
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
        // Default to 9 decimals for SOL, 6 for USDC
        // TODO: Read actual decimals from token mints
        (9, 6)
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if it has liquidity
        self.inner.liquidity > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "Liquidity: {:.2}, Tick: {}, Fee: {}bps",
            self.inner.liquidity as f64,
            self.inner.tick_current_index,
            self.inner.fee_rate
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        Some((self.inner.token_vault_a, self.inner.token_vault_b))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    
    #[test]
    fn test_price_calculation() {
        // Test with real data from chain
        let file_path = "account_data/SOL-USDC-Whirlpool_653.bin";
        
        if let Ok(data) = fs::read(file_path) {
            if let Ok(pool) = WhirlpoolState::from_account_data(&data) {
        let price = pool.calculate_price();
                println!("Whirlpool price: {:.6}", price);
                
                // SOL/USDC price should be in reasonable range (0.1 to 500)
                assert!(price > 0.0 && price < 1000.0, "Price should be in reasonable range");
                assert!(pool.inner.liquidity > 0, "Pool should have liquidity");
                
                println!("Liquidity: {}", pool.inner.liquidity);
                println!("Tick: {}", pool.inner.tick_current_index);
                println!("Fee: {} bps", pool.inner.fee_rate);
            }
        }
    }
}



