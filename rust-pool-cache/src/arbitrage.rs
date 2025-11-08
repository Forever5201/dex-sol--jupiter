use crate::price_cache::{PoolPrice, PriceCache};
use std::time::Instant;

/// Arbitrage opportunity
#[derive(Clone, Debug)]
pub struct ArbitrageOpportunity {
    pub pool_a_id: String,
    pub pool_a_dex: String,
    pub pool_a_price: f64,
    pub pool_b_id: String,
    pub pool_b_dex: String,
    pub pool_b_price: f64,
    pub pair: String,
    pub price_diff_pct: f64,
    pub estimated_profit_pct: f64,
    pub detected_at: Instant,
}

/// Detect arbitrage opportunities between two pools
pub fn detect_arbitrage(
    pool_a: &PoolPrice,
    pool_b: &PoolPrice,
    threshold_pct: f64,
) -> Option<ArbitrageOpportunity> {
    // Ensure same pair
    if pool_a.pair != pool_b.pair {
        return None;
    }
    
    // Calculate price difference
    let price_diff = (pool_a.price - pool_b.price).abs();
    let avg_price = (pool_a.price + pool_b.price) / 2.0;
    let price_diff_pct = (price_diff / avg_price) * 100.0;
    
    // Check if above threshold
    if price_diff_pct < threshold_pct {
        return None;
    }
    
    // Estimate profit (simplified, ignoring fees for now)
    let estimated_profit_pct = price_diff_pct - 0.5; // Assume 0.5% total fees
    
    if estimated_profit_pct <= 0.0 {
        return None;
    }
    
    Some(ArbitrageOpportunity {
        pool_a_id: pool_a.pool_id.clone(),
        pool_a_dex: pool_a.dex_name.clone(),
        pool_a_price: pool_a.price,
        pool_b_id: pool_b.pool_id.clone(),
        pool_b_dex: pool_b.dex_name.clone(),
        pool_b_price: pool_b.price,
        pair: pool_a.pair.clone(),
        price_diff_pct,
        estimated_profit_pct,
        detected_at: Instant::now(),
    })
}

/// Scan all cached prices for arbitrage opportunities
pub fn scan_for_arbitrage(
    price_cache: &PriceCache,
    threshold_pct: f64,
) -> Vec<ArbitrageOpportunity> {
    let mut opportunities = Vec::new();
    let all_prices = price_cache.get_all_prices();
    
    // Group by pair
    let mut pairs_map: std::collections::HashMap<String, Vec<PoolPrice>> = std::collections::HashMap::new();
    for price in all_prices {
        pairs_map.entry(price.pair.clone())
            .or_insert_with(Vec::new)
            .push(price);
    }
    
    // Check each pair
    for pools in pairs_map.values() {
        if pools.len() < 2 {
            continue;
        }
        
        // Compare all pairs
        for i in 0..pools.len() {
            for j in (i + 1)..pools.len() {
                if let Some(opp) = detect_arbitrage(&pools[i], &pools[j], threshold_pct) {
                    opportunities.push(opp);
                }
            }
        }
    }
    
    opportunities
}

/// Format arbitrage opportunity for display
#[allow(dead_code)]
pub fn format_opportunity(opp: &ArbitrageOpportunity) -> String {
    format!(
        "🔥 ARBITRAGE: {} | {} ${:.4} vs {} ${:.4} | Diff: {:.2}% | Est. Profit: {:.2}%",
        opp.pair,
        opp.pool_a_dex,
        opp.pool_a_price,
        opp.pool_b_dex,
        opp.pool_b_price,
        opp.price_diff_pct,
        opp.estimated_profit_pct
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    
    #[test]
    fn test_detect_arbitrage() {
        let pool_a = PoolPrice {
            pool_id: "raydium_sol_usdc".to_string(),
            dex_name: "Raydium".to_string(),
            pair: "SOL/USDC".to_string(),
            base_reserve: 0,
            quote_reserve: 0,
            base_decimals: 9,
            quote_decimals: 6,
            price: 100.0,
            last_update: Instant::now(),
            slot: 1000,
        };
        
        let pool_b = PoolPrice {
            pool_id: "orca_sol_usdc".to_string(),
            dex_name: "Orca".to_string(),
            pair: "SOL/USDC".to_string(),
            base_reserve: 0,
            quote_reserve: 0,
            base_decimals: 9,
            quote_decimals: 6,
            price: 101.0,
            last_update: Instant::now(),
            slot: 1000,
        };
        
        let opp = detect_arbitrage(&pool_a, &pool_b, 0.5);
        assert!(opp.is_some());
        
        let opp = opp.unwrap();
        assert!((opp.price_diff_pct - 0.995).abs() < 0.01); // ~1% diff
    }
    
    #[test]
    fn test_no_arbitrage_below_threshold() {
        let pool_a = PoolPrice {
            pool_id: "raydium_sol_usdc".to_string(),
            dex_name: "Raydium".to_string(),
            pair: "SOL/USDC".to_string(),
            base_reserve: 0,
            quote_reserve: 0,
            base_decimals: 9,
            quote_decimals: 6,
            price: 100.0,
            last_update: Instant::now(),
            slot: 1000,
        };
        
        let pool_b = PoolPrice {
            pool_id: "orca_sol_usdc".to_string(),
            dex_name: "Orca".to_string(),
            pair: "SOL/USDC".to_string(),
            base_reserve: 0,
            quote_reserve: 0,
            base_decimals: 9,
            quote_decimals: 6,
            price: 100.1,
            last_update: Instant::now(),
            slot: 1000,
        };
        
        // 0.1% difference is below 0.5% threshold
        let opp = detect_arbitrage(&pool_a, &pool_b, 0.5);
        assert!(opp.is_none());
    }
}



