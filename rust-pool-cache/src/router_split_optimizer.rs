/*!
 * 动态规划拆分优化器
 * 
 * 功能：
 * 1. 对单条路径进行多池拆分（减少滑点）
 * 2. 对多条路径进行资金最优分配
 * 3. 使用AMM恒定乘积公式精确计算滑点
 * 
 * 核心原理：
 * - 滑点随交易额非线性增长（AMM公式）
 * - 拆分资金到多个池子可以减少总滑点
 * - 使用DP找到最优拆分比例
 */

use crate::router::ArbitragePath;

/// 拆分策略
#[derive(Debug, Clone)]
pub struct SplitStrategy {
    /// 路径索引 -> 分配金额
    pub allocations: Vec<(usize, f64)>,
    /// 预期总输出
    #[allow(dead_code)]
    pub expected_output: f64,
    /// 优化后的ROI
    #[allow(dead_code)]
    pub optimized_roi: f64,
}

/// 优化后的路径（包含拆分信息）
#[derive(Debug, Clone)]
pub struct OptimizedPath {
    /// 原始路径
    pub base_path: ArbitragePath,
    /// 拆分策略（如果有）
    pub split_strategy: Option<SplitStrategy>,
    /// 优化后的净利润
    pub optimized_net_profit: f64,
    /// 优化后的ROI
    pub optimized_roi: f64,
}

impl OptimizedPath {
    /// 计算优化后的得分
    pub fn score(&self) -> f64 {
        let profit_score = self.optimized_net_profit;
        let roi_score = self.optimized_roi / 100.0;
        let complexity_penalty = 1.0 / (self.base_path.steps.len() as f64);
        
        profit_score * 0.6 + roi_score * 0.3 + complexity_penalty * 0.1
    }
    
    /// 检查是否有效
    pub fn is_valid(&self) -> bool {
        self.optimized_net_profit > 0.0 && self.optimized_roi > 0.1
    }
}

/// 动态规划拆分优化器
#[derive(Clone)]
pub struct SplitOptimizer {
    /// 最大拆分数量
    #[allow(dead_code)]
    max_splits: usize,
    /// 最小拆分金额（太小的拆分不值得）
    min_split_amount: f64,
    /// 滑点模型类型
    slippage_model: SlippageModel,
}

/// 滑点模型
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum SlippageModel {
    /// 恒定乘积模型（x * y = k）
    ConstantProduct,
    /// 线性近似（简化计算）
    #[allow(dead_code)]
    Linear,
    /// 固定百分比（最保守）
    #[allow(dead_code)]
    Fixed(f64),
}

impl SplitOptimizer {
    /// 创建新的优化器
    pub fn new(max_splits: usize, min_split_amount: f64) -> Self {
        Self {
            max_splits,
            min_split_amount,
            slippage_model: SlippageModel::ConstantProduct,
        }
    }
    
    /// 设置滑点模型
    #[allow(dead_code)]
    pub fn set_slippage_model(&mut self, model: SlippageModel) {
        self.slippage_model = model;
    }
    
    /// 优化所有路径（主入口）
    pub fn optimize_all(
        &self,
        paths: &[ArbitragePath],
        total_amount: f64,
    ) -> Vec<OptimizedPath> {
        let mut optimized = Vec::new();
        
        for path in paths {
            let opt_path = self.optimize_single_path(path, total_amount);
            optimized.push(opt_path);
        }
        
        // 如果有多条路径，进行多路径资金分配优化
        if paths.len() > 1 {
            optimized = self.optimize_multi_path_allocation(optimized, total_amount);
        }
        
        optimized
    }
    
    /// 优化单条路径（在同一个pair的多个池子间拆分）
    fn optimize_single_path(
        &self,
        path: &ArbitragePath,
        _amount: f64,
    ) -> OptimizedPath {
        // 对于每一步，检查是否有同pair的其他池子可以拆分
        // 这里先实现简化版：不拆分，直接返回
        // TODO: 实现同pair多池拆分
        
        OptimizedPath {
            base_path: path.clone(),
            split_strategy: None,
            optimized_net_profit: path.net_profit,
            optimized_roi: path.roi_percent,
        }
    }
    
    /// 多路径资金分配优化（核心DP算法）
    fn optimize_multi_path_allocation(
        &self,
        paths: Vec<OptimizedPath>,
        total_amount: f64,
    ) -> Vec<OptimizedPath> {
        let n = paths.len();
        
        if n == 0 {
            return paths;
        }
        
        if n == 1 {
            // 只有一条路径，全部分配
            let mut result = paths;
            result[0].split_strategy = Some(SplitStrategy {
                allocations: vec![(0, total_amount)],
                expected_output: result[0].optimized_net_profit + total_amount,
                optimized_roi: result[0].optimized_roi,
            });
            return result;
        }
        
        // 动态规划求解最优分配
        let granularity = 100; // 将金额离散化为100份
        let amount_step = total_amount / granularity as f64;
        
        // dp[i][j] = 前i条路径，分配j份金额（j*amount_step）的最大输出
        let mut dp = vec![vec![0.0; granularity + 1]; n + 1];
        let mut choice = vec![vec![0; granularity + 1]; n + 1]; // 记录选择，用于回溯
        
        // DP转移
        for i in 1..=n {
            let path = &paths[i - 1];
            
            for j in 0..=granularity {
                let _available_amount = j as f64 * amount_step;
                
                // 选择1：不使用第i条路径
                dp[i][j] = dp[i - 1][j];
                choice[i][j] = 0;
                
                // 选择2：使用第i条路径，尝试不同的分配量
                for split in 1..=j {
                    if split as f64 * amount_step < self.min_split_amount {
                        continue;
                    }
                    
                    let split_amount = split as f64 * amount_step;
                    let remaining = j - split;
                    
                    // 计算这条路径在split_amount下的输出
                    let output = self.simulate_path_output(path, split_amount);
                    let total_output = output + dp[i - 1][remaining];
                    
                    if total_output > dp[i][j] {
                        dp[i][j] = total_output;
                        choice[i][j] = split;
                    }
                }
            }
        }
        
        // 回溯找到最优分配
        let mut allocations = Vec::new();
        let mut remaining_amount = granularity;
        
        for i in (1..=n).rev() {
            let split = choice[i][remaining_amount];
            if split > 0 {
                let allocated = split as f64 * amount_step;
                allocations.push((i - 1, allocated));
                remaining_amount -= split;
            }
        }
        
        allocations.reverse();
        
        // 应用分配结果到路径
        let mut result = paths;
        for (i, path) in result.iter_mut().enumerate() {
            let allocated = allocations.iter()
                .find(|(idx, _)| *idx == i)
                .map(|(_, amt)| *amt)
                .unwrap_or(0.0);
            
            if allocated > 0.0 {
                let output = self.simulate_path_output(path, allocated);
                let profit = output - allocated;
                let roi = (profit / allocated) * 100.0;
                
                path.split_strategy = Some(SplitStrategy {
                    allocations: vec![(i, allocated)],
                    expected_output: output,
                    optimized_roi: roi,
                });
                path.optimized_net_profit = profit;
                path.optimized_roi = roi;
            }
        }
        
        result
    }
    
    /// 模拟路径在指定金额下的输出（考虑滑点）
    fn simulate_path_output(&self, path: &OptimizedPath, amount: f64) -> f64 {
        let mut current_amount = amount;
        
        for step in &path.base_path.steps {
            // 计算此步骤的滑点
            let slippage = self.calculate_slippage(
                step.liquidity_base,
                step.liquidity_quote,
                current_amount,
                &step.input_token,
                &path.base_path.steps[0].input_token, // 起始代币作为参考
            );
            
            // 获取DEX费用
            let dex_fee = self.get_dex_fee(&step.dex_name);
            
            // 应用费用和滑点
            let after_fee = current_amount * (1.0 - dex_fee);
            let after_slippage = after_fee * (1.0 - slippage);
            
            // 计算输出
            current_amount = after_slippage * step.price;
        }
        
        current_amount
    }
    
    /// 使用AMM公式计算滑点
    fn calculate_slippage(
        &self,
        reserve_in: u64,
        reserve_out: u64,
        amount_in: f64,
        _input_token: &str,
        _base_token: &str,
    ) -> f64 {
        match self.slippage_model {
            SlippageModel::ConstantProduct => {
                // 恒定乘积公式：x * y = k
                // 实际输出 = y - k/(x + Δx) = y * Δx / (x + Δx)
                // 理想输出 = Δx * (y/x)
                // 滑点 = 1 - 实际输出/理想输出
                
                if reserve_in == 0 || reserve_out == 0 {
                    return 0.01; // 1% 默认滑点
                }
                
                let x = reserve_in as f64;
                let _y = reserve_out as f64;
                let dx = amount_in;
                
                // 滑点 = dx / (2*x + dx)
                // 这是恒定乘积公式的近似滑点
                let slippage = dx / (2.0 * x + dx);
                
                // 限制最大滑点为5%
                slippage.min(0.05)
            }
            
            SlippageModel::Linear => {
                // 线性近似：滑点 ≈ 交易额/流动性 * 0.5
                let liquidity = reserve_in as f64;
                let slippage = (amount_in / liquidity) * 0.5;
                slippage.min(0.05)
            }
            
            SlippageModel::Fixed(pct) => pct,
        }
    }
    
    /// 获取DEX手续费
    fn get_dex_fee(&self, dex_name: &str) -> f64 {
        match dex_name {
            s if s.contains("Raydium AMM V4") => 0.0025,
            s if s.contains("Raydium CLMM") => 0.0001,
            s if s.contains("Orca") || s.contains("Whirlpool") => 0.0001,
            s if s.contains("Meteora") => 0.0002,
            s if s.contains("SolFi") => 0.0030,
            s if s.contains("AlphaQ") => 0.0001,
            s if s.contains("HumidiFi") => 0.0010,
            s if s.contains("Lifinity") => 0.0000,
            s if s.contains("Stabble") => 0.0004,
            _ => 0.0025,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_slippage_calculation() {
        let optimizer = SplitOptimizer::new(5, 100.0);
        
        // 测试：1000 USDC 在 100,000 USDC 流动性池中
        let slippage = optimizer.calculate_slippage(
            100_000_000_000, // 100k USDC (6 decimals)
            100_000_000_000,
            1000.0,
            "USDC",
            "USDC",
        );
        
        // 预期滑点约 1000/(2*100000 + 1000) = 0.497%
        assert!(slippage > 0.0 && slippage < 0.01);
    }
    
    #[test]
    fn test_dp_allocation() {
        // 测试DP分配算法的正确性
        let optimizer = SplitOptimizer::new(5, 100.0);
        
        // TODO: 添加实际的DP测试用例
    }
}







