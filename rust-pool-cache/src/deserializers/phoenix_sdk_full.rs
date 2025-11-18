/// Phoenix Market完整SDK集成
/// 
/// 使用Phoenix官方SDK正确解析Market + OrderBook数据

use std::mem::size_of;
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

// Phoenix SDK依赖
use phoenix::program::MarketHeader;
use phoenix::program::dispatch_market::load_with_dispatch;
use phoenix::state::enums::Side;
use phoenix::quantities::WrapperU64;

/// Phoenix Market with Full SDK Integration
#[derive(Debug, Clone)]
pub struct PhoenixMarketFull {
    /// 基础代币地址
    pub base_mint: Pubkey,
    /// 报价代币地址
    pub quote_mint: Pubkey,
    /// 基础代币精度
    pub base_decimals: u8,
    /// 报价代币精度
    pub quote_decimals: u8,
    
    /// Vault地址（Token账户，不是Mint）
    pub base_vault: Pubkey,
    pub quote_vault: Pubkey,
    
    /// 最佳买卖价（从OrderBook提取）
    pub best_bid: Option<f64>,
    pub best_ask: Option<f64>,
    
    /// 订单簿流动性统计
    pub total_bid_liquidity: u64,  // base atoms
    pub total_ask_liquidity: u64,  // base atoms
    
    /// 买单和卖单数量
    pub num_bids: usize,
    pub num_asks: usize,
}

impl PhoenixMarketFull {
    /// 从账户数据创建Phoenix市场实例
    pub fn from_account_data(data: &[u8]) -> Result<Self, DexError> {
        // 步骤1: 检查最小大小
        let header_size = size_of::<MarketHeader>();
        if data.len() < header_size {
            return Err(DexError::InvalidData(format!(
                "Phoenix data too small: {} bytes (expected {}+)",
                data.len(), header_size
            )));
        }
        
        // 步骤2: 分离Header和OrderBook数据
        let (header_bytes, orderbook_bytes) = data.split_at(header_size);
        
        // 步骤3: 解析MarketHeader
        let header: &MarketHeader = bytemuck::try_from_bytes(header_bytes)
            .map_err(|e| DexError::DeserializationFailed(format!("Phoenix header parse error: {:?}", e)))?;
        
        // 步骤4: 计算价格转换参数
        let tick_size_in_quote_atoms: u64 = header.get_tick_size_in_quote_atoms_per_base_unit().into();
        let raw_base_units_per_base_unit = header.raw_base_units_per_base_unit.max(1) as u64;
        let quote_atoms_per_quote_unit = 10_u64.pow(header.quote_params.decimals);
        
        // quote_units_per_raw_base_unit_per_tick = tick_size / (10^quote_decimals * raw_base_units_per_base_unit)
        let quote_units_per_raw_base_unit_per_tick = 
            tick_size_in_quote_atoms as f64 / (quote_atoms_per_quote_unit as f64 * raw_base_units_per_base_unit as f64);
        
        // 步骤5: 使用load_with_dispatch加载Market（包含OrderBook）
        let market = load_with_dispatch(&header.market_size_params, orderbook_bytes)
            .map_err(|e| DexError::DeserializationFailed(format!("Phoenix market load error: {:?}", e)))?;
        
        // 步骤6: 从OrderBook提取最佳买卖价
        let best_bid = market.inner.get_book(Side::Bid)
            .iter()
            .next()
            .map(|(order_id, _order)| {
                // price_in_ticks是ticks数量，需要转换为实际价格
                let price_in_ticks = order_id.price_in_ticks.as_u64() as f64;
                price_in_ticks * quote_units_per_raw_base_unit_per_tick
            });
        
        let best_ask = market.inner.get_book(Side::Ask)
            .iter()
            .next()
            .map(|(order_id, _order)| {
                let price_in_ticks = order_id.price_in_ticks.as_u64() as f64;
                price_in_ticks * quote_units_per_raw_base_unit_per_tick
            });
        
        // 步骤7: 计算订单簿总流动性
        let base_lot_size: u64 = header.get_base_lot_size().into();
        
        let bid_lots: u64 = market.inner.get_book(Side::Bid)
            .iter()
            .map(|(_order_id, order)| order.num_base_lots.as_u64())
            .sum();
        let total_bid_liquidity = bid_lots * base_lot_size;
        
        let ask_lots: u64 = market.inner.get_book(Side::Ask)
            .iter()
            .map(|(_order_id, order)| order.num_base_lots.as_u64())
            .sum();
        let total_ask_liquidity = ask_lots * base_lot_size;
        
        // 步骤8: 统计订单数量
        let num_bids = market.inner.get_book(Side::Bid).iter().count();
        let num_asks = market.inner.get_book(Side::Ask).iter().count();
        
        Ok(PhoenixMarketFull {
            base_mint: header.base_params.mint_key,
            quote_mint: header.quote_params.mint_key,
            base_decimals: header.base_params.decimals as u8,
            quote_decimals: header.quote_params.decimals as u8,
            base_vault: header.base_params.vault_key,
            quote_vault: header.quote_params.vault_key,
            best_bid,
            best_ask,
            total_bid_liquidity,
            total_ask_liquidity,
            num_bids,
            num_asks,
        })
    }
}

impl DexPool for PhoenixMarketFull {
    fn dex_name(&self) -> &'static str {
        "Phoenix (CLOB-Full)"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        Self::from_account_data(data)
    }
    
    fn calculate_price(&self) -> f64 {
        // 计算中间价 = (最佳买价 + 最佳卖价) / 2
        match (self.best_bid, self.best_ask) {
            (Some(bid), Some(ask)) => (bid + ask) / 2.0,
            (Some(bid), None) => bid,
            (None, Some(ask)) => ask,
            (None, None) => 0.0,
        }
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // CLOB的"储备量"实际上是订单簿总流动性
        (self.total_bid_liquidity, self.total_ask_liquidity)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (self.base_decimals, self.quote_decimals)
    }
    
    fn is_active(&self) -> bool {
        // 市场活跃的判断：有买单和卖单
        self.best_bid.is_some() && self.best_ask.is_some()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let spread = match (self.best_bid, self.best_ask) {
            (Some(bid), Some(ask)) if bid > 0.0 => (ask - bid) / bid * 100.0,
            _ => 0.0,
        };
        
        let mid_price = self.calculate_price();
        
        Some(format!(
            "Phoenix CLOB | Price: {:.6} | Bid: {:.6} ({} orders) | Ask: {:.6} ({} orders) | Spread: {:.4}%",
            mid_price,
            self.best_bid.unwrap_or(0.0),
            self.num_bids,
            self.best_ask.unwrap_or(0.0),
            self.num_asks,
            spread
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // ✅ FIXED: Phoenix CLOB does use vaults to hold deposited tokens
        // Previous implementation incorrectly returned mint addresses instead of vault addresses
        // This caused critical bugs:
        // - Subscribing to Mint accounts (82 bytes, no balance) instead of Token accounts (165 bytes, with balance)
        // - Failed vault balance updates
        // - 4 Phoenix pools were unusable
        // 
        // Correct behavior: Return actual vault Token account addresses from MarketHeader
        Some((self.base_vault, self.quote_vault))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_price_calculation() {
        let market = PhoenixMarketFull {
            base_mint: Pubkey::default(),
            quote_mint: Pubkey::default(),
            base_vault: Pubkey::default(),
            quote_vault: Pubkey::default(),
            base_decimals: 9,
            quote_decimals: 6,
            best_bid: Some(100.50),
            best_ask: Some(100.60),
            total_bid_liquidity: 1000000000,
            total_ask_liquidity: 1500000000,
            num_bids: 50,
            num_asks: 45,
        };
        
        let mid_price = market.calculate_price();
        assert!((mid_price - 100.55).abs() < 0.01);
        assert!(market.is_active());
    }
}

