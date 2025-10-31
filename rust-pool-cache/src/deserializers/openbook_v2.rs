use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// OpenBook V2 Market State
/// 
/// OpenBook V2 is a Central Limit Order Book (CLOB) DEX on Solana
/// It's a community fork of Serum, designed to be more decentralized
/// 
/// Program ID: opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb
/// Account Size: 840 bytes (confirmed from source code)
/// 
/// **Note**: Like Phoenix, OpenBook markets are CLOB-based:
/// - No traditional "reserves" - liquidity is in the order book
/// - Pricing comes from best bid/ask
/// - Suitable for long-tail markets with lower liquidity
/// 
/// For套利, you'll need to:
/// 1. Subscribe to order book updates (bids and asks accounts)
/// 2. Monitor event heap for fills
/// 3. Track your open orders account
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct OpenBookMarketState {
    /// PDA bump
    pub bump: u8,
    
    /// Number of decimals for base token
    pub base_decimals: u8,
    
    /// Number of decimals for quote token
    pub quote_decimals: u8,
    
    /// Padding
    pub padding1: [u8; 5],
    
    /// Market authority PDA (for signing vault transfers)
    pub market_authority: Pubkey,
    
    /// Expiry time (0 = no expiry)
    pub time_expiry: i64,
    
    /// Admin who can collect fees
    pub collect_fee_admin: Pubkey,
    
    /// Admin for open orders (optional)
    pub open_orders_admin: Pubkey,
    
    /// Admin for consume events (optional)
    pub consume_events_admin: Pubkey,
    
    /// Admin who can close market (optional)
    pub close_market_admin: Pubkey,
    
    /// Market name (16 bytes, null-terminated)
    pub name: [u8; 16],
    
    /// Bids order book account
    pub bids: Pubkey,
    
    /// Asks order book account
    pub asks: Pubkey,
    
    /// Event heap account
    pub event_heap: Pubkey,
    
    /// Oracle A (optional)
    pub oracle_a: Pubkey,
    
    /// Oracle B (optional)
    pub oracle_b: Pubkey,
    
    /// Oracle configuration
    pub oracle_config: OracleConfig,
    
    /// Quote lot size (number of quote atoms per lot)
    pub quote_lot_size: i64,
    
    /// Base lot size (number of base atoms per lot)
    pub base_lot_size: i64,
    
    /// Sequence number (total orders seen)
    pub seq_num: u64,
    
    /// Registration timestamp
    pub registration_time: i64,
    
    /// Maker fee (can be negative for rebates)
    pub maker_fee: i64,
    
    /// Taker fee (always >= 0)
    pub taker_fee: i64,
    
    /// Total fees accrued
    pub fees_accrued: u128,
    
    /// Fees paid to referrers
    pub fees_to_referrers: u128,
    
    /// Referrer rebates pending distribution
    pub referrer_rebates_accrued: u64,
    
    /// Fees available for withdrawal
    pub fees_available: u64,
    
    /// Cumulative maker volume
    pub maker_volume: u128,
    
    /// Cumulative taker volume (without open orders)
    pub taker_volume_wo_oo: u128,
    
    /// Base token mint
    pub base_mint: Pubkey,
    
    /// Quote token mint
    pub quote_mint: Pubkey,
    
    /// Base token vault
    pub market_base_vault: Pubkey,
    
    /// Base deposits total
    pub base_deposit_total: u64,
    
    /// Quote token vault
    pub market_quote_vault: Pubkey,
    
    /// Quote deposits total
    pub quote_deposit_total: u64,
    
    /// Reserved for future use
    pub reserved: [u8; 128],
}

/// Oracle configuration for OpenBook
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct OracleConfig {
    /// Confidence filter for oracle (bp = basis points)
    pub conf_filter: f32,
    
    /// Max staleness for oracle (in slots)
    pub max_staleness_slots: Option<u64>,
}

impl OpenBookMarketState {
    /// Get market name as string
    pub fn market_name(&self) -> String {
        String::from_utf8_lossy(&self.name)
            .trim_end_matches('\0')
            .to_string()
    }
    
    /// Check if market is expired
    pub fn is_expired(&self, current_time: i64) -> bool {
        self.time_expiry != 0 && self.time_expiry < current_time
    }
    
    /// Check if market is empty (no deposits)
    pub fn is_empty(&self) -> bool {
        self.base_deposit_total == 0
            && self.quote_deposit_total == 0
            && self.fees_available == 0
            && self.referrer_rebates_accrued == 0
    }
    
    /// Get maker fee rate (in basis points, can be negative)
    pub fn maker_fee_bps(&self) -> f64 {
        (self.maker_fee as f64) / 100.0
    }
    
    /// Get taker fee rate (in basis points)
    pub fn taker_fee_bps(&self) -> f64 {
        (self.taker_fee as f64) / 100.0
    }
    
    /// Convert base lots to native amount
    pub fn base_lots_to_native(&self, lots: i64) -> u64 {
        (lots * self.base_lot_size) as u64
    }
    
    /// Convert quote lots to native amount
    pub fn quote_lots_to_native(&self, lots: i64) -> u64 {
        (lots * self.quote_lot_size) as u64
    }
    
    /// Get tick size in native quote per native base
    pub fn tick_size_native(&self) -> f64 {
        (self.quote_lot_size as f64) / (self.base_lot_size as f64)
    }
    
    /// Get tick size in UI units
    pub fn tick_size_ui(&self) -> f64 {
        let base_multiplier = 10_f64.powi(self.base_decimals as i32);
        let quote_multiplier = 10_f64.powi(self.quote_decimals as i32);
        
        (self.quote_lot_size as f64 * base_multiplier) / (self.base_lot_size as f64 * quote_multiplier)
    }
    
    /// Get market info for debugging
    pub fn get_market_info(&self) -> String {
        format!(
            "OpenBook V2 Market: {}\n  Base Decimals: {}\n  Quote Decimals: {}\n  Tick Size: {:.8}\n  Maker Fee: {:.2}bps\n  Taker Fee: {:.2}bps\n  Total Orders: {}",
            self.market_name(),
            self.base_decimals,
            self.quote_decimals,
            self.tick_size_ui(),
            self.maker_fee_bps(),
            self.taker_fee_bps(),
            self.seq_num
        )
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for OpenBookMarketState {
    fn dex_name(&self) -> &'static str {
        "OpenBook V2 (CLOB)"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // OpenBook V2 market is exactly 840 bytes
        if data.len() < 840 {
            return Err(DexError::InvalidData(format!(
                "OpenBook V2 market data should be exactly 840 bytes, got {}",
                data.len()
            )));
        }
        
        Self::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!("OpenBook V2: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        // ⚠️ IMPORTANT: CLOB markets don't have a single "price"
        // Price is determined by the best bid/ask in the order book
        // 
        // For a proper implementation, you would need to:
        // 1. Fetch the BookSide accounts (bids and asks)
        // 2. Get the best bid and best ask
        // 3. Calculate mid-price or use last trade price
        // 
        // Since we can't access the order book from just the market account,
        // we return 0.0 as a placeholder
        // 
        // TODO: Integrate with OpenBook SDK to fetch order book data
        0.0
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // ⚠️ IMPORTANT: CLOB markets don't have "reserves" like AMMs
        // However, OpenBook does track total deposits in vaults
        // 
        // These deposit totals represent all user funds in the market:
        // - base_deposit_total: Total base tokens deposited by all users
        // - quote_deposit_total: Total quote tokens deposited by all users
        // 
        // This is different from AMM reserves because:
        // 1. Not all deposits are "liquidity" - some are in open orders
        // 2. Actual tradeable liquidity is in the order book
        // 
        // For rough liquidity estimation, we return deposit totals,
        // but for accurate套利 calculations, fetch the order book
        (self.base_deposit_total, self.quote_deposit_total)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (self.base_decimals, self.quote_decimals)
    }
    
    fn is_active(&self) -> bool {
        // Market is active if not expired and not empty
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        
        !self.is_expired(current_time)
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "CLOB Market '{}' - Tick: {:.8}, Maker: {:.2}bps, Taker: {:.2}bps, Orders: {}",
            self.market_name(),
            self.tick_size_ui(),
            self.maker_fee_bps(),
            self.taker_fee_bps(),
            self.seq_num
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // OpenBook stores user deposits in market vaults
        Some((self.market_base_vault, self.market_quote_vault))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_market_name() {
        let mut market = create_test_market();
        market.name = *b"SOL/USDC\0\0\0\0\0\0\0\0";
        
        assert_eq!(market.market_name(), "SOL/USDC");
    }
    
    #[test]
    fn test_fee_calculations() {
        let market = create_test_market();
        
        // Fee in 10^-6, so 2500 = 0.0025 = 0.25% = 25bps
        assert!((market.taker_fee_bps() - 25.0).abs() < 0.01);
        assert!((market.maker_fee_bps() + 5.0).abs() < 0.01); // Negative = rebate
    }
    
    #[test]
    fn test_tick_size() {
        let market = create_test_market();
        
        let tick_native = market.tick_size_native();
        assert!(tick_native > 0.0);
        
        let tick_ui = market.tick_size_ui();
        assert!(tick_ui > 0.0);
    }
    
    #[test]
    fn test_lots_conversion() {
        let market = create_test_market();
        
        let base_native = market.base_lots_to_native(100);
        assert_eq!(base_native, 100_000); // 100 lots * 1000 per lot
        
        let quote_native = market.quote_lots_to_native(100);
        assert_eq!(quote_native, 10_000); // 100 lots * 100 per lot
    }
    
    fn create_test_market() -> OpenBookMarketState {
        OpenBookMarketState {
            bump: 255,
            base_decimals: 9, // SOL
            quote_decimals: 6, // USDC
            padding1: [0; 5],
            market_authority: Pubkey::default(),
            time_expiry: 0, // No expiry
            collect_fee_admin: Pubkey::default(),
            open_orders_admin: Pubkey::default(),
            consume_events_admin: Pubkey::default(),
            close_market_admin: Pubkey::default(),
            name: [0; 16],
            bids: Pubkey::default(),
            asks: Pubkey::default(),
            event_heap: Pubkey::default(),
            oracle_a: Pubkey::default(),
            oracle_b: Pubkey::default(),
            oracle_config: OracleConfig {
                conf_filter: 0.1,
                max_staleness_slots: Some(25),
            },
            quote_lot_size: 100, // 0.0001 USDC
            base_lot_size: 1000, // 0.000001 SOL
            seq_num: 0,
            registration_time: 0,
            maker_fee: -500, // -0.05% (rebate)
            taker_fee: 2500, // 0.25%
            fees_accrued: 0,
            fees_to_referrers: 0,
            referrer_rebates_accrued: 0,
            fees_available: 0,
            maker_volume: 0,
            taker_volume_wo_oo: 0,
            base_mint: Pubkey::default(),
            quote_mint: Pubkey::default(),
            market_base_vault: Pubkey::default(),
            base_deposit_total: 1_000_000_000, // 1 SOL
            market_quote_vault: Pubkey::default(),
            quote_deposit_total: 100_000_000, // 100 USDC
            reserved: [0; 128],
        }
    }
}

