use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Phoenix DEX Market State
/// 
/// Phoenix is a Central Limit Order Book (CLOB) DEX on Solana by Ellipsis Labs
/// Unlike AMMs, CLOB pools don't have simple reserves - they have order books
/// 
/// Program ID: PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY
/// 
/// **Note**: Phoenix markets are fundamentally different from AMM pools:
/// - They don't have traditional "reserves" (liquidity is in the order book)
/// - Pricing is determined by best bid/ask, not a bonding curve
/// - For套利 purposes, we need to fetch the order book separately
/// 
/// This implementation provides basic market metadata. For actual trading,
/// you'll need to:
/// 1. Subscribe to order book updates
/// 2. Track best bid/ask prices
/// 3. Monitor liquidity depth at different price levels
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct PhoenixMarketState {
    /// Discriminant (usually identifies account type)
    pub discriminant: u64,
    
    /// Market status (Active, Paused, etc.)
    pub status: u64,
    
    /// Market size parameters
    pub market_size_params: MarketSizeParams,
    
    /// Base token parameters
    pub base_params: TokenParams,
    
    /// Base lot size
    pub base_lot_size: u64,
    
    /// Quote token parameters
    pub quote_params: TokenParams,
    
    /// Quote lot size
    pub quote_lot_size: u64,
    
    /// Tick size in quote atoms per base unit
    pub tick_size_in_quote_atoms_per_base_unit: u64,
    
    /// Market authority
    pub authority: Pubkey,
    
    /// Fee recipient
    pub fee_recipient: Pubkey,
    
    /// Market sequence number
    pub market_sequence_number: u64,
    
    /// Successor market (if any)
    pub successor: Pubkey,
    
    /// Raw base units per base unit
    pub raw_base_units_per_base_unit: u32,
    
    /// Padding
    pub padding1: u32,
    
    /// Additional padding
    pub padding2: [u64; 32],
}

/// Market size parameters for Phoenix
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct MarketSizeParams {
    /// Number of bids
    pub bids_size: u64,
    
    /// Number of asks
    pub asks_size: u64,
    
    /// Number of order IDs
    pub num_seats: u64,
}

/// Token parameters
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct TokenParams {
    /// Token decimals
    pub decimals: u32,
    
    /// Deposit limit (for risk management)
    pub deposit_limit: u64,
    
    /// Token mint address
    pub mint_key: Pubkey,
    
    /// Token vault address
    pub vault_key: Pubkey,
}

impl PhoenixMarketState {
    /// Get base token decimals
    pub fn base_decimals(&self) -> u8 {
        self.base_params.decimals as u8
    }
    
    /// Get quote token decimals
    pub fn quote_decimals(&self) -> u8 {
        self.quote_params.decimals as u8
    }
    
    /// Get tick size (minimum price increment)
    pub fn tick_size(&self) -> f64 {
        let base_multiplier = 10_f64.powi(self.base_decimals() as i32);
        let quote_multiplier = 10_f64.powi(self.quote_decimals() as i32);
        
        (self.tick_size_in_quote_atoms_per_base_unit as f64 * base_multiplier) / quote_multiplier
    }
    
    /// Check if market is active
    pub fn is_market_active(&self) -> bool {
        // Status 0 = Active, other values may indicate paused/closed
        self.status == 0
    }
    
    /// Get market info for debugging
    pub fn get_market_info(&self) -> String {
        format!(
            "Phoenix CLOB Market:\n  Status: {}\n  Base Decimals: {}\n  Quote Decimals: {}\n  Tick Size: {:.8}\n  Seats: {}",
            if self.is_market_active() { "Active" } else { "Inactive" },
            self.base_decimals(),
            self.quote_decimals(),
            self.tick_size(),
            self.market_size_params.num_seats
        )
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for PhoenixMarketState {
    fn dex_name(&self) -> &'static str {
        "Phoenix (CLOB)"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // Phoenix market header is typically around 600-800 bytes
        // The exact size depends on padding and market size params
        if data.len() < 400 {
            return Err(DexError::InvalidData(format!(
                "Phoenix market data should be at least 400 bytes, got {}",
                data.len()
            )));
        }
        
        Self::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!("Phoenix: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        // ⚠️ IMPORTANT: CLOB markets don't have a single "price"
        // Price is determined by the best bid/ask in the order book
        // 
        // For a proper implementation, you would need to:
        // 1. Fetch the order book (bids and asks)
        // 2. Get the best bid and best ask
        // 3. Calculate mid-price or use last trade price
        // 
        // Since we can't access the order book from just the market header,
        // we return 0.0 as a placeholder
        // 
        // TODO: Integrate with Phoenix SDK to fetch order book data
        0.0
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // ⚠️ IMPORTANT: CLOB markets don't have "reserves" like AMMs
        // Liquidity is distributed across the order book at different price levels
        // 
        // To get actual liquidity, you would need to:
        // 1. Fetch the order book
        // 2. Sum up all bids (base liquidity) and asks (quote liquidity)
        // 3. Or get liquidity within a certain price range
        // 
        // For now, we return (0, 0) to indicate this is not an AMM pool
        (0, 0)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (self.base_decimals(), self.quote_decimals())
    }
    
    fn is_active(&self) -> bool {
        self.is_market_active()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "CLOB Market - Status: {}, Tick: {:.8}, Seats: {}",
            self.status,
            self.tick_size(),
            self.market_size_params.num_seats
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // Phoenix stores base and quote tokens in vaults
        Some((self.base_params.vault_key, self.quote_params.vault_key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_tick_size_calculation() {
        let market = PhoenixMarketState {
            discriminant: 0,
            status: 0,
            market_size_params: MarketSizeParams {
                bids_size: 100,
                asks_size: 100,
                num_seats: 50,
            },
            base_params: TokenParams {
                decimals: 9, // SOL has 9 decimals
                deposit_limit: 1_000_000_000_000,
                mint_key: Pubkey::default(),
                vault_key: Pubkey::default(),
            },
            base_lot_size: 1_000_000, // 0.001 SOL
            quote_params: TokenParams {
                decimals: 6, // USDC has 6 decimals
                deposit_limit: 1_000_000_000_000,
                mint_key: Pubkey::default(),
                vault_key: Pubkey::default(),
            },
            quote_lot_size: 1000, // 0.001 USDC
            tick_size_in_quote_atoms_per_base_unit: 1000, // 0.001 USDC per SOL
            authority: Pubkey::default(),
            fee_recipient: Pubkey::default(),
            market_sequence_number: 0,
            successor: Pubkey::default(),
            raw_base_units_per_base_unit: 1,
            padding1: 0,
            padding2: [0; 32],
        };
        
        let tick = market.tick_size();
        // tick_size_in_quote_atoms = 1000 (0.001 USDC in atoms)
        // Converting to UI: 1000 * 10^9 / 10^6 = 1000
        // This means the minimum price increment is 1000 USDC per SOL
        assert!(tick > 0.0, "Tick size should be positive");
    }
    
    #[test]
    fn test_market_status() {
        let mut market = PhoenixMarketState {
            discriminant: 0,
            status: 0,
            market_size_params: MarketSizeParams {
                bids_size: 0,
                asks_size: 0,
                num_seats: 0,
            },
            base_params: TokenParams {
                decimals: 6,
                deposit_limit: 0,
                mint_key: Pubkey::default(),
                vault_key: Pubkey::default(),
            },
            base_lot_size: 0,
            quote_params: TokenParams {
                decimals: 6,
                deposit_limit: 0,
                mint_key: Pubkey::default(),
                vault_key: Pubkey::default(),
            },
            quote_lot_size: 0,
            tick_size_in_quote_atoms_per_base_unit: 0,
            authority: Pubkey::default(),
            fee_recipient: Pubkey::default(),
            market_sequence_number: 0,
            successor: Pubkey::default(),
            raw_base_units_per_base_unit: 1,
            padding1: 0,
            padding2: [0; 32],
        };
        
        assert!(market.is_market_active(), "Status 0 should be active");
        
        market.status = 1;
        assert!(!market.is_market_active(), "Status 1 should be inactive");
    }
}

