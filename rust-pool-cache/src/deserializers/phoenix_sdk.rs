/// Phoenix Market Integration using Official SDK
/// 
/// This module provides proper Phoenix CLOB market integration by using
/// the official Phoenix SDK to parse Market + OrderBook data.
/// 
/// Architecture:
/// ```
/// Phoenix Market Account = [MarketHeader | OrderBook | TraderState]
///                          ↓             ↓
///                      Metadata    Load with SDK
/// ```

use std::mem::size_of;
use std::collections::BTreeMap;
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

// Phoenix SDK dependencies
// These would need to be added to Cargo.toml:
// phoenix = "0.4"
// phoenix-sdk-core = { path = "../temp_phoenix/rust/crates/phoenix-sdk-core" }
// bytemuck = "1.14"

// For now, we'll provide a placeholder implementation that can be completed
// once Phoenix SDK is added as a dependency

// 条件编译：如果phoenix crate可用，使用完整SDK
#[cfg(feature = "phoenix-sdk")]
use phoenix::program::MarketHeader;
#[cfg(feature = "phoenix-sdk")]
use phoenix::program::dispatch_market::load_with_dispatch;

/// Phoenix Market with SDK Integration
/// 
/// This struct uses Phoenix SDK's load_with_dispatch() to properly
/// parse the complete market data including the order book.
#[derive(Debug, Clone)]
pub struct PhoenixMarketSDK {
    /// Market metadata extracted from header
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_decimals: u32,
    pub quote_decimals: u32,
    
    /// Tick size in quote atoms per base unit
    pub tick_size_in_quote_atoms_per_base_unit: u64,
    
    /// Lot sizes
    pub base_atoms_per_base_lot: u64,
    pub quote_atoms_per_quote_lot: u64,
    
    /// Raw base units per base unit (usually 1)
    pub raw_base_units_per_base_unit: u32,
    
    /// Number of base lots per base unit
    pub num_base_lots_per_base_unit: u64,
    
    /// Best bid and ask prices (cached from orderbook)
    pub best_bid: Option<f64>,
    pub best_ask: Option<f64>,
    
    /// Total liquidity in orderbook (base atoms)
    pub bid_liquidity: u64,
    pub ask_liquidity: u64,
    
    /// Market active status
    pub is_active: bool,
}

impl PhoenixMarketSDK {
    /// Parse Phoenix market from account data
    /// 
    /// This method extracts the MarketHeader and calculates metadata.
    /// A full implementation would use phoenix::program::dispatch_market::load_with_dispatch()
    /// to parse the complete orderbook.
    pub fn from_account_data(data: &[u8]) -> Result<Self, DexError> {
        // Minimum size check
        if data.len() < 400 {
            return Err(DexError::InvalidData(format!(
                "Phoenix market data too small: {} bytes (expected 400+)",
                data.len()
            )));
        }
        
        // TODO: This is a simplified version. Full implementation would:
        // 1. Split at size_of::<MarketHeader>()
        // 2. Parse header with bytemuck::try_from_bytes::<MarketHeader>()
        // 3. Load market with phoenix::program::dispatch_market::load_with_dispatch()
        // 4. Build orderbook with phoenix_sdk_core::orderbook::Orderbook::from_market()
        // 5. Extract best bid/ask from orderbook
        
        // For now, return a placeholder error indicating SDK integration needed
        Err(DexError::DeserializationFailed(
            "Phoenix SDK integration required. Please add phoenix and phoenix-sdk-core dependencies.".to_string()
        ))
    }
    
    /// Calculate quote units per raw base unit per tick
    fn quote_units_per_raw_base_unit_per_tick(&self) -> f64 {
        self.tick_size_in_quote_atoms_per_base_unit as f64
            / (10_f64.powi(self.quote_decimals as i32) * self.raw_base_units_per_base_unit as f64)
    }
    
    /// Calculate raw base units per base lot
    fn raw_base_units_per_base_lot(&self) -> f64 {
        self.base_atoms_per_base_lot as f64 / 10_f64.powi(self.base_decimals as i32)
    }
}

impl DexPool for PhoenixMarketSDK {
    fn dex_name(&self) -> &'static str {
        "Phoenix (CLOB-SDK)"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        Self::from_account_data(data)
    }
    
    fn calculate_price(&self) -> f64 {
        // Calculate mid-price from best bid and ask
        match (self.best_bid, self.best_ask) {
            (Some(bid), Some(ask)) => (bid + ask) / 2.0,
            (Some(bid), None) => bid,
            (None, Some(ask)) => ask,
            (None, None) => 0.0,
        }
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // For CLOB markets, "reserves" represent total orderbook liquidity
        (self.bid_liquidity, self.ask_liquidity)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (self.base_decimals as u8, self.quote_decimals as u8)
    }
    
    fn is_active(&self) -> bool {
        self.is_active && self.best_bid.is_some() && self.best_ask.is_some()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let spread = match (self.best_bid, self.best_ask) {
            (Some(bid), Some(ask)) => ((ask - bid) / bid * 100.0),
            _ => 0.0,
        };
        
        Some(format!(
            "Phoenix CLOB - Bid: {:.6} Ask: {:.6} Spread: {:.4}% BidLiq: {} AskLiq: {}",
            self.best_bid.unwrap_or(0.0),
            self.best_ask.unwrap_or(0.0),
            spread,
            self.bid_liquidity,
            self.ask_liquidity
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // Phoenix vault addresses would be derived from market PDA
        // Would need full SDK integration to calculate
        None
    }
}

// ============================================
// Full SDK Integration Template
// ============================================

/*
// This is the complete implementation using Phoenix SDK
// To enable this, add to Cargo.toml:
//
// [dependencies]
// phoenix = "0.4"
// phoenix-sdk-core = { path = "../temp_phoenix/rust/crates/phoenix-sdk-core" }
// bytemuck = "1.14"

use phoenix::program::MarketHeader;
use phoenix::program::dispatch_market::load_with_dispatch;
use phoenix_sdk_core::orderbook::Orderbook;
use phoenix_sdk_core::sdk_client_core::MarketMetadata;
use phoenix::state::markets::FIFOOrderId;
use phoenix_sdk_core::sdk_client_core::PhoenixOrder;

impl PhoenixMarketSDK {
    pub fn from_account_data_full(data: &[u8]) -> Result<Self, DexError> {
        // Step 1: Split header and orderbook bytes
        let header_size = size_of::<MarketHeader>();
        if data.len() < header_size {
            return Err(DexError::InvalidData(format!(
                "Phoenix data too small: {} bytes (expected {}+)",
                data.len(), header_size
            )));
        }
        
        let (header_bytes, orderbook_bytes) = data.split_at(header_size);
        
        // Step 2: Parse header
        let header: &MarketHeader = bytemuck::try_from_bytes(header_bytes)
            .map_err(|e| DexError::DeserializationFailed(format!("Phoenix header: {}", e)))?;
        
        // Step 3: Extract metadata
        let metadata = MarketMetadata::from_header(header)
            .map_err(|e| DexError::InvalidData(format!("Phoenix metadata: {}", e)))?;
        
        // Step 4: Load market with dispatch
        let market = load_with_dispatch(&metadata.market_size_params, orderbook_bytes)
            .map_err(|e| DexError::DeserializationFailed(format!("Phoenix market: {}", e)))?;
        
        // Step 5: Build orderbook
        let orderbook = Orderbook::from_market(
            market.inner,
            metadata.raw_base_units_per_base_lot(),
            metadata.quote_units_per_raw_base_unit_per_tick(),
        );
        
        // Step 6: Extract best prices
        let bids = orderbook.get_bids();
        let asks = orderbook.get_asks();
        
        let best_bid = bids.first().map(|(price, _)| {
            price.price() * metadata.quote_units_per_raw_base_unit_per_tick()
        });
        
        let best_ask = asks.first().map(|(price, _)| {
            price.price() * metadata.quote_units_per_raw_base_unit_per_tick()
        });
        
        // Step 7: Calculate total liquidity
        let bid_liquidity: u64 = bids.iter()
            .map(|(_, order)| order.num_base_lots)
            .sum();
        let bid_liquidity = metadata.base_lots_to_base_atoms(bid_liquidity);
        
        let ask_liquidity: u64 = asks.iter()
            .map(|(_, order)| order.num_base_lots)
            .sum();
        let ask_liquidity = metadata.base_lots_to_base_atoms(ask_liquidity);
        
        // Step 8: Build result
        Ok(PhoenixMarketSDK {
            base_mint: metadata.base_mint,
            quote_mint: metadata.quote_mint,
            base_decimals: metadata.base_decimals,
            quote_decimals: metadata.quote_decimals,
            tick_size_in_quote_atoms_per_base_unit: metadata.tick_size_in_quote_atoms_per_base_unit,
            base_atoms_per_base_lot: metadata.base_atoms_per_base_lot,
            quote_atoms_per_quote_lot: metadata.quote_atoms_per_quote_lot,
            raw_base_units_per_base_unit: metadata.raw_base_units_per_base_unit,
            num_base_lots_per_base_unit: metadata.num_base_lots_per_base_unit,
            best_bid,
            best_ask,
            bid_liquidity,
            ask_liquidity,
            is_active: best_bid.is_some() && best_ask.is_some(),
        })
    }
}
*/

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_price_calculation() {
        let market = PhoenixMarketSDK {
            base_mint: Pubkey::default(),
            quote_mint: Pubkey::default(),
            base_decimals: 9,
            quote_decimals: 6,
            tick_size_in_quote_atoms_per_base_unit: 1000,
            base_atoms_per_base_lot: 1_000_000,
            quote_atoms_per_quote_lot: 100,
            raw_base_units_per_base_unit: 1,
            num_base_lots_per_base_unit: 1000,
            best_bid: Some(245.60),
            best_ask: Some(245.70),
            bid_liquidity: 10_000_000_000, // 10 SOL
            ask_liquidity: 15_000_000_000, // 15 SOL
            is_active: true,
        };
        
        let mid_price = market.calculate_price();
        assert!((mid_price - 245.65).abs() < 0.01);
        
        let (bid_liq, ask_liq) = market.get_reserves();
        assert_eq!(bid_liq, 10_000_000_000);
        assert_eq!(ask_liq, 15_000_000_000);
    }
}



