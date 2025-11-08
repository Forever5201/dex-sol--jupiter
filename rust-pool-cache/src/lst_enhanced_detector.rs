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
                    let pool_a = &lst_pools[i];
                    let pool_b = &lst_pools[j];
                    
                    // ✅ 数据验证：跳过异常价格
                    if pool_a.price <= 0.0 || pool_a.price.is_nan() || pool_a.price.is_infinite() {
                        continue;
                    }
                    if pool_b.price <= 0.0 || pool_b.price.is_nan() || pool_b.price.is_infinite() {
                        continue;
                    }
                    
                    // ✅ 数据验证：跳过零流动性池子
                    if pool_a.base_reserve == 0 || pool_a.quote_reserve == 0 {
                        continue;
                    }
                    if pool_b.base_reserve == 0 || pool_b.quote_reserve == 0 {
                        continue;
                    }
                    
                    if let Some(opp) = self.calculate_cross_dex_opportunity(
                        lst, pool_a, pool_b, fair_value
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
                // ✅ 数据验证：跳过异常价格
                if pool.price <= 0.0 || pool.price.is_nan() || pool.price.is_infinite() {
                    debug!("Skipping LST pool {} with invalid price: {}", pool.pool_id, pool.price);
                    continue;
                }
                
                // ✅ 数据验证：跳过零流动性池子
                if pool.base_reserve == 0 || pool.quote_reserve == 0 {
                    debug!("Skipping LST pool {} with zero reserves", pool.pool_id);
                    continue;
                }
                
                // 🔥 关键修复：标准化价格方向再比较
                // fair_value总是表示：1 LST值多少SOL（例如：1.029 SOL/mSOL）
                // pool.price的含义取决于池子方向：
                //   - SOL/mSOL池子：price = mSOL/SOL（需要取倒数）
                //   - mSOL/SOL池子：price = SOL/mSOL（直接使用）
                
                let market_price_normalized = if pool.pair.starts_with("SOL/") || pool.pair.starts_with("SOL ") {
                    // SOL/LST池子，price是LST/SOL，需要取倒数得到SOL/LST
                    if pool.price > 0.0 { 1.0 / pool.price } else { 0.0 }
                } else {
                    // LST/SOL池子，price已经是SOL/LST格式
                    pool.price
                };
                
                // 现在两个价格都是"SOL per LST"格式，可以安全比较
                // fair_value: 1.029 SOL/mSOL
                // market_price_normalized: 1.222 SOL/mSOL
                // 折价 = (1.029 - 1.222) / 1.222 * 100 = -15.8%（实际是溢价）
                let discount = if market_price_normalized > 0.0 {
                    ((fair_value - market_price_normalized) / market_price_normalized) * 100.0
                } else {
                    0.0
                };
                
                // 🔍 Debug日志：诊断折价计算
                debug!(
                    "LST discount calculation: pool={}, pair={}, original_price={}, normalized_price={}, fair_value={}, discount={}%",
                    pool.pool_id, pool.pair, pool.price, market_price_normalized, fair_value, discount
                );
                
                if discount < self.config.min_discount_percent {
                    continue;
                }
                
                let unstake_fee = match lst.name {
                    "mSOL" => self.config.marinade_unstake_fee,
                    "jitoSOL" => self.config.jito_unstake_fee,
                    _ => 0.003,
                };
                
                let net_profit = discount - unstake_fee * 100.0;
                
                // 🔥 严格的合理性检查
                if net_profit > 15.0 {
                    // LST折价赎回ROI >15% 几乎不可能（市场太高效）
                    debug!(
                        "❌ Rejecting unrealistic LST discount: {} at {} with {}% profit (likely calculation error)",
                        lst.name, pool.dex_name, net_profit
                    );
                    continue;
                } else if net_profit > 8.0 {
                    // ROI 8-15% 值得怀疑，记录警告但保留
                    info!(
                        "⚠️  Suspicious LST discount: {} at {} with {}% profit (verify manually!)",
                        lst.name, pool.dex_name, net_profit
                    );
                }
                
                if net_profit > 0.0 {
                    let path_description = format!(
                        "Buy {} at {} → Redeem for SOL",
                        lst.name, pool.dex_name
                    );
                    
                    opportunities.push(LstOpportunity {
                        lst_name: lst.name.to_string(),
                        market_price: market_price_normalized,  // 🔥 使用标准化后的价格
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
        // 🔥 关键修复：标准化价格方向
        // LST池子可能有两种方向：SOL/mSOL 或 mSOL/SOL
        // 需要将它们都转换为统一方向（SOL/mSOL，即1 mSOL值多少SOL）
        
        // 检查池子名称方向，标准化为 "SOL per LST" 格式
        let price_a_normalized = if pool_a.pair.starts_with("SOL/") || pool_a.pair.starts_with("SOL ") {
            // SOL/mSOL -> price是mSOL/SOL，需要取倒数得到SOL/mSOL
            if pool_a.price > 0.0 { 1.0 / pool_a.price } else { 0.0 }
        } else {
            // mSOL/SOL -> price已经是SOL/mSOL
            pool_a.price
        };
        
        let price_b_normalized = if pool_b.pair.starts_with("SOL/") || pool_b.pair.starts_with("SOL ") {
            // SOL/mSOL -> 取倒数
            if pool_b.price > 0.0 { 1.0 / pool_b.price } else { 0.0 }
        } else {
            // mSOL/SOL -> 已是正确方向
            pool_b.price
        };
        
        // 标准化后价格都表示：1 LST值多少SOL
        // 现在可以安全比较了
        let (buy_pool, sell_pool, buy_price, sell_price) = if price_a_normalized < price_b_normalized {
            (pool_a, pool_b, price_a_normalized, price_b_normalized)
        } else {
            (pool_b, pool_a, price_b_normalized, price_a_normalized)
        };
        
        // 计算价差（基于标准化后的价格）
        let price_diff_percent = ((sell_price - buy_price) / buy_price) * 100.0;
        let fee_buy = self.get_dex_fee(&buy_pool.dex_name);
        let fee_sell = self.get_dex_fee(&sell_pool.dex_name);
        let net_profit = price_diff_percent - (fee_buy + fee_sell) * 100.0;
        
        // 🔥 严格的合理性检查：LST跨DEX套利
        if net_profit > 15.0 {
            // ROI >15% 几乎不可能，拒绝
            debug!(
                "❌ Rejecting unrealistic LST cross-DEX: {} → {} with {}% profit (price_a={}, price_b={}, normalized: {} vs {})",
                buy_pool.dex_name, sell_pool.dex_name, net_profit,
                pool_a.price, pool_b.price, price_a_normalized, price_b_normalized
            );
            return None;
        } else if net_profit > 8.0 {
            // ROI 8-15% 值得怀疑，记录警告
            info!(
                "⚠️  Suspicious LST cross-DEX: {} → {} with {}% profit (verify manually!)",
                buy_pool.dex_name, sell_pool.dex_name, net_profit
            );
        }
        
        if net_profit < self.config.min_discount_percent {
            return None;
        }
        
        // 🔥 使用基于流动性的智能金额计算
        let recommended_amount = self.calculate_optimal_amount_by_liquidity(buy_pool, sell_pool, net_profit);
        
        Some(LstOpportunity {
            lst_name: lst.name.to_string(),
            market_price: buy_price,  // 使用标准化后的价格
            fair_value,
            discount_percent: price_diff_percent,
            estimated_profit_percent: net_profit,
            arbitrage_type: LstArbitrageType::Instant {
                path: vec![format!("Buy {} → Sell {}", buy_pool.dex_name, sell_pool.dex_name)],
                expected_profit: net_profit,
            },
            path_description: format!("Cross-DEX: {} → {}", buy_pool.dex_name, sell_pool.dex_name),
            recommended_amount_usd: recommended_amount,
            route_steps: None,
            input_amount: recommended_amount,
            output_amount: recommended_amount * (1.0 + net_profit / 100.0),
        })
    }
    
    fn get_dex_fee(&self, dex_name: &str) -> f64 {
        *self.dex_fees.get(dex_name).unwrap_or(&0.0025)
    }
    
    /// 🔥 智能计算推荐套利金额（基于流动性和滑点）
    /// 
    /// 原则：
    /// - 交易额不应超过池子流动性的1-2%（控制滑点<1%）
    /// - 对于流动性差的池子，降低推荐金额
    /// - 考虑ROI和风险的平衡
    fn calculate_recommended_amount(&self, roi: f64) -> f64 {
        // 🔥 简化版本：基于ROI的保守推荐
        // TODO: 改进为基于实际池子流动性计算
        
        // 对于可疑的高ROI（8-15%），大幅降低推荐金额
        if roi > 8.0 {
            // 高ROI往往意味着流动性差或数据问题
            100.0  // 只推荐$100
        } else if roi > 5.0 {
            500.0  // $500
        } else if roi > 2.0 {
            1000.0  // $1,000
        } else if roi > 1.0 {
            2000.0  // $2,000
        } else {
            500.0  // 默认$500
        }
    }
    
    /// 🔥 新增：基于池子流动性计算最优套利金额
    /// 
    /// # Arguments
    /// * `pool_a` - 买入池子
    /// * `pool_b` - 卖出池子
    /// * `roi` - 预期ROI
    /// 
    /// # Returns
    /// 最优套利金额（USD）
    #[allow(dead_code)]
    fn calculate_optimal_amount_by_liquidity(
        &self,
        pool_a: &PoolPrice,
        pool_b: &PoolPrice,
        roi: f64,
    ) -> f64 {
        // 计算两个池子的最小流动性（限制因素）
        let pool_a_liquidity_usd = {
            let min_reserve = pool_a.base_reserve.min(pool_a.quote_reserve) as f64;
            let decimals = pool_a.base_decimals.min(pool_a.quote_decimals);
            let amount = min_reserve / 10f64.powi(decimals as i32);
            // 假设SOL价格$200，粗略转USD
            amount * 200.0
        };
        
        let pool_b_liquidity_usd = {
            let min_reserve = pool_b.base_reserve.min(pool_b.quote_reserve) as f64;
            let decimals = pool_b.base_decimals.min(pool_b.quote_decimals);
            let amount = min_reserve / 10f64.powi(decimals as i32);
            amount * 200.0
        };
        
        // 取两个池子中较小的流动性
        let min_liquidity = pool_a_liquidity_usd.min(pool_b_liquidity_usd);
        
        // 🔥 关键规则：交易额不超过流动性的1-2%（控制滑点）
        // 流动性越大，可以用的比例越高
        let safe_percentage = if min_liquidity > 100_000.0 {
            0.02  // 大池子：2%
        } else if min_liquidity > 10_000.0 {
            0.01  // 中池子：1%
        } else {
            0.005 // 小池子：0.5%
        };
        
        let max_safe_amount = min_liquidity * safe_percentage;
        
        // 根据ROI调整（ROI越高，越保守）
        let roi_adjusted = if roi > 8.0 {
            max_safe_amount * 0.1  // 高ROI可疑，只用10%
        } else if roi > 5.0 {
            max_safe_amount * 0.3  // 中高ROI，用30%
        } else {
            max_safe_amount  // 正常ROI，用100%
        };
        
        // 限制范围：$50-$5000
        roi_adjusted.max(50.0).min(5000.0)
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

