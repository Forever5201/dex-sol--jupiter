/*!
 * 智能路由系统
 * 
 * 基于实时池子数据，寻找最优套利路径
 * 支持多种套利策略：
 * 1. 直接套利（Direct Arbitrage）- 同一交易对在不同DEX之间的价差
 * 2. 三角套利（Triangle Arbitrage）- A→B→C→A 的循环套利
 * 3. 多跳套利（Multi-hop Arbitrage）- 通过多个中间代币的复杂路径
 */

use crate::price_cache::{PoolPrice, PriceCache};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

/// 套利路径类型
#[derive(Debug, Clone, PartialEq)]
pub enum ArbitrageType {
    /// 直接套利：同一交易对在不同DEX之间
    Direct,
    /// 三角套利：通过一个中间代币
    Triangle,
    /// 多跳套利：通过多个中间代币
    MultiHop,
}

/// 路由步骤
#[derive(Debug, Clone)]
pub struct RouteStep {
    /// 池子ID
    pub pool_id: String,
    /// DEX名称
    pub dex_name: String,
    /// 输入代币
    pub input_token: String,
    /// 输出代币
    pub output_token: String,
    /// 价格
    pub price: f64,
    /// 流动性（基础代币）
    pub liquidity_base: u64,
    /// 流动性（报价代币）
    pub liquidity_quote: u64,
    /// 预期输入金额
    pub expected_input: f64,
    /// 预期输出金额
    pub expected_output: f64,
}

/// 完整的套利路径
#[derive(Debug, Clone)]
pub struct ArbitragePath {
    /// 套利类型
    pub arb_type: ArbitrageType,
    /// 路由步骤
    pub steps: Vec<RouteStep>,
    /// 起始代币
    pub start_token: String,
    /// 结束代币（应该等于起始代币）
    pub end_token: String,
    /// 初始投入金额
    pub input_amount: f64,
    /// 最终输出金额
    pub output_amount: f64,
    /// 毛利润
    pub gross_profit: f64,
    /// 估算的总费用（包括swap费用、gas等）
    pub estimated_fees: f64,
    /// 净利润
    pub net_profit: f64,
    /// ROI百分比
    pub roi_percent: f64,
    /// 发现时间
    #[allow(dead_code)]
    pub discovered_at: Instant,
}

impl ArbitragePath {
    /// 计算路径的有效性分数（用于排序）
    pub fn score(&self) -> f64 {
        // 综合考虑多个因素
        let profit_score = self.net_profit;
        let roi_score = self.roi_percent / 100.0;
        let complexity_penalty = 1.0 / (self.steps.len() as f64);
        
        // 加权平均
        profit_score * 0.6 + roi_score * 0.3 + complexity_penalty * 0.1
    }
    
    /// 检查路径是否有效
    pub fn is_valid(&self) -> bool {
        // 必须是循环（起始=结束）
        if self.start_token != self.end_token {
            return false;
        }
        
        // 必须有净利润
        if self.net_profit <= 0.0 {
            return false;
        }
        
        // ROI必须合理
        if self.roi_percent < 0.1 {
            return false;
        }
        
        // 步骤必须合理
        if self.steps.is_empty() || self.steps.len() > 5 {
            return false;
        }
        
        true
    }
}

/// 智能路由器
#[derive(Clone)]
pub struct Router {
    /// 价格缓存
    price_cache: Arc<PriceCache>,
    /// 最小ROI阈值（百分比）
    min_roi_percent: f64,
    /// 最大路径深度
    #[allow(dead_code)]
    max_depth: usize,
    /// DEX手续费配置
    dex_fees: HashMap<String, f64>,
}

impl Router {
    /// 创建新的路由器
    pub fn new(price_cache: Arc<PriceCache>) -> Self {
        let mut dex_fees = HashMap::new();
        
        // 配置各个DEX的手续费
        dex_fees.insert("Raydium AMM V4".to_string(), 0.0025);      // 0.25%
        dex_fees.insert("Raydium CLMM".to_string(), 0.0001);        // 0.01% (可变)
        dex_fees.insert("Orca Whirlpool".to_string(), 0.0001);      // 0.01% (可变)
        dex_fees.insert("Meteora DLMM".to_string(), 0.0002);        // 0.02% (可变)
        dex_fees.insert("SolFi V2".to_string(), 0.0030);            // 0.30% (保守估计)
        dex_fees.insert("AlphaQ".to_string(), 0.0001);              // 0.01% (稳定币专用)
        dex_fees.insert("HumidiFi".to_string(), 0.0010);            // 0.10%
        dex_fees.insert("Lifinity V2".to_string(), 0.0000);         // 动态定价
        dex_fees.insert("GoonFi".to_string(), 0.0025);              // 0.25% (估计)
        dex_fees.insert("TesseraV".to_string(), 0.0020);            // 0.20% (估计)
        dex_fees.insert("Stabble".to_string(), 0.0004);             // 0.04% (稳定币)
        dex_fees.insert("Whirlpool".to_string(), 0.0001);           // 0.01%
        dex_fees.insert("PancakeSwap".to_string(), 0.0025);         // 0.25%
        
        Self {
            price_cache,
            min_roi_percent: 0.3, // 最小30%的ROI
            max_depth: 4,          // 最多4跳
            dex_fees,
        }
    }
    
    /// 设置最小ROI阈值
    #[allow(dead_code)]
    pub fn set_min_roi(&mut self, min_roi_percent: f64) {
        self.min_roi_percent = min_roi_percent;
    }
    
    /// 设置最大路径深度
    #[allow(dead_code)]
    pub fn set_max_depth(&mut self, max_depth: usize) {
        self.max_depth = max_depth;
    }
    
    /// 🔥 核心方法：寻找所有套利机会
    pub fn find_all_opportunities(&self, initial_amount: f64) -> Vec<ArbitragePath> {
        let mut all_paths = Vec::new();

        // 🔥 数据质量监控 - 调试日志
        let all_prices = self.price_cache.get_all_prices();
        println!("📊 [路由调试] 缓存数据质量报告:");
        println!("   - 总池子数量: {}", all_prices.len());

        // 统计各交易对的池子分布
        let mut pair_count: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let mut dex_count: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

        for price in &all_prices {
            *pair_count.entry(price.pair.clone()).or_insert(0) += 1;
            *dex_count.entry(price.dex_name.clone()).or_insert(0) += 1;
        }

        println!("   - 唯一交易对数量: {}", pair_count.len());
        for (pair, count) in pair_count.iter().take(5) {
            println!("     * {}: {} 个池子", pair, count);
        }

        println!("   - DEX分布 (前5个):");
        for (dex, count) in dex_count.iter().take(5) {
            println!("     * {}: {} 个池子", dex, count);
        }

        // 检查是否能形成套利的基本条件
        let multi_pools: Vec<_> = pair_count.iter()
            .filter(|(_, &count)| count >= 2)
            .collect();

        println!("   - 可套利交易对 (≥2个池子): {}", multi_pools.len());
        if !multi_pools.is_empty() {
            for (pair, count) in multi_pools.iter().take(3) {
                println!("     * {}: {} 个池子", pair, count);
            }
        }

        if multi_pools.is_empty() {
            println!("   ❌ 警告: 没有发现任何可套利的交易对!");
            println!("   💡 提示: 需要在不同DEX上加载同一交易对的池子");
        }

        // 1. 寻找直接套利机会（最简单，最快）
        let direct_start = std::time::Instant::now();
        let direct_paths = self.find_direct_arbitrage(initial_amount);
        println!("   ⏱️  直接套利扫描完成: {} 条路径 (耗时: {:?})", direct_paths.len(), direct_start.elapsed());

        // 🔍 显示直接套利的详细路径
        if !direct_paths.is_empty() {
            println!("   📋 直接套利路径详情:");
            for (i, path) in direct_paths.iter().enumerate() {
                println!("\n   [直接套利 {}] ROI: {:.6}%", i + 1, path.roi_percent);
                println!("   {}", self.format_arbitrage_path_for_debug(path));
            }
        }

        all_paths.extend(direct_paths);

        // 2. 寻找三角套利机会
        let triangle_start = std::time::Instant::now();
        let triangle_paths = self.find_triangle_arbitrage(initial_amount);
        println!("   ⏱️  三角套利扫描完成: {} 条路径 (耗时: {:?})", triangle_paths.len(), triangle_start.elapsed());

        // 🔍 显示三角套利的详细路径
        if !triangle_paths.is_empty() {
            println!("   📋 三角套利路径详情:");
            for (i, path) in triangle_paths.iter().enumerate() {
                println!("\n   [三角套利 {}] ROI: {:.6}%", i + 1, path.roi_percent);
                println!("   {}", self.format_arbitrage_path_for_debug(path));
            }
        }

        all_paths.extend(triangle_paths);

        // 3. 寻找多跳套利机会（可选，较复杂）
        // let multihop_paths = self.find_multihop_arbitrage(initial_amount);
        // all_paths.extend(multihop_paths);
        
        // 过滤有效路径
        all_paths.retain(|p| p.is_valid());
        
        // 按得分排序
        all_paths.sort_by(|a, b| b.score().partial_cmp(&a.score()).unwrap());
        
        all_paths
    }
    
    /// 策略1：直接套利
    /// 寻找同一交易对在不同DEX之间的价差
    fn find_direct_arbitrage(&self, initial_amount: f64) -> Vec<ArbitragePath> {
        let mut paths = Vec::new();
        let all_prices = self.price_cache.get_all_prices();
        
        // 按交易对分组
        let mut pairs_map: HashMap<String, Vec<PoolPrice>> = HashMap::new();
        for price in all_prices {
            pairs_map.entry(price.pair.clone())
                .or_insert_with(Vec::new)
                .push(price);
        }
        
        // 检查每个交易对
        for (_pair, pools) in pairs_map.iter() {
            if pools.len() < 2 {
                continue;
            }
            
            // 比较所有池子组合
            for i in 0..pools.len() {
                for j in (i + 1)..pools.len() {
                    if let Some(path) = self.create_direct_path(
                        &pools[i],
                        &pools[j],
                        initial_amount,
                    ) {
                        paths.push(path);
                    }
                }
            }
        }
        
        paths
    }
    
    /// 创建直接套利路径
    fn create_direct_path(
        &self,
        pool_a: &PoolPrice,
        pool_b: &PoolPrice,
        initial_amount: f64,
    ) -> Option<ArbitragePath> {
        // 确定哪个池子价格低（买入），哪个价格高（卖出）
        let (buy_pool, sell_pool) = if pool_a.price < pool_b.price {
            (pool_a, pool_b)
        } else {
            (pool_b, pool_a)
        };
        
        // 检查价差是否足够大
        let price_diff_pct = ((sell_pool.price - buy_pool.price) / buy_pool.price) * 100.0;
        
        if price_diff_pct < 0.5 {
            return None; // 价差太小
        }
        
        // 解析交易对（例如 "SOL/USDC" -> base=SOL, quote=USDC）
        let tokens: Vec<&str> = buy_pool.pair.split('/').collect();
        if tokens.len() != 2 {
            return None;
        }
        
        let base_token = tokens[0];
        let quote_token = tokens[1];
        
        // 路径：quote → base (买入) → quote (卖出)
        // 例如：USDC → SOL → USDC
        
        // 🔥 使用精确AMM公式计算
        use crate::dex_interface::amm_calculator;
        
        // 步骤1：在低价池买入 base_token
        let fee1 = self.get_dex_fee(&buy_pool.dex_name);
        
        // 转换储备量为浮点数
        let (base_decimals, quote_decimals) = buy_pool.get_decimals();
        let buy_base_reserve = buy_pool.base_reserve as f64 / 10f64.powi(base_decimals as i32);
        let buy_quote_reserve = buy_pool.quote_reserve as f64 / 10f64.powi(quote_decimals as i32);
        
        // 使用AMM公式：quote → base
        let base_amount = amm_calculator::calculate_amm_output_f64(
            initial_amount,
            buy_quote_reserve,  // reserve_in (USDC)
            buy_base_reserve,   // reserve_out (SOL)
            fee1,
        );
        
        let step1 = RouteStep {
            pool_id: buy_pool.pool_id.clone(),
            dex_name: buy_pool.dex_name.clone(),
            input_token: quote_token.to_string(),
            output_token: base_token.to_string(),
            price: buy_pool.price,
            liquidity_base: buy_pool.base_reserve,
            liquidity_quote: buy_pool.quote_reserve,
            expected_input: initial_amount,
            expected_output: base_amount,
        };
        
        // 步骤2：在高价池卖出 base_token
        let fee2 = self.get_dex_fee(&sell_pool.dex_name);
        
        // 转换储备量为浮点数
        let (sell_base_decimals, sell_quote_decimals) = sell_pool.get_decimals();
        let sell_base_reserve = sell_pool.base_reserve as f64 / 10f64.powi(sell_base_decimals as i32);
        let sell_quote_reserve = sell_pool.quote_reserve as f64 / 10f64.powi(sell_quote_decimals as i32);
        
        // 使用AMM公式：base → quote
        let final_amount = amm_calculator::calculate_amm_output_f64(
            base_amount,
            sell_base_reserve,  // reserve_in (SOL)
            sell_quote_reserve, // reserve_out (USDC)
            fee2,
        );
        
        let step2 = RouteStep {
            pool_id: sell_pool.pool_id.clone(),
            dex_name: sell_pool.dex_name.clone(),
            input_token: base_token.to_string(),
            output_token: quote_token.to_string(),
            price: sell_pool.price,
            liquidity_base: sell_pool.base_reserve,
            liquidity_quote: sell_pool.quote_reserve,
            expected_input: base_amount,
            expected_output: final_amount,
        };
        
        // 计算利润
        let gross_profit = final_amount - initial_amount;
        let total_fees = initial_amount * (fee1 + fee2);
        let gas_estimate = 0.0001; // Solana上约0.0001 SOL的gas费（需转换为quote代币）
        let net_profit = gross_profit - gas_estimate;
        let roi_percent = (net_profit / initial_amount) * 100.0;
        
        // 检查是否满足最小ROI
        if roi_percent < self.min_roi_percent {
            return None;
        }
        
        Some(ArbitragePath {
            arb_type: ArbitrageType::Direct,
            steps: vec![step1, step2],
            start_token: quote_token.to_string(),
            end_token: quote_token.to_string(),
            input_amount: initial_amount,
            output_amount: final_amount,
            gross_profit,
            estimated_fees: total_fees + gas_estimate,
            net_profit,
            roi_percent,
            discovered_at: Instant::now(),
        })
    }
    
    /// 策略2：三角套利
    /// 寻找 A→B→C→A 的循环路径
    fn find_triangle_arbitrage(&self, initial_amount: f64) -> Vec<ArbitragePath> {
        let mut paths = Vec::new();
        
        // 构建代币图
        let token_graph = self.build_token_graph();
        
        // 对每个代币作为起点
        for start_token in token_graph.keys() {
            // 寻找从该代币出发的三角套利
            let triangle_paths = self.find_triangles_from_token(
                start_token,
                &token_graph,
                initial_amount,
            );
            paths.extend(triangle_paths);
        }
        
        paths
    }
    
    /// 构建代币图（代币之间的连接关系）
    /// 
    /// 🔥 优化：保留同一交易对的所有池子，不去重
    /// 这样可以在三角套利中尝试所有可能的池子组合，避免遗漏5-10%的机会
    fn build_token_graph(&self) -> HashMap<String, Vec<(String, PoolPrice)>> {
        let mut graph: HashMap<String, Vec<(String, PoolPrice)>> = HashMap::new();
        let all_prices = self.price_cache.get_all_prices();
        
        for pool in all_prices {
            let tokens: Vec<&str> = pool.pair.split('/').collect();
            if tokens.len() != 2 {
                continue;
            }
            
            let base = tokens[0].to_string();
            let quote = tokens[1].to_string();
            
            // 🔥 添加正向边：quote → base
            // 每个池子都单独添加，即使同一交易对有多个池子
            graph.entry(quote.clone())
                .or_insert_with(Vec::new)
                .push((base.clone(), pool.clone()));
            
            // 🔥 添加反向边：base → quote
            // 同样保留所有池子
            let mut reverse_pool = pool.clone();
            reverse_pool.price = 1.0 / pool.price;
            graph.entry(base)
                .or_insert_with(Vec::new)
                .push((quote, reverse_pool));
        }
        
        graph
    }
    
    /// 从指定代币寻找三角套利路径
    fn find_triangles_from_token(
        &self,
        start_token: &str,
        graph: &HashMap<String, Vec<(String, PoolPrice)>>,
        initial_amount: f64,
    ) -> Vec<ArbitragePath> {
        let mut paths = Vec::new();
        
        // 获取从起始代币出发的所有可能第一步
        let first_hops = match graph.get(start_token) {
            Some(hops) => hops,
            None => return paths,
        };
        
        // 尝试每个第一步
        for (token_b, pool_ab) in first_hops {
            // 获取从token_b出发的第二步
            let second_hops = match graph.get(token_b) {
                Some(hops) => hops,
                None => continue,
            };
            
            // 尝试每个第二步
            for (token_c, pool_bc) in second_hops {
                // 跳过回到起点的情况（这是第一步的反向）
                if token_c == start_token {
                    continue;
                }
                
                // 获取从token_c回到起点的第三步
                let third_hops = match graph.get(token_c) {
                    Some(hops) => hops,
                    None => continue,
                };
                
                // 查找回到起点的路径
                for (token_end, pool_ca) in third_hops {
                    if token_end != start_token {
                        continue;
                    }
                    
                    // 找到了完整的三角：start → B → C → start
                    if let Some(path) = self.calculate_triangle_path(
                        start_token,
                        token_b,
                        token_c,
                        pool_ab,
                        pool_bc,
                        pool_ca,
                        initial_amount,
                    ) {
                        paths.push(path);
                    }
                }
            }
        }
        
        paths
    }
    
    /// 计算三角套利路径的收益
    fn calculate_triangle_path(
        &self,
        token_a: &str,
        token_b: &str,
        token_c: &str,
        pool_ab: &PoolPrice,
        pool_bc: &PoolPrice,
        pool_ca: &PoolPrice,
        initial_amount: f64,
    ) -> Option<ArbitragePath> {
        // 🔥 使用精确AMM公式计算三角套利
        use crate::dex_interface::amm_calculator;
        
        // 步骤1：A → B
        let fee1 = self.get_dex_fee(&pool_ab.dex_name);
        let (reserve_in_ab, reserve_out_ab) = self.get_directional_reserves_for_pair(
            pool_ab, token_a, token_b
        );
        
        let amount_b = amm_calculator::calculate_amm_output_f64(
            initial_amount,
            reserve_in_ab,
            reserve_out_ab,
            fee1,
        );
        
        let step1 = RouteStep {
            pool_id: pool_ab.pool_id.clone(),
            dex_name: pool_ab.dex_name.clone(),
            input_token: token_a.to_string(),
            output_token: token_b.to_string(),
            price: pool_ab.price,
            liquidity_base: pool_ab.base_reserve,
            liquidity_quote: pool_ab.quote_reserve,
            expected_input: initial_amount,
            expected_output: amount_b,
        };
        
        // 步骤2：B → C
        let fee2 = self.get_dex_fee(&pool_bc.dex_name);
        let (reserve_in_bc, reserve_out_bc) = self.get_directional_reserves_for_pair(
            pool_bc, token_b, token_c
        );
        
        let amount_c = amm_calculator::calculate_amm_output_f64(
            amount_b,
            reserve_in_bc,
            reserve_out_bc,
            fee2,
        );
        
        let step2 = RouteStep {
            pool_id: pool_bc.pool_id.clone(),
            dex_name: pool_bc.dex_name.clone(),
            input_token: token_b.to_string(),
            output_token: token_c.to_string(),
            price: pool_bc.price,
            liquidity_base: pool_bc.base_reserve,
            liquidity_quote: pool_bc.quote_reserve,
            expected_input: amount_b,
            expected_output: amount_c,
        };
        
        // 步骤3：C → A
        let fee3 = self.get_dex_fee(&pool_ca.dex_name);
        let (reserve_in_ca, reserve_out_ca) = self.get_directional_reserves_for_pair(
            pool_ca, token_c, token_a
        );
        
        let final_amount = amm_calculator::calculate_amm_output_f64(
            amount_c,
            reserve_in_ca,
            reserve_out_ca,
            fee3,
        );
        
        let step3 = RouteStep {
            pool_id: pool_ca.pool_id.clone(),
            dex_name: pool_ca.dex_name.clone(),
            input_token: token_c.to_string(),
            output_token: token_a.to_string(),
            price: pool_ca.price,
            liquidity_base: pool_ca.base_reserve,
            liquidity_quote: pool_ca.quote_reserve,
            expected_input: amount_c,
            expected_output: final_amount,
        };
        
        // 计算利润
        let gross_profit = final_amount - initial_amount;
        let total_fees = initial_amount * (fee1 + fee2 + fee3);
        let gas_estimate = 0.0002; // 3跳的gas费更高
        let net_profit = gross_profit - gas_estimate;
        let roi_percent = (net_profit / initial_amount) * 100.0;
        
        // 检查是否满足最小ROI
        if roi_percent < self.min_roi_percent {
            return None;
        }
        
        Some(ArbitragePath {
            arb_type: ArbitrageType::Triangle,
            steps: vec![step1, step2, step3],
            start_token: token_a.to_string(),
            end_token: token_a.to_string(),
            input_amount: initial_amount,
            output_amount: final_amount,
            gross_profit,
            estimated_fees: total_fees + gas_estimate,
            net_profit,
            roi_percent,
            discovered_at: Instant::now(),
        })
    }
    
    /// 获取DEX的手续费率
    fn get_dex_fee(&self, dex_name: &str) -> f64 {
        *self.dex_fees.get(dex_name).unwrap_or(&0.003) // 默认0.3%
    }
    
    /// 获取交易方向的储备量
    /// 
    /// 根据交易方向（from_token → to_token），正确提取输入和输出储备量
    fn get_directional_reserves_for_pair(
        &self,
        pool: &PoolPrice,
        from_token: &str,
        to_token: &str,
    ) -> (f64, f64) {
        let (base_reserve, quote_reserve) = pool.get_reserves();
        let (base_decimals, quote_decimals) = pool.get_decimals();
        
        // 转换为浮点数
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
        if from_token == quote_token && to_token == base_token {
            // quote → base (买入base)
            (quote_reserve_f64, base_reserve_f64)
        } else if from_token == base_token && to_token == quote_token {
            // base → quote (卖出base)
            (base_reserve_f64, quote_reserve_f64)
        } else {
            // 降级处理：无法确定方向，使用默认
            (base_reserve_f64, quote_reserve_f64)
        }
    }
    
    /// 🎯 选择最优路径
    #[allow(dead_code)]
    pub fn select_best_path<'a>(&self, paths: &'a [ArbitragePath]) -> Option<&'a ArbitragePath> {
        if paths.is_empty() {
            return None;
        }
        
        // 已经按score排序，直接返回第一个
        paths.first()
    }
    
    /// 格式化路径输出
    #[allow(dead_code)]
    pub fn format_path(&self, path: &ArbitragePath) -> String {
        let mut output = String::new();
        
        output.push_str(&format!("🔥 {:?} 套利机会\n", path.arb_type));
        output.push_str(&format!("   初始: {} {} → 最终: {} {}\n",
            path.input_amount, path.start_token,
            path.output_amount, path.end_token));
        output.push_str(&format!("   净利润: {:.6} {} ({:.2}% ROI)\n",
            path.net_profit, path.start_token, path.roi_percent));
        output.push_str("   路径:\n");

        for (idx, step) in path.steps.iter().enumerate() {
            output.push_str(&format!("     {}. [{}] {} → {} (价格: {:.6})\n",
                idx + 1,
                step.dex_name,
                step.input_token,
                step.output_token,
                step.price));
        }

        output
    }

    /// 🔥 调试专用：格式化ArbitragePath（显示更多细节）
    fn format_arbitrage_path_for_debug(&self, path: &ArbitragePath) -> String {
        let mut output = String::new();

        output.push_str(&format!(
            "   📊 套利类型: {:?}\n",
            path.arb_type
        ));
        output.push_str(&format!(
            "   💰 初始金额: {:.6} {}\n",
            path.input_amount,
            path.start_token
        ));
        output.push_str(&format!(
            "   💵 最终金额: {:.6} {}\n",
            path.output_amount,
            path.end_token
        ));
        output.push_str(&format!(
            "   📈 毛利润: {:.6} {}\n",
            path.gross_profit,
            path.start_token
        ));
        output.push_str(&format!(
            "   💸 估算费用: {:.6} {}\n",
            path.estimated_fees,
            path.start_token
        ));
        output.push_str(&format!(
            "   🎯 净利润: {:.6} {}\n",
            path.net_profit,
            path.start_token
        ));
        output.push_str(&format!(
            "   📊 ROI: {:.6}%\n",
            path.roi_percent
        ));
        output.push_str(&format!(
            "   ⏱️  发现时间: {:?}\n",
            path.discovered_at.elapsed()
        ));

        // 显示有效性检查
        let is_valid_loop = path.start_token == path.end_token;
        let is_valid_profit = path.net_profit > 0.0;
        let is_valid_roi = path.roi_percent >= self.min_roi_percent;
        let is_valid_steps = path.steps.len() >= 2 && path.steps.len() <= 5;

        output.push_str(&format!(
            "   ✅ 有效性检查: 循环={}, 利润={}, ROI≥{}%={}, 跳数={}\n",
            if is_valid_loop { "✓" } else { "✗" },
            if is_valid_profit { "✓" } else { "✗" },
            self.min_roi_percent,
            if is_valid_roi { "✓" } else { "✗" },
            if is_valid_steps { "✓" } else { "✗" }
        ));

        // 显示每条步骤的详细信息
        output.push_str(&format!(
            "   🛣️  路由步骤 ({}跳):\n",
            path.steps.len()
        ));

        for (idx, step) in path.steps.iter().enumerate() {
            output.push_str(&format!("\n   [{}/{}] [{}] {} → {}\n",
                idx + 1,
                path.steps.len(),
                step.dex_name,
                step.input_token,
                step.output_token
            ));
            output.push_str(&format!("        价格: {:.6}\n", step.price));
            output.push_str(&format!("        输入: {:.6} {}\n", step.expected_input, step.input_token));
            output.push_str(&format!("        输出: {:.6} {}\n", step.expected_output, step.output_token));
            output.push_str(&format!("        池子ID: {}\n", step.pool_id));
            output.push_str(&format!("        流动性: base={}, quote={}\n",
                step.liquidity_base,
                step.liquidity_quote
            ));
        }

        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_arbitrage_path_validation() {
        let path = ArbitragePath {
            arb_type: ArbitrageType::Direct,
            steps: vec![],
            start_token: "USDC".to_string(),
            end_token: "USDC".to_string(),
            input_amount: 100.0,
            output_amount: 101.0,
            gross_profit: 1.0,
            estimated_fees: 0.3,
            net_profit: 0.7,
            roi_percent: 0.7,
            discovered_at: Instant::now(),
        };
        
        // 应该失败：没有步骤
        assert!(!path.is_valid());
    }
    
    #[test]
    fn test_router_creation() {
        use std::sync::Arc;
        let cache = Arc::new(PriceCache::new());
        let router = Router::new(cache);
        
        assert_eq!(router.min_roi_percent, 0.3);
        assert_eq!(router.max_depth, 4);
        assert!(router.dex_fees.contains_key("Raydium AMM V4"));
    }
}

