/*!
 * LST Enhanced Detector
 */

use crate::lst_arbitrage::{LstToken, LstArbitrageType};
use crate::price_cache::{PoolPrice, PriceCache};
use crate::stake_pool_reader::StakePoolReader;
use crate::router::{ArbitragePath, ArbitrageType, RouteStep};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tracing::{info, debug};

#[derive(Debug, Clone)]
pub struct LstOpportunity {
    pub lst_name: String,
    pub market_price: f64,
    pub fair_value: f64,
    pub discount_percent: f64,
    pub estimated_profit_percent: f64,
    pub arbitrage_type: LstArbitrageType,
    pub path_description: String,
    pub recommended_amount_usd: f64,
    pub route_steps: Option<Vec<RouteStep>>,
    pub input_amount: f64,
    pub output_amount: f64,
}

impl LstOpportunity {
    pub fn to_arbitrage_path(&self) -> Option<ArbitragePath> {
        let steps = self.route_steps.as_ref()?;
        if steps.is_empty() { return None; }
        
        let start_token = steps.first()?.input_token.clone();
        let end_token = steps.last()?.output_token.clone();
        let gross_profit = self.output_amount - self.input_amount;
        let estimated_fees = self.input_amount * 0.01;
        let net_profit = gross_profit - estimated_fees;
        
        Some(ArbitragePath {
            arb_type: ArbitrageType::Triangle,
            steps: steps.clone(),
            start_token,
            end_token,
            input_amount: self.input_amount,
            output_amount: self.output_amount,
            gross_profit,
            estimated_fees,
            net_profit,
            roi_percent: self.estimated_profit_percent,
            discovered_at: Instant::now(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct LstDetectorConfig {
    pub min_discount_percent: f64,
    pub enable_triangle_arbitrage: bool,
    pub enable_multi_lst_arbitrage: bool,
    pub enable_redemption_path: bool,
    pub marinade_unstake_fee: f64,
    pub jito_unstake_fee: f64,
}

impl Default for LstDetectorConfig {
    fn default() -> Self {
        Self {
            min_discount_percent: 0.3,
            enable_triangle_arbitrage: true,
            enable_multi_lst_arbitrage: true,
            enable_redemption_path: true,
            marinade_unstake_fee: 0.003,
            jito_unstake_fee: 0.001,
        }
    }
}

#[derive(Clone)]
pub struct LstEnhancedDetector {
    price_cache: Arc<PriceCache>,
    stake_pool_reader: Arc<StakePoolReader>,
    lst_tokens: Vec<LstToken>,
    config: LstDetectorConfig,
    dex_fees: HashMap<String, f64>,
}

impl LstEnhancedDetector {
    pub fn new(
        price_cache: Arc<PriceCache>,
        stake_pool_reader: Arc<StakePoolReader>,
        config: LstDetectorConfig,
    ) -> Self {
        let mut dex_fees = HashMap::new();
        dex_fees.insert("Raydium AMM V4".to_string(), 0.0025);
        dex_fees.insert("Raydium CLMM".to_string(), 0.0001);
        dex_fees.insert("Orca Whirlpool".to_string(), 0.0001);
        dex_fees.insert("Phoenix (CLOB)".to_string(), 0.0005);
        
        Self {
            price_cache,
            stake_pool_reader,
            lst_tokens: LstToken::all_supported(),
            config,
            dex_fees,
        }
    }
    
    pub fn detect_all_opportunities(&self, initial_amount: f64) -> Vec<LstOpportunity> {
        let mut all_opportunities = Vec::new();
        
        info!("Starting LST arbitrage detection");
        
        if let Ok(cross_dex) = self.detect_cross_dex_opportunities() {
            all_opportunities.extend(cross_dex);
        }
        
        if self.config.enable_triangle_arbitrage {
            if let Ok(triangle) = self.detect_triangle_arbitrage(initial_amount) {
                all_opportunities.extend(triangle);
            }
        }
        
        if self.config.enable_multi_lst_arbitrage {
            if let Ok(multi_lst) = self.detect_multi_lst_arbitrage(initial_amount) {
                all_opportunities.extend(multi_lst);
            }
        }
        
        if let Ok(discount) = self.detect_discount_opportunities() {
            all_opportunities.extend(discount);
        }
        
        all_opportunities
    }
    
    fn detect_cross_dex_opportunities(&self) -> Result<Vec<LstOpportunity>, anyhow::Error> {
        let mut opportunities = Vec::new();
        let all_prices = self.price_cache.get_all_prices();
        let (msol_fair, jitosol_fair) = self.stake_pool_reader.get_all_rates()?;
        
        for lst in &self.lst_tokens {
            let lst_pools = self.find_lst_pools(lst, &all_prices);
            if lst_pools.len() < 2 { continue; }
            
            let fair_value = match lst.name {
                "mSOL" => msol_fair,
                "jitoSOL" => jitosol_fair,
                _ => lst.theoretical_rate,
            };
            
            for i in 0..lst_pools.len() {
                for j in (i + 1)..lst_pools.len() {
                    if let Some(opp) = self.calculate_cross_dex_opportunity(
                        lst, &lst_pools[i], &lst_pools[j], fair_value
                    ) {
                        opportunities.push(opp);
                    }
                }
            }
        }
        
        Ok(opportunities)
    }
    
    fn detect_triangle_arbitrage(&self, _initial_amount: f64) -> Result<Vec<LstOpportunity>, anyhow::Error> {
        // Simplified implementation
        Ok(Vec::new())
    }
    
    fn detect_multi_lst_arbitrage(&self, _initial_amount: f64) -> Result<Vec<LstOpportunity>, anyhow::Error> {
        // Simplified implementation
        Ok(Vec::new())
    }
    
    fn detect_discount_opportunities(&self) -> Result<Vec<LstOpportunity>, anyhow::Error> {
        let mut opportunities = Vec::new();
        let (msol_fair, jitosol_fair) = self.stake_pool_reader.get_all_rates()?;
        let all_prices = self.price_cache.get_all_prices();
        
        for lst in &self.lst_tokens {
            let fair_value = match lst.name {
                "mSOL" => msol_fair,
                "jitoSOL" => jitosol_fair,
                _ => lst.theoretical_rate,
            };
            
            let lst_pools = self.find_lst_pools(lst, &all_prices);
            
            for pool in lst_pools {
                let discount = ((fair_value - pool.price) / fair_value) * 100.0;
                
                if discount < self.config.min_discount_percent {
                    continue;
                }
                
                let unstake_fee = match lst.name {
                    "mSOL" => self.config.marinade_unstake_fee,
                    "jitoSOL" => self.config.jito_unstake_fee,
                    _ => 0.003,
                };
                
                let net_profit = discount - unstake_fee * 100.0;
                
                if net_profit > 0.0 {
                    let path_description = format!(
                        "Buy {} at {} → Redeem for SOL",
                        lst.name, pool.dex_name
                    );
                    
                    opportunities.push(LstOpportunity {
                        lst_name: lst.name.to_string(),
                        market_price: pool.price,
                        fair_value,
                        discount_percent: discount,
                        estimated_profit_percent: net_profit,
                        arbitrage_type: LstArbitrageType::DiscountPurchase {
                            buy_pool: pool.pool_id.clone(),
                            unstake_delay_days: lst.unstake_delay_seconds / (24 * 3600),
                            expected_profit: net_profit,
                        },
                        path_description,
                        recommended_amount_usd: self.calculate_recommended_amount(net_profit),
                        route_steps: None,
                        input_amount: 1000.0,
                        output_amount: 1000.0 * (1.0 + net_profit / 100.0),
                    });
                }
            }
        }
        
        Ok(opportunities)
    }
    
    fn find_lst_pools(&self, lst: &LstToken, all_prices: &[PoolPrice]) -> Vec<PoolPrice> {
        all_prices.iter().filter(|p| p.pair.contains(lst.name)).cloned().collect()
    }
    
    fn calculate_cross_dex_opportunity(
        &self,
        lst: &LstToken,
        pool_a: &PoolPrice,
        pool_b: &PoolPrice,
        fair_value: f64,
    ) -> Option<LstOpportunity> {
        let (buy_pool, sell_pool) = if pool_a.price < pool_b.price {
            (pool_a, pool_b)
        } else {
            (pool_b, pool_a)
        };
        
        let price_diff_percent = ((sell_pool.price - buy_pool.price) / buy_pool.price) * 100.0;
        let fee_buy = self.get_dex_fee(&buy_pool.dex_name);
        let fee_sell = self.get_dex_fee(&sell_pool.dex_name);
        let net_profit = price_diff_percent - (fee_buy + fee_sell) * 100.0;
        
        if net_profit < self.config.min_discount_percent {
            return None;
        }
        
        Some(LstOpportunity {
            lst_name: lst.name.to_string(),
            market_price: buy_pool.price,
            fair_value,
            discount_percent: price_diff_percent,
            estimated_profit_percent: net_profit,
            arbitrage_type: LstArbitrageType::Instant {
                path: vec![format!("Buy {} → Sell {}", buy_pool.dex_name, sell_pool.dex_name)],
                expected_profit: net_profit,
            },
            path_description: format!("Cross-DEX: {} → {}", buy_pool.dex_name, sell_pool.dex_name),
            recommended_amount_usd: self.calculate_recommended_amount(net_profit),
            route_steps: None,
            input_amount: 1000.0,
            output_amount: 1000.0 * (1.0 + net_profit / 100.0),
        })
    }
    
    fn get_dex_fee(&self, dex_name: &str) -> f64 {
        *self.dex_fees.get(dex_name).unwrap_or(&0.0025)
    }
    
    fn calculate_recommended_amount(&self, roi: f64) -> f64 {
        if roi > 2.0 { 10000.0 }
        else if roi > 1.0 { 5000.0 }
        else if roi > 0.5 { 2000.0 }
        else { 1000.0 }
    }
    
    pub fn generate_report(&self, opportunities: &[LstOpportunity]) -> String {
        if opportunities.is_empty() {
            return "📊 LST扫描完成：未发现机会\n".to_string();
        }
        
        let mut report = String::new();
        report.push_str("\n╔════════════════════════════════════════════════════════════════╗\n");
        report.push_str("║           🔥 LST增强套利机会报告                              ║\n");
        report.push_str("╠════════════════════════════════════════════════════════════════╣\n");
        
        for (idx, opp) in opportunities.iter().enumerate() {
            report.push_str(&format!(
                "║ #{:<2} {} │ ROI {:>5.2}% │ ${:<6.0}                   ║\n",
                idx + 1, opp.lst_name, opp.estimated_profit_percent, opp.recommended_amount_usd
            ));
            
            report.push_str(&format!("║     {:<59}║\n", &opp.path_description));
            
            match &opp.arbitrage_type {
                LstArbitrageType::Instant { .. } => {
                    report.push_str("║     类型: 即时套利                                          ║\n");
                }
                LstArbitrageType::DiscountPurchase { unstake_delay_days, .. } => {
                    report.push_str(&format!("║     类型: 折价赎回 │ 等待: {}天                            ║\n", unstake_delay_days));
                }
            }
            
            report.push_str("╠════════════════════════════════════════════════════════════════╣\n");
        }
        
        report.push_str(&format!("║ 总计: {}个机会                                                ║\n", opportunities.len()));
        report.push_str("╚════════════════════════════════════════════════════════════════╝\n");
        
        report
    }
}

