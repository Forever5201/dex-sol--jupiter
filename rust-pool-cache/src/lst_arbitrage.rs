/// 🔥 LST折价套利模块
/// 
/// 功能：
/// - 监控LST折价/溢价机会
/// - 计算LST套利收益
/// - 生成套利路径
/// 
/// 支持的LST：
/// - mSOL (Marinade)
/// - jitoSOL (Jito)
/// 
/// 套利策略：
/// 1. 跨DEX套利（Phoenix vs Raydium）
/// 2. 三角套利（LST → USDC → SOL）
/// 3. 折价买入套利（买入后赎回）

use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use tracing::info;

/// LST代币信息
#[derive(Debug, Clone)]
pub struct LstToken {
    /// LST名称
    pub name: &'static str,
    /// Mint地址
    pub mint: Pubkey,
    /// 理论赎回比率（1 LST = ? SOL）
    pub theoretical_rate: f64,
    /// 赎回Program ID
    pub stake_pool_program: Pubkey,
    /// 赎回时间（秒）
    pub unstake_delay_seconds: u64,
}

impl LstToken {
    /// mSOL (Marinade)
    pub fn msol() -> Self {
        Self {
            name: "mSOL",
            mint: Pubkey::from_str("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So").unwrap(),
            theoretical_rate: 1.05, // mSOL通常比SOL多5%（质押奖励）
            stake_pool_program: Pubkey::from_str("MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD").unwrap(),
            unstake_delay_seconds: 2 * 24 * 3600, // 2天解锁期
        }
    }
    
    /// jitoSOL (Jito)
    pub fn jitosol() -> Self {
        Self {
            name: "jitoSOL",
            mint: Pubkey::from_str("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn").unwrap(),
            theoretical_rate: 1.04, // jitoSOL带MEV奖励
            stake_pool_program: Pubkey::from_str("Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb").unwrap(),
            unstake_delay_seconds: 1 * 24 * 3600, // 1天解锁期
        }
    }
    
    /// 获取所有支持的LST
    pub fn all_supported() -> Vec<Self> {
        vec![Self::msol(), Self::jitosol()]
    }
}

/// LST折价套利机会
#[derive(Debug, Clone)]
pub struct LstDiscountOpportunity {
    /// LST类型
    pub lst_name: String,
    /// 市场价格（多少SOL能买1个LST）
    pub market_price: f64,
    /// 理论价值（1个LST理论值多少SOL）
    pub fair_value: f64,
    /// 折价率（百分比）
    pub discount_percent: f64,
    /// 预估利润（扣除费用后）
    pub estimated_profit_percent: f64,
    /// 池子来源
    pub pool_source: String,
    /// 套利类型
    pub arbitrage_type: LstArbitrageType,
    /// 推荐金额（USD）
    pub recommended_amount_usd: f64,
}

/// LST套利类型
#[derive(Debug, Clone)]
pub enum LstArbitrageType {
    /// 即时套利（跨DEX/三角套利）
    Instant {
        path: Vec<String>,
        expected_profit: f64,
    },
    /// 折价买入赎回
    DiscountPurchase {
        buy_pool: String,
        unstake_delay_days: u64,
        expected_profit: f64,
    },
}

/// LST套利检测器
pub struct LstArbitrageDetector {
    /// 支持的LST列表
    lst_tokens: Vec<LstToken>,
    /// 最小折价率阈值（%）
    min_discount_threshold: f64,
    /// 交易费用估算（%）
    estimated_fees: f64,
}

impl LstArbitrageDetector {
    /// 创建新的LST套利检测器
    pub fn new(min_discount_threshold: f64) -> Self {
        Self {
            lst_tokens: LstToken::all_supported(),
            min_discount_threshold,
            estimated_fees: 0.3, // 0.3%手续费估算（swap费用+赎回费用）
        }
    }
    
    /// 检测LST折价机会
    /// 
    /// prices: 池子名称 -> 价格的映射
    /// 返回: 发现的套利机会列表
    pub fn detect_discount_opportunities(
        &self,
        prices: &std::collections::HashMap<String, f64>
    ) -> Vec<LstDiscountOpportunity> {
        let mut opportunities = Vec::new();
        
        for lst in &self.lst_tokens {
            // 查找该LST的市场价格
            let market_prices = self.find_lst_market_prices(lst, prices);
            
            for (pool_name, market_price) in market_prices {
                // 计算折价率
                let discount = (lst.theoretical_rate - market_price) / lst.theoretical_rate * 100.0;
                
                if discount < self.min_discount_threshold {
                    continue; // 折价不足，跳过
                }
                
                // 计算扣除费用后的实际利润
                let net_profit = discount - self.estimated_fees;
                
                if net_profit > 0.0 {
                    let opportunity = LstDiscountOpportunity {
                        lst_name: lst.name.to_string(),
                        market_price,
                        fair_value: lst.theoretical_rate,
                        discount_percent: discount,
                        estimated_profit_percent: net_profit,
                        pool_source: pool_name.clone(),
                        arbitrage_type: LstArbitrageType::DiscountPurchase {
                            buy_pool: pool_name,
                            unstake_delay_days: lst.unstake_delay_seconds / (24 * 3600),
                            expected_profit: net_profit,
                        },
                        recommended_amount_usd: self.calculate_recommended_amount(net_profit),
                    };
                    
                    info!(
                        lst = %lst.name,
                        market_price = %market_price,
                        fair_value = %lst.theoretical_rate,
                        discount = %discount,
                        profit = %net_profit,
                        "LST discount opportunity detected"
                    );
                    
                    opportunities.push(opportunity);
                }
            }
        }
        
        opportunities
    }
    
    /// 检测跨DEX LST套利机会
    /// 
    /// 比较同一LST在不同DEX的价格
    pub fn detect_cross_dex_opportunities(
        &self,
        prices: &std::collections::HashMap<String, f64>
    ) -> Vec<LstDiscountOpportunity> {
        let mut opportunities = Vec::new();
        
        for lst in &self.lst_tokens {
            let market_prices = self.find_lst_market_prices(lst, prices);
            
            if market_prices.len() < 2 {
                continue; // 需要至少2个池子才能跨DEX套利
            }
            
            // 找到最低和最高价格
            let min_price_pool = market_prices.iter().min_by(|a, b| a.1.partial_cmp(&b.1).unwrap()).unwrap();
            let max_price_pool = market_prices.iter().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap()).unwrap();
            
            let price_diff_percent = (max_price_pool.1 - min_price_pool.1) / min_price_pool.1 * 100.0;
            let net_profit = price_diff_percent - self.estimated_fees * 2.0; // 两次swap
            
            if net_profit > 0.1 {
                let path = vec![
                    format!("Buy {} at {}", lst.name, min_price_pool.0),
                    format!("Sell {} at {}", lst.name, max_price_pool.0),
                ];
                
                let opportunity = LstDiscountOpportunity {
                    lst_name: lst.name.to_string(),
                    market_price: min_price_pool.1,
                    fair_value: max_price_pool.1,
                    discount_percent: price_diff_percent,
                    estimated_profit_percent: net_profit,
                    pool_source: format!("{} vs {}", min_price_pool.0, max_price_pool.0),
                    arbitrage_type: LstArbitrageType::Instant {
                        path,
                        expected_profit: net_profit,
                    },
                    recommended_amount_usd: self.calculate_recommended_amount(net_profit),
                };
                
                info!(
                    lst = %lst.name,
                    buy_at = %min_price_pool.0,
                    sell_at = %max_price_pool.0,
                    price_diff = %price_diff_percent,
                    profit = %net_profit,
                    "Cross-DEX LST arbitrage opportunity detected"
                );
                
                opportunities.push(opportunity);
            }
        }
        
        opportunities
    }
    
    /// 查找LST在各个池子的市场价格
    fn find_lst_market_prices(
        &self,
        lst: &LstToken,
        prices: &std::collections::HashMap<String, f64>
    ) -> Vec<(String, f64)> {
        let mut market_prices = Vec::new();
        
        // 搜索包含LST名称的池子
        let name_lower = lst.name.to_lowercase();
        let search_keywords = vec![
            lst.name,
            name_lower.as_str(),
        ];
        
        for (pool_name, price) in prices {
            for keyword in &search_keywords {
                if pool_name.contains(keyword) {
                    // 确保价格合理（排除异常值）
                    if *price > 0.0 && *price < 10.0 {
                        market_prices.push((pool_name.clone(), *price));
                        break;
                    }
                }
            }
        }
        
        market_prices
    }
    
    /// 计算推荐交易金额
    fn calculate_recommended_amount(&self, profit_percent: f64) -> f64 {
        // 基于利润率推荐金额
        if profit_percent > 2.0 {
            10000.0 // 利润>2%，大额交易
        } else if profit_percent > 1.0 {
            5000.0 // 利润1-2%，中额
        } else if profit_percent > 0.5 {
            2000.0 // 利润0.5-1%，小额
        } else {
            1000.0 // 利润<0.5%，最小额
        }
    }
    
    /// 生成LST折价套利报告
    pub fn generate_report(&self, opportunities: &[LstDiscountOpportunity]) -> String {
        if opportunities.is_empty() {
            return "📊 LST套利扫描完成：未发现折价机会\n".to_string();
        }
        
        let mut report = String::new();
        report.push_str("\n╔════════════════════════════════════════════════════════════════╗\n");
        report.push_str("║           🔥 LST折价套利机会报告                              ║\n");
        report.push_str("╠════════════════════════════════════════════════════════════════╣\n");
        
        for (idx, opp) in opportunities.iter().enumerate() {
            report.push_str(&format!("║ 机会#{:<2} │ {:6} │ 折价{:>5.2}% │ 利润{:>5.2}%           ║\n",
                idx + 1,
                opp.lst_name,
                opp.discount_percent,
                opp.estimated_profit_percent
            ));
            
            report.push_str(&format!("║          │ 市价{:>6.4} │ 理论{:>6.4} │ 金额${:<6.0}    ║\n",
                opp.market_price,
                opp.fair_value,
                opp.recommended_amount_usd
            ));
            
            match &opp.arbitrage_type {
                LstArbitrageType::Instant { path, .. } => {
                    report.push_str(&format!("║          │ 类型: 即时套利 │ 路径: {}步         ║\n",
                        path.len()
                    ));
                }
                LstArbitrageType::DiscountPurchase { unstake_delay_days, .. } => {
                    report.push_str(&format!("║          │ 类型: 折价买入 │ 解锁: {}天          ║\n",
                        unstake_delay_days
                    ));
                }
            }
            
            report.push_str("╠════════════════════════════════════════════════════════════════╣\n");
        }
        
        report.push_str(&format!("║ 总计: {}个机会                                               ║\n", opportunities.len()));
        report.push_str("╚════════════════════════════════════════════════════════════════╝\n");
        
        report
    }
}

/// LST折价监控器
pub struct LstDiscountMonitor {
    detector: LstArbitrageDetector,
    last_check_prices: std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, f64>>>,
}

impl LstDiscountMonitor {
    /// 创建新的LST折价监控器
    pub fn new(min_discount: f64) -> Self {
        Self {
            detector: LstArbitrageDetector::new(min_discount),
            last_check_prices: std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        }
    }
    
    /// 检查LST折价机会
    pub fn check_opportunities(
        &self,
        current_prices: &std::collections::HashMap<String, f64>
    ) -> Vec<LstDiscountOpportunity> {
        // 检测折价买入机会
        let mut all_opps = self.detector.detect_discount_opportunities(current_prices);
        
        // 检测跨DEX套利机会
        let cross_dex_opps = self.detector.detect_cross_dex_opportunities(current_prices);
        all_opps.extend(cross_dex_opps);
        
        // 更新最后检查的价格
        if !all_opps.is_empty() {
            let mut last_prices = self.last_check_prices.lock().unwrap();
            *last_prices = current_prices.clone();
        }
        
        all_opps
    }
    
    /// 打印LST折价报告
    pub fn print_report(&self, opportunities: &[LstDiscountOpportunity]) {
        let report = self.detector.generate_report(opportunities);
        println!("{}", report);
    }
}

/// 计算mSOL的理论公允价值
/// 
/// 基于Marinade的质押奖励率动态计算
pub fn calculate_msol_fair_value() -> f64 {
    // 简化版本：使用固定APY估算
    // 实际应该从Marinade链上数据读取
    const MARINADE_APY: f64 = 0.05; // 5% APY
    const DAYS_ACCUMULATED: f64 = 365.0; // 假设已质押1年
    
    1.0 + (MARINADE_APY * DAYS_ACCUMULATED / 365.0)
}

/// 计算jitoSOL的理论公允价值
/// 
/// 基于Jito的MEV奖励估算
pub fn calculate_jitosol_fair_value() -> f64 {
    // 简化版本：使用固定APY + MEV奖励
    const JITO_BASE_APY: f64 = 0.05; // 5% 基础APY
    const MEV_BONUS: f64 = 0.01; // 额外1% MEV奖励
    
    1.0 + JITO_BASE_APY + MEV_BONUS
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_lst_token_info() {
        let msol = LstToken::msol();
        assert_eq!(msol.name, "mSOL");
        assert!(msol.theoretical_rate > 1.0);
        
        let jitosol = LstToken::jitosol();
        assert_eq!(jitosol.name, "jitoSOL");
        assert!(jitosol.theoretical_rate > 1.0);
    }
    
    #[test]
    fn test_discount_detection() {
        let detector = LstArbitrageDetector::new(0.5); // 最小0.5%折价
        
        let mut prices = std::collections::HashMap::new();
        prices.insert("mSOL/SOL (Phoenix)".to_string(), 1.03); // 折价约2%
        prices.insert("SOL/USDC (Raydium V4)".to_string(), 165.0);
        
        let opportunities = detector.detect_discount_opportunities(&prices);
        
        // 应该检测到mSOL的折价机会
        assert!(!opportunities.is_empty());
        assert_eq!(opportunities[0].lst_name, "mSOL");
        assert!(opportunities[0].discount_percent > 1.0);
    }
    
    #[test]
    fn test_cross_dex_detection() {
        let detector = LstArbitrageDetector::new(0.5);
        
        let mut prices = std::collections::HashMap::new();
        prices.insert("mSOL/SOL (Phoenix)".to_string(), 1.03);
        prices.insert("SOL/mSOL (Raydium CLMM)".to_string(), 0.97); // 反向价格
        
        let opportunities = detector.detect_cross_dex_opportunities(&prices);
        
        // 可能检测到跨DEX套利（取决于价格转换）
        println!("Cross-DEX opportunities: {}", opportunities.len());
    }
}

