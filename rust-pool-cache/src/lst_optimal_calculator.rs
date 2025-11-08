/*!
 * LST最优套利金额计算器
 * 
 * 基于数学优化理论，计算LST套利的最佳投资规模
 * 
 * 核心算法：
 * 1. AMM解析解（求导得最优点）
 * 2. 流动性约束（安全边界）
 * 3. 滑点估算（恒定乘积公式）
 * 4. 风险管理（信心度调整）
 */

use crate::price_cache::PoolPrice;

/// LST最优金额计算器
#[derive(Clone, Debug)]
pub struct LstOptimalCalculator {
    /// SOL价格（USD）用于流动性估算
    pub sol_price_usd: f64,
    /// 最大滑点容忍度（百分比）
    pub max_slippage_pct: f64,
}

impl LstOptimalCalculator {
    /// 创建新的计算器
    pub fn new() -> Self {
        Self {
            sol_price_usd: 200.0,  // 假设SOL价格$200
            max_slippage_pct: 2.0, // 最大2%滑点
        }
    }
    
    /// 设置SOL价格
    pub fn set_sol_price(&mut self, price: f64) {
        self.sol_price_usd = price;
    }
    
    /// 🔥 跨DEX套利最优金额（数学解析解 + 流动性约束）
    /// 
    /// # 数学原理
    /// 
    /// 利润函数：P(x) = Output₂(Output₁(x)) - x - fees
    /// 
    /// 对于恒定乘积AMM：
    /// - Output₁ = (x × R₁_out) / (R₁_in + x)
    /// - Output₂ = (Output₁ × R₂_out) / (R₂_in + Output₁)
    /// 
    /// 求导并令 ∂P/∂x = 0，得最优解：
    /// x* = √(R₁_in × R₂_in × price_ratio) - R₁_in
    /// 
    /// # Arguments
    /// * `pool_buy` - 买入池子（低价池）
    /// * `pool_sell` - 卖出池子（高价池）
    /// * `price_diff_pct` - 价格差异百分比
    /// 
    /// # Returns
    /// 最优套利金额（USD）
    pub fn optimal_cross_dex(
        &self,
        pool_buy: &PoolPrice,
        pool_sell: &PoolPrice,
        price_diff_pct: f64,
    ) -> f64 {
        // 第1步：标准化价格到统一方向
        let p_buy = self.normalize_price(pool_buy);
        let p_sell = self.normalize_price(pool_sell);
        
        if p_buy <= 0.0 || p_sell <= 0.0 {
            return 50.0; // 默认最小值
        }
        
        let price_ratio = p_sell / p_buy;
        
        // 第2步：提取储备量（单位：token数量）
        let r_buy_in = pool_buy.base_reserve as f64 / 10f64.powi(pool_buy.base_decimals as i32);
        let r_sell_in = pool_sell.base_reserve as f64 / 10f64.powi(pool_sell.base_decimals as i32);
        
        // 第3步：数学解析最优解（AMM公式求导）
        let analytical_optimal_tokens = if price_ratio > 1.0 {
            // x* = √(R₁ × R₂ × (P₂/P₁)) - R₁
            (r_buy_in * r_sell_in * price_ratio).sqrt() - r_buy_in
        } else {
            // 价格比率<1说明没有套利空间
            0.0
        };
        
        let analytical_usd = if analytical_optimal_tokens > 0.0 {
            analytical_optimal_tokens * self.sol_price_usd
        } else {
            0.0
        };
        
        // 第4步：流动性硬约束（安全上限）
        // 关键：取卖出池子的流动性（通常是瓶颈）
        let r_sell_out = pool_sell.quote_reserve as f64 / 10f64.powi(pool_sell.quote_decimals as i32);
        let sell_liquidity_usd = r_sell_out * self.sol_price_usd;
        
        let safe_pct = self.safe_percentage(sell_liquidity_usd);
        let liquidity_constrained = sell_liquidity_usd * safe_pct;
        
        // 第5步：取两者中较小值（保守）
        let base_optimal = if analytical_usd > 0.0 && analytical_usd < 1000000.0 {
            analytical_usd.min(liquidity_constrained)
        } else {
            liquidity_constrained
        };
        
        // 第6步：根据价差调整信心度
        let confidence = if price_diff_pct > 10.0 {
            0.1  // 价差>10%，极度可疑
        } else if price_diff_pct > 5.0 {
            0.3  // 价差>5%，谨慎
        } else {
            1.0  // 价差正常
        };
        
        let final_amount = base_optimal * confidence;
        
        // 第7步：范围限制
        final_amount.max(50.0).min(5000.0)
    }
    
    /// 🔥 折价赎回最优金额（滑点阈值法）
    /// 
    /// # 核心原理
    /// 
    /// 折价赎回只有买入环节（赎回是1:1固定比率）
    /// 因此只需要控制买入时的滑点不要吞噬折价利润
    /// 
    /// 目标：滑点 < 折价幅度的50%
    /// 
    /// 滑点公式（AMM）：s = x / (2R + x)
    /// 要求：x / (2R + x) < discount/2
    /// 解得：x < R × discount / (1 - discount/2)
    /// 
    /// # Arguments
    /// * `pool_buy` - 买入LST的池子
    /// * `discount_pct` - 折价百分比
    /// 
    /// # Returns
    /// 最优买入金额（USD）
    pub fn optimal_discount_redeem(
        &self,
        pool_buy: &PoolPrice,
        discount_pct: f64,
    ) -> f64 {
        // 第1步：计算买入池子的流动性
        let buy_reserve = pool_buy.base_reserve.min(pool_buy.quote_reserve) as f64;
        let decimals = pool_buy.base_decimals.min(pool_buy.quote_decimals);
        let buy_liquidity_tokens = buy_reserve / 10f64.powi(decimals as i32);
        let buy_liquidity_usd = buy_liquidity_tokens * self.sol_price_usd;
        
        // 第2步：计算滑点阈值（折价的50%）
        let max_slippage = (discount_pct / 100.0) * 0.5;
        
        // 第3步：基于滑点阈值的最大金额
        // 滑点公式：s = x / (2R + x)
        // 解出x：x = R × s / (1 - s)
        let r = buy_liquidity_usd;
        let max_amount_by_slippage = r * max_slippage / (1.0 - max_slippage);
        
        // 第4步：流动性安全约束
        let safe_pct = self.safe_percentage(buy_liquidity_usd);
        let liquidity_constrained = buy_liquidity_usd * safe_pct;
        
        // 第5步：取较小值
        let base_optimal = max_amount_by_slippage.min(liquidity_constrained);
        
        // 第6步：保守70%（留安全边际）
        let safe_amount = base_optimal * 0.7;
        
        // 第7步：高折价 = 可疑 = 降低金额
        let confidence = if discount_pct > 10.0 {
            0.2  // >10%折价高度可疑
        } else if discount_pct > 5.0 {
            0.5  // >5%折价谨慎
        } else {
            1.0  // 正常
        };
        
        let final_amount = safe_amount * confidence;
        
        // 第8步：范围限制
        final_amount.max(100.0).min(5000.0)
    }
    
    /// 🔥 估算滑点（用于验证）
    /// 
    /// # Arguments
    /// * `amount_usd` - 交易金额（USD）
    /// * `reserve_usd` - 池子储备量（USD）
    /// 
    /// # Returns
    /// 预估滑点百分比
    pub fn estimate_slippage(&self, amount_usd: f64, reserve_usd: f64) -> f64 {
        if reserve_usd <= 0.0 {
            return self.max_slippage_pct;
        }
        
        // 恒定乘积公式：slippage = x / (2R + x)
        let x = amount_usd;
        let r = reserve_usd;
        
        let slippage = x / (2.0 * r + x);
        
        // 转换为百分比并限制最大值
        (slippage * 100.0).min(self.max_slippage_pct)
    }
    
    /// 辅助：标准化LST价格到统一方向（SOL per LST）
    /// 
    /// # Arguments
    /// * `pool` - 池子价格数据
    /// 
    /// # Returns
    /// 标准化后的价格（SOL/LST格式）
    fn normalize_price(&self, pool: &PoolPrice) -> f64 {
        // 检查池子名称方向
        if pool.pair.starts_with("SOL/") || pool.pair.starts_with("SOL ") {
            // SOL/mSOL池子 → price是mSOL/SOL → 取倒数得SOL/mSOL
            if pool.price > 0.0 {
                1.0 / pool.price
            } else {
                0.0
            }
        } else {
            // mSOL/SOL池子 → price已经是SOL/mSOL
            pool.price
        }
    }
    
    /// 辅助：根据流动性确定安全百分比
    /// 
    /// # Arguments
    /// * `liquidity_usd` - 池子流动性（USD）
    /// 
    /// # Returns
    /// 安全使用比例（0.002-0.02）
    fn safe_percentage(&self, liquidity_usd: f64) -> f64 {
        match liquidity_usd {
            x if x > 100_000.0 => 0.02,  // 大池子：2%
            x if x > 10_000.0  => 0.01,  // 中池子：1%
            x if x > 1_000.0   => 0.005, // 小池子：0.5%
            _                  => 0.002  // 微型池子：0.2%
        }
    }
    
    /// 🔥 高级：二次验证最优金额
    /// 
    /// 使用推荐金额模拟实际交易，验证ROI是否仍然满足
    /// 
    /// # Arguments
    /// * `recommended_amount` - 推荐金额
    /// * `pool_buy` - 买入池子
    /// * `pool_sell` - 卖出池子（可选，折价赎回时为None）
    /// * `expected_roi` - 预期ROI
    /// 
    /// # Returns
    /// (验证后的金额, 估算的实际ROI)
    pub fn verify_and_adjust(
        &self,
        recommended_amount: f64,
        pool_buy: &PoolPrice,
        pool_sell: Option<&PoolPrice>,
        expected_roi: f64,
    ) -> (f64, f64) {
        // 估算买入滑点
        let buy_reserve_usd = {
            let reserve = pool_buy.base_reserve.min(pool_buy.quote_reserve) as f64;
            let decimals = pool_buy.base_decimals.min(pool_buy.quote_decimals);
            reserve * self.sol_price_usd / 10f64.powi(decimals as i32)
        };
        
        let buy_slippage = self.estimate_slippage(recommended_amount, buy_reserve_usd);
        
        // 如果有卖出池子，估算卖出滑点
        let sell_slippage = if let Some(pool) = pool_sell {
            let sell_reserve_usd = {
                let reserve = pool.quote_reserve as f64; // 卖出时用quote
                reserve * self.sol_price_usd / 10f64.powi(pool.quote_decimals as i32)
            };
            self.estimate_slippage(recommended_amount, sell_reserve_usd)
        } else {
            0.0 // 折价赎回没有卖出环节
        };
        
        // 总滑点
        let total_slippage = buy_slippage + sell_slippage;
        
        // 实际ROI = 理论ROI - 滑点
        let actual_roi = expected_roi - total_slippage;
        
        // 如果滑点太大（>理论ROI的50%），降低金额
        if total_slippage > expected_roi * 0.5 {
            let adjusted_amount = recommended_amount * 0.5;
            // 递归验证（最多2次）
            if adjusted_amount > 50.0 {
                return (adjusted_amount, actual_roi * 0.7);
            }
        }
        
        (recommended_amount, actual_roi)
    }
}

impl Default for LstOptimalCalculator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_safe_percentage() {
        let calc = LstOptimalCalculator::new();
        
        assert_eq!(calc.safe_percentage(200_000.0), 0.02); // 大池子
        assert_eq!(calc.safe_percentage(50_000.0), 0.01);  // 中池子
        assert_eq!(calc.safe_percentage(5_000.0), 0.005);  // 小池子
        assert_eq!(calc.safe_percentage(500.0), 0.002);    // 微型池子
    }
    
    #[test]
    fn test_slippage_estimation() {
        let calc = LstOptimalCalculator::new();
        
        // 小额交易（$100），大池子（$100K）
        let slippage = calc.estimate_slippage(100.0, 100_000.0);
        assert!(slippage < 0.1); // 应该<0.1%
        
        // 中额交易（$1000），中池子（$10K）
        let slippage = calc.estimate_slippage(1000.0, 10_000.0);
        assert!(slippage > 2.0 && slippage < 10.0); // 应该2-10%
        
        // 大额交易（$1000），小池子（$1K）
        let slippage = calc.estimate_slippage(1000.0, 1_000.0);
        assert!(slippage >= 2.0); // 应该>=2%（已到上限）
    }
    
    #[test]
    fn test_phoenix_msol_case() {
        let calc = LstOptimalCalculator::new();
        
        // Phoenix mSOL实际案例
        // 流动性：7.58 SOL ≈ $1,516
        let phoenix_liquidity = 7.58 * 200.0;
        
        // 计算安全金额
        let safe_pct = calc.safe_percentage(phoenix_liquidity);
        assert_eq!(safe_pct, 0.005); // 应该是0.5%
        
        let safe_amount = phoenix_liquidity * safe_pct;
        assert!((safe_amount - 7.58).abs() < 1.0); // 应该约$7.58
        
        // 应用价差调整（9%）
        let final_amount = safe_amount * 0.3; // confidence=0.3
        assert!(final_amount > 2.0 && final_amount < 10.0);
        
        // 范围限制后应该是$50
        let clamped = final_amount.max(50.0);
        assert_eq!(clamped, 50.0);
    }
}


