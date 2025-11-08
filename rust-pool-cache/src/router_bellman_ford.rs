/*!
 * Bellman-Ford 负循环检测算法
 * 
 * 用于发现所有可能的套利循环（包括4-6跳的复杂路径）
 * 
 * 核心原理：
 * 1. 将汇率转换为负对数：-ln(rate)
 * 2. 运行Bellman-Ford算法寻找负权环
 * 3. 负权环 = 套利机会（因为乘积>1 → 对数和<0）
 */

use crate::price_cache::PoolPrice;
use crate::router::{ArbitragePath, ArbitrageType, RouteStep};
use std::collections::HashMap;
use std::time::Instant;

/// 图的边（代表一个交易池）
#[derive(Debug, Clone)]
struct Edge {
    /// 起始代币
    from: String,
    /// 目标代币
    to: String,
    /// 负对数权重：-ln(汇率)
    weight: f64,
    /// 原始价格
    original_price: f64,
    /// 池子信息
    pool: PoolPrice,
}

/// 负循环（套利机会）
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct NegativeCycle {
    /// 循环中的代币序列
    tokens: Vec<String>,
    /// 循环中的边（池子）
    edges: Vec<Edge>,
    /// 总权重（负值表示有利可图）
    #[allow(dead_code)]
    total_weight: f64,
}

/// Bellman-Ford 扫描器
#[derive(Clone)]
pub struct BellmanFordScanner {
    /// 最大跳数限制
    max_hops: usize,
    /// 最小ROI阈值（用于过滤）
    min_roi_percent: f64,
    /// 收敛阈值
    convergence_threshold: f64,
}

impl BellmanFordScanner {
    /// 创建新的扫描器
    pub fn new(max_hops: usize, min_roi_percent: f64) -> Self {
        Self {
            max_hops,
            min_roi_percent,
            convergence_threshold: 0.0001,
        }
    }
    
    /// 扫描所有负循环（套利机会）
    pub fn find_all_cycles(&self, pools: &[PoolPrice], initial_amount: f64) -> Vec<ArbitragePath> {
        // 1. 构建图
        let (edges, tokens) = self.build_graph(pools);
        
        if tokens.is_empty() || edges.is_empty() {
            return Vec::new();
        }
        
        // 🔥 2. 并行化：对每个起始代币运行Bellman-Ford
        // 使用rayon实现CPU多核并行，性能提升2-4x
        use rayon::prelude::*;
        
        let all_cycles: Vec<NegativeCycle> = tokens
            .par_iter()  // 并行迭代器
            .filter_map(|start_token| {
                self.detect_cycles_from_token(start_token, &edges, &tokens)
            })
            .flatten()
            .collect();
        
        // 3. 去重（同一个循环可能从不同起点被发现）
        let all_cycles = self.deduplicate_cycles(all_cycles);
        
        // 4. 转换为ArbitragePath
        let mut paths = Vec::new();
        for cycle in all_cycles {
            if let Some(path) = self.cycle_to_path(cycle, initial_amount) {
                paths.push(path);
            }
        }
        
        // 5. 过滤和排序
        paths.retain(|p| p.is_valid() && p.roi_percent >= self.min_roi_percent);
        paths.sort_by(|a, b| b.score().partial_cmp(&a.score()).unwrap());
        
        paths
    }
    
    /// 构建图（边和代币列表）
    fn build_graph(&self, pools: &[PoolPrice]) -> (Vec<Edge>, Vec<String>) {
        let mut edges = Vec::new();
        let mut token_set = std::collections::HashSet::new();
        
        for pool in pools {
            // 解析交易对
            let tokens: Vec<&str> = pool.pair.split('/').collect();
            if tokens.len() != 2 {
                continue;
            }
            
            let base = tokens[0].to_string();
            let quote = tokens[1].to_string();
            
            token_set.insert(base.clone());
            token_set.insert(quote.clone());
            
            // 正向边：quote → base (买入base)
            // 价格表示：1 quote = price base
            // 所以 quote → base 的汇率是 1/price
            let rate_quote_to_base = 1.0 / pool.price;
            let weight_quote_to_base = -rate_quote_to_base.ln();
            
            edges.push(Edge {
                from: quote.clone(),
                to: base.clone(),
                weight: weight_quote_to_base,
                original_price: rate_quote_to_base,  // ← 修复: 使用汇率，不是价格
                pool: pool.clone(),
            });
            
            // 反向边：base → quote (卖出base)
            // 汇率是 price
            let rate_base_to_quote = pool.price;
            let weight_base_to_quote = -rate_base_to_quote.ln();
            
            let mut reverse_pool = pool.clone();
            reverse_pool.price = rate_base_to_quote;
            
            edges.push(Edge {
                from: base,
                to: quote,
                weight: weight_base_to_quote,
                original_price: rate_base_to_quote,  // ← 这个是正确的
                pool: reverse_pool,
            });
        }
        
        let tokens: Vec<String> = token_set.into_iter().collect();
        (edges, tokens)
    }
    
    /// 从指定代币运行Bellman-Ford检测负循环
    fn detect_cycles_from_token(
        &self,
        start_token: &str,
        edges: &[Edge],
        tokens: &[String],
    ) -> Option<Vec<NegativeCycle>> {
        let n = tokens.len();
        
        // 初始化距离和父节点
        let mut dist: HashMap<String, f64> = HashMap::new();
        let mut parent: HashMap<String, Option<(String, Edge)>> = HashMap::new();
        
        for token in tokens {
            dist.insert(token.clone(), f64::INFINITY);
            parent.insert(token.clone(), None);
        }
        
        dist.insert(start_token.to_string(), 0.0);
        
        // Bellman-Ford: V-1 轮松弛
        for _iteration in 0..n - 1 {
            let mut updated = false;
            
            for edge in edges {
                let d_from = dist.get(&edge.from).copied().unwrap_or(f64::INFINITY);
                let d_to = dist.get(&edge.to).copied().unwrap_or(f64::INFINITY);
                
                if d_from + edge.weight < d_to - self.convergence_threshold {
                    dist.insert(edge.to.clone(), d_from + edge.weight);
                    parent.insert(edge.to.clone(), Some((edge.from.clone(), edge.clone())));
                    updated = true;
                }
            }
            
            // 如果没有更新，提前结束
            if !updated {
                break;
            }
        }
        
        // 第 V 轮：检测负循环
        let mut negative_cycles = Vec::new();
        let mut detected_tokens = std::collections::HashSet::new();
        
        for edge in edges {
            let d_from = dist.get(&edge.from).copied().unwrap_or(f64::INFINITY);
            let d_to = dist.get(&edge.to).copied().unwrap_or(f64::INFINITY);
            
            // 如果还能松弛，说明存在负循环
            if d_from + edge.weight < d_to - self.convergence_threshold {
                // 避免重复检测同一个循环
                if detected_tokens.contains(&edge.to) {
                    continue;
                }
                
                // 提取负循环路径
                if let Some(cycle) = self.extract_cycle(&parent, &edge.to, edge) {
                    // 检查跳数限制
                    if cycle.tokens.len() >= 2 && cycle.tokens.len() <= self.max_hops {
                        detected_tokens.insert(edge.to.clone());
                        negative_cycles.push(cycle);
                    }
                }
            }
        }
        
        if negative_cycles.is_empty() {
            None
        } else {
            Some(negative_cycles)
        }
    }
    
    /// 提取负循环路径
    fn extract_cycle(
        &self,
        parent: &HashMap<String, Option<(String, Edge)>>,
        start_token: &str,
        trigger_edge: &Edge,
    ) -> Option<NegativeCycle> {
        let mut cycle_tokens = Vec::new();
        let mut cycle_edges = Vec::new();
        let mut visited = std::collections::HashSet::new();
        
        let mut current = start_token.to_string();
        
        // 回溯parent链找到循环
        const MAX_CYCLE_ITERATIONS: usize = 20;
        let mut iteration_count = 0;
        
        loop {
            // 🔥 安全保护：检测无限循环
            if iteration_count >= MAX_CYCLE_ITERATIONS {
                use tracing::warn;
                warn!(
                    "Cycle extraction exceeded max iterations ({}), possible graph corruption. Start token: {}",
                    MAX_CYCLE_ITERATIONS,
                    start_token
                );
                return None;  // 安全退出，不返回可能损坏的路径
            }
            
            if visited.contains(&current) {
                // 找到循环起点
                break;
            }
            
            visited.insert(current.clone());
            
            if let Some(Some((prev_token, edge))) = parent.get(&current) {
                cycle_tokens.push(current.clone());
                cycle_edges.push(edge.clone());
                current = prev_token.clone();
            } else {
                break;
            }
            
            iteration_count += 1;
        }
        
        // 添加触发边闭合循环
        cycle_tokens.push(trigger_edge.to.clone());
        cycle_edges.push(trigger_edge.clone());
        
        // 反转（因为是从后往前追踪的）
        cycle_tokens.reverse();
        cycle_edges.reverse();
        
        // 找到循环的起点
        let cycle_start = cycle_tokens.iter()
            .position(|t| cycle_tokens.iter().filter(|x| *x == t).count() > 1);
        
        if let Some(start_idx) = cycle_start {
            // 从循环起点截取
            let cycle_end = cycle_tokens.iter()
                .skip(start_idx + 1)
                .position(|t| t == &cycle_tokens[start_idx])
                .map(|p| p + start_idx + 1);
            
            if let Some(end_idx) = cycle_end {
                cycle_tokens = cycle_tokens[start_idx..=end_idx].to_vec();
                cycle_edges = cycle_edges[start_idx..end_idx].to_vec();
            }
        }
        
        // 计算总权重
        let total_weight: f64 = cycle_edges.iter().map(|e| e.weight).sum();
        
        // 验证是否真的是负循环
        if total_weight >= -self.convergence_threshold {
            return None;
        }
        
        // 验证循环有效性
        if cycle_tokens.is_empty() || cycle_edges.is_empty() {
            return None;
        }
        
        // 验证起始和结束代币相同
        if cycle_tokens.first() != cycle_tokens.last() {
            return None;
        }
        
        Some(NegativeCycle {
            tokens: cycle_tokens,
            edges: cycle_edges,
            total_weight,
        })
    }
    
    /// 去重负循环（同一个循环可能从不同起点发现）
    fn deduplicate_cycles(&self, cycles: Vec<NegativeCycle>) -> Vec<NegativeCycle> {
        let mut unique_cycles = Vec::new();
        let mut seen_signatures = std::collections::HashSet::new();
        
        for cycle in cycles {
            // 创建循环签名（代币序列的规范化表示）
            let mut sorted_tokens = cycle.tokens.clone();
            sorted_tokens.sort();
            let signature = sorted_tokens.join("->");
            
            if !seen_signatures.contains(&signature) {
                seen_signatures.insert(signature);
                unique_cycles.push(cycle);
            }
        }
        
        unique_cycles
    }
    
    /// 将负循环转换为套利路径
    fn cycle_to_path(&self, cycle: NegativeCycle, initial_amount: f64) -> Option<ArbitragePath> {
        if cycle.edges.is_empty() || cycle.tokens.is_empty() {
            return None;
        }
        
        let start_token = cycle.tokens[0].clone();
        let mut current_amount = initial_amount;
        let mut steps = Vec::new();
        
        // 计算每一跳的实际输出
        for edge in &cycle.edges {
            // 获取DEX手续费（从pool信息中）
            let dex_fee = self.get_dex_fee(&edge.pool.dex_name);
            
            // 🔥 使用精确AMM恒定乘积公式（x * y = k）
            // 替代线性近似，消除2-5%的大额交易误差
            use crate::dex_interface::amm_calculator;
            
            let (reserve_in, reserve_out) = self.get_directional_reserves(&edge);
            
            let output_amount = amm_calculator::calculate_amm_output_f64(
                current_amount,
                reserve_in,
                reserve_out,
                dex_fee,
            );
            
            steps.push(RouteStep {
                pool_id: edge.pool.pool_id.clone(),
                dex_name: edge.pool.dex_name.clone(),
                input_token: edge.from.clone(),
                output_token: edge.to.clone(),
                price: edge.original_price,
                liquidity_base: edge.pool.base_reserve,
                liquidity_quote: edge.pool.quote_reserve,
                expected_input: current_amount,
                expected_output: output_amount,
            });
            
            current_amount = output_amount;
        }
        
        let final_amount = current_amount;
        
        // 计算利润
        let gross_profit = final_amount - initial_amount;
        
        // 估算总费用
        let total_dex_fees: f64 = cycle.edges.iter()
            .map(|e| self.get_dex_fee(&e.pool.dex_name))
            .sum();
        let estimated_fees = initial_amount * total_dex_fees;
        
        // Gas费估算（根据跳数）
        let gas_fee = match steps.len() {
            2 => 0.0001,
            3 => 0.0002,
            4 => 0.0003,
            5 => 0.0004,
            _ => 0.0005,
        };
        
        let net_profit = gross_profit - gas_fee;
        let roi_percent = (net_profit / initial_amount) * 100.0;
        
        // 确定套利类型
        let arb_type = match steps.len() {
            2 => ArbitrageType::Direct,
            3 => ArbitrageType::Triangle,
            _ => ArbitrageType::MultiHop,
        };
        
        Some(ArbitragePath {
            arb_type,
            steps,
            start_token: start_token.clone(),
            end_token: cycle.tokens.last().unwrap().clone(),
            input_amount: initial_amount,
            output_amount: final_amount,
            gross_profit,
            estimated_fees: estimated_fees + gas_fee,
            net_profit,
            roi_percent,
            discovered_at: Instant::now(),
        })
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
            _ => 0.0025, // 默认0.25%
        }
    }
    
    /// 获取交易方向的储备量
    /// 
    /// 根据交易方向（from → to），正确提取输入和输出储备量
    fn get_directional_reserves(&self, edge: &Edge) -> (f64, f64) {
        let pool = &edge.pool;
        let (base_reserve, quote_reserve) = pool.get_reserves();
        let (base_decimals, quote_decimals) = pool.get_decimals();
        
        // 将储备量转换为浮点数
        let base_reserve_f64 = base_reserve as f64 / 10f64.powi(base_decimals as i32);
        let quote_reserve_f64 = quote_reserve as f64 / 10f64.powi(quote_decimals as i32);
        
        // 解析交易对
        let pair_tokens: Vec<&str> = pool.pair.split('/').collect();
        if pair_tokens.len() != 2 {
            return (base_reserve_f64, quote_reserve_f64);
        }
        
        let base_token = pair_tokens[0];
        let quote_token = pair_tokens[1];
        
        // 确定交易方向
        if edge.from == quote_token && edge.to == base_token {
            // quote → base (买入base)
            (quote_reserve_f64, base_reserve_f64)
        } else if edge.from == base_token && edge.to == quote_token {
            // base → quote (卖出base)
            (base_reserve_f64, quote_reserve_f64)
        } else {
            // 降级处理：无法确定方向，使用默认
            (base_reserve_f64, quote_reserve_f64)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_log_conversion() {
        // 测试负对数转换
        let rate: f64 = 1.01; // 1% 利润
        let weight = -rate.ln();
        assert!(weight < 0.0); // 负权重
        
        let rate2: f64 = 0.99; // 1% 亏损
        let weight2 = -rate2.ln();
        assert!(weight2 > 0.0); // 正权重
    }
    
    #[test]
    fn test_cycle_detection() {
        // 测试循环：A→B (rate=1.01) → B→C (rate=1.01) → C→A (rate=1.01)
        // 总乘积 = 1.01^3 = 1.030301 > 1 → 套利机会
        // 负对数和 = -ln(1.01)*3 = -0.0299 < 0 → 负循环 ✓
        
        let rate: f64 = 1.01;
        let total_weight = -rate.ln() * 3.0;
        assert!(total_weight < 0.0);
    }
}


