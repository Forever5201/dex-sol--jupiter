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







