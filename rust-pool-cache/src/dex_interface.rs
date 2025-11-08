use std::fmt;
use solana_sdk::pubkey::Pubkey;

/// Unified interface for all DEX pool types
/// 
/// This trait defines the common operations that all DEX pools must support,
/// enabling a plugin-like architecture where new DEX types can be added
/// without modifying core WebSocket handling logic.
pub trait DexPool: Send + Sync {
    /// Get the DEX name (e.g., "Raydium AMM V4", "Orca Whirlpool")
    fn dex_name(&self) -> &'static str;
    
    /// Deserialize pool state from account data
    /// 
    /// This is the main entry point for creating a pool instance from raw bytes.
    /// Each DEX implements its own deserialization logic.
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized;
    
    /// Calculate the current price (quote/base)
    /// 
    /// Returns the price as a floating point number, with decimals already adjusted.
    fn calculate_price(&self) -> f64;
    
    /// Get the reserve amounts (base_reserve, quote_reserve)
    /// 
    /// Returns raw amounts in the smallest units (lamports, etc.)
    fn get_reserves(&self) -> (u64, u64);
    
    /// Get the decimal places for base and quote tokens
    /// 
    /// Returns (base_decimals, quote_decimals)
    fn get_decimals(&self) -> (u8, u8);
    
    /// Check if the pool is active and ready for trading
    fn is_active(&self) -> bool;
    
    /// Get additional pool-specific information for logging (optional)
    fn get_additional_info(&self) -> Option<String> {
        None
    }
    
    /// Get vault addresses for pools that store reserves in external vault accounts
    /// 
    /// Some DEXs (like SolFi V2, GoonFi) don't store reserve amounts directly in the pool account.
    /// Instead, they store them in separate SPL Token accounts (vaults).
    /// 
    /// This method allows the pool to expose these vault addresses so the system can:
    /// 1. Subscribe to vault account updates via WebSocket
    /// 2. Read actual reserve amounts from the vaults
    /// 3. Calculate accurate prices
    /// 
    /// # Returns
    /// * `Some((vault_a, vault_b))` - The addresses of the token vaults
    /// * `None` - Pool stores reserves directly (no external vaults needed)
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        None // Default: no external vaults
    }
}

/// Errors that can occur during DEX pool operations
#[derive(Debug, Clone)]
pub enum DexError {
    /// Failed to deserialize account data
    DeserializationFailed(String),
    
    /// Invalid or corrupted data
    InvalidData(String),
    
    /// Pool is not active or not open for trading
    #[allow(dead_code)]
    PoolNotActive,
    
    /// Unknown pool type
    UnknownPoolType(String),
    
    /// Data length mismatch
    #[allow(dead_code)]
    DataLengthMismatch { expected: usize, actual: usize },
    
    /// Validation failed (e.g., struct size mismatch)
    ValidationFailed(String),
}

impl fmt::Display for DexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DexError::DeserializationFailed(msg) => {
                write!(f, "Deserialization failed: {}", msg)
            }
            DexError::InvalidData(msg) => {
                write!(f, "Invalid data: {}", msg)
            }
            DexError::PoolNotActive => {
                write!(f, "Pool is not active")
            }
            DexError::UnknownPoolType(pool_type) => {
                write!(f, "Unknown pool type: {}", pool_type)
            }
            DexError::DataLengthMismatch { expected, actual } => {
                write!(f, "Data length mismatch: expected {}, got {}", expected, actual)
            }
            DexError::ValidationFailed(msg) => {
                write!(f, "Validation failed: {}", msg)
            }
        }
    }
}

impl std::error::Error for DexError {}

/// AMM Swap Calculator - Precise constant product formula (x * y = k)
/// 
/// Implements the exact swap calculation used by Uniswap V2, Raydium, Orca, and most AMM DEXs.
/// This eliminates the 2-5% error from linear price approximation.
pub mod amm_calculator {
    /// Calculate exact output amount using constant product formula
    /// 
    /// Formula: amount_out = (amount_in × (1 - fee) × reserve_out) / (reserve_in + amount_in × (1 - fee))
    /// 
    /// # Arguments
    /// * `amount_in` - Input amount in smallest units (lamports, etc.)
    /// * `reserve_in` - Input token reserve in the pool
    /// * `reserve_out` - Output token reserve in the pool
    /// * `fee_numerator` - Fee numerator (e.g., 25 for 0.25%)
    /// * `fee_denominator` - Fee denominator (typically 10000)
    /// 
    /// # Returns
    /// Exact output amount after fees and slippage
    /// 
    /// # Example
    /// ```
    /// // Swap 1 SOL (1e9 lamports) in a pool with 1000 SOL and 185000 USDC
    /// // Fee = 0.25% (25/10000)
    /// let output = calculate_amm_output(
    ///     1_000_000_000,      // 1 SOL input
    ///     1000_000_000_000,   // 1000 SOL reserve
    ///     185_000_000_000,    // 185000 USDC reserve
    ///     25,                 // 0.25% fee
    ///     10000
    /// );
    /// // Output ≈ 184,815,000 (184.815 USDC after slippage)
    /// ```
    pub fn calculate_amm_output(
        amount_in: u64,
        reserve_in: u64,
        reserve_out: u64,
        fee_numerator: u64,
        fee_denominator: u64,
    ) -> u64 {
        if amount_in == 0 || reserve_in == 0 || reserve_out == 0 {
            return 0;
        }
        
        // amount_in_with_fee = amount_in × (fee_denominator - fee_numerator)
        let amount_in_with_fee = (amount_in as u128) * ((fee_denominator - fee_numerator) as u128);
        
        // numerator = amount_in_with_fee × reserve_out
        let numerator = amount_in_with_fee * (reserve_out as u128);
        
        // denominator = reserve_in × fee_denominator + amount_in_with_fee
        let denominator = (reserve_in as u128) * (fee_denominator as u128) + amount_in_with_fee;
        
        // Return amount_out
        (numerator / denominator) as u64
    }
    
    /// Calculate exact output in f64 format (for routing algorithms)
    /// 
    /// This is a convenience wrapper that works with floating point amounts,
    /// automatically handling decimal conversions.
    /// 
    /// # Arguments
    /// * `amount_in` - Input amount (e.g., 1.0 SOL)
    /// * `reserve_in` - Input reserve (e.g., 1000.0 SOL)
    /// * `reserve_out` - Output reserve (e.g., 185000.0 USDC)
    /// * `fee_rate` - Fee as decimal (e.g., 0.0025 for 0.25%)
    /// 
    /// # Returns
    /// Exact output amount
    pub fn calculate_amm_output_f64(
        amount_in: f64,
        reserve_in: f64,
        reserve_out: f64,
        fee_rate: f64,
    ) -> f64 {
        if amount_in <= 0.0 || reserve_in <= 0.0 || reserve_out <= 0.0 {
            return 0.0;
        }
        
        let amount_in_with_fee = amount_in * (1.0 - fee_rate);
        let numerator = amount_in_with_fee * reserve_out;
        let denominator = reserve_in + amount_in_with_fee;
        
        numerator / denominator
    }
    
    /// Get standard DEX fee rates
    pub fn get_dex_fee_rate(dex_name: &str) -> f64 {
        match dex_name.to_lowercase().as_str() {
            "raydium" | "raydium amm v4" | "raydium_v4" | "amm_v4" => 0.0025,  // 0.25%
            "orca" | "orca whirlpool" | "whirlpool" => 0.003,                   // 0.30%
            "lifinity" | "lifinity v2" => 0.0,                                  // 0% (Market Maker model)
            "meteora" | "meteora dlmm" => 0.0025,                               // 0.25%
            "phoenix" | "openbook" | "openbook_v2" => 0.0,                      // 0% taker (CLOB)
            "pancakeswap" | "pcs" => 0.0025,                                    // 0.25%
            "aldrin" => 0.002,                                                  // 0.20%
            "saber" => 0.0004,                                                  // 0.04% (stableswap)
            _ => 0.003,                                                         // Default 0.30%
        }
    }
    
    #[cfg(test)]
    mod tests {
        use super::*;
        
        #[test]
        fn test_amm_output_calculation() {
            // Test case: 1 SOL in a 1000 SOL / 185000 USDC pool with 0.25% fee
            let output = calculate_amm_output(
                1_000_000_000,        // 1 SOL
                1000_000_000_000,     // 1000 SOL reserve
                185_000_000_000,      // 185000 USDC reserve
                25,                   // 0.25% fee
                10000,
            );
            
            // Expected: ~184.35 USDC (with 0.25% fee and slippage)
            assert!(output >= 184_300_000 && output <= 184_400_000);
        }
        
        #[test]
        fn test_amm_output_f64() {
            let output = calculate_amm_output_f64(
                1.0,        // 1 SOL
                1000.0,     // 1000 SOL reserve
                185000.0,   // 185000 USDC reserve
                0.0025,     // 0.25% fee
            );
            
            // Expected: ~184.35 USDC
            assert!(output >= 184.3 && output <= 184.4);
        }
        
        #[test]
        fn test_zero_slippage_small_trade() {
            // Very small trade should have minimal slippage
            let output = calculate_amm_output_f64(
                0.01,       // 0.01 SOL (tiny)
                1000.0,     // 1000 SOL reserve
                185000.0,   // 185000 USDC reserve
                0.0025,
            );
            
            // Should be very close to 1.8454 USDC (0.01 * 185 * 0.9975 / 1000.01)
            assert!(output >= 1.844 && output <= 1.847);
        }
        
        #[test]
        fn test_high_slippage_large_trade() {
            // Large trade should have significant slippage
            let output = calculate_amm_output_f64(
                100.0,      // 100 SOL (10% of pool)
                1000.0,     // 1000 SOL reserve
                185000.0,   // 185000 USDC reserve
                0.0025,
            );
            
            // Linear would give: 100 × 185 = 18500 USDC
            // AMM gives less due to slippage: ~16,800 USDC
            assert!(output >= 16_700.0 && output <= 16_900.0);
            
            // Verify slippage is ~9%
            let linear_output = 100.0 * 185.0;
            let slippage_pct = ((linear_output - output) / linear_output) * 100.0;
            assert!(slippage_pct >= 8.0 && slippage_pct <= 10.0);
        }
    }
}







