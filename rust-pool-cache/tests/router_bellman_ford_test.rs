/*!
 * Bellman-Ford算法测试
 */

#[cfg(test)]
mod bellman_ford_tests {
    use solana_pool_cache::price_cache::{PoolPrice, PriceCache};
    use solana_pool_cache::router_bellman_ford::BellmanFordScanner;
    use std::time::Instant;
    
    #[test]
    fn test_simple_triangle_detection() {
        // 测试简单的3跳套利检测
        // USDC → SOL → USDT → USDC
        
        let pools = vec![
            create_test_pool("pool1", "SOL/USDC", "Raydium AMM V4", 150.0, 1000000, 150000000),
            create_test_pool("pool2", "SOL/USDT", "Orca Whirlpool", 150.5, 1000000, 150500000),
            create_test_pool("pool3", "USDC/USDT", "SolFi V2", 1.001, 10000000, 10010000),
        ];
        
        let scanner = BellmanFordScanner::new(6, 0.1);
        let cycles = scanner.find_all_cycles(&pools, 1000.0);
        
        // 应该找到至少一个循环
        assert!(!cycles.is_empty(), "Should find at least one arbitrage cycle");
        
        // 检查第一个循环
        let first_cycle = &cycles[0];
        assert!(first_cycle.steps.len() >= 2);
        assert!(first_cycle.steps.len() <= 6);
    }
    
    #[test]
    fn test_negative_cycle_profit() {
        // 测试：确保检测到的循环确实有利润
        let pools = vec![
            create_test_pool("pool1", "SOL/USDC", "Raydium AMM V4", 150.0, 1000000, 150000000),
            create_test_pool("pool2", "SOL/USDC", "Lifinity V2", 151.0, 800000, 120800000),
        ];
        
        let scanner = BellmanFordScanner::new(6, 0.3);
        let cycles = scanner.find_all_cycles(&pools, 1000.0);
        
        for cycle in &cycles {
            // 每个检测到的循环应该有正利润
            assert!(cycle.net_profit > 0.0, "Cycle should have positive profit");
            assert!(cycle.roi_percent >= 0.3, "Cycle should meet minimum ROI");
        }
    }
    
    #[test]
    fn test_max_hops_limit() {
        // 测试最大跳数限制
        let scanner = BellmanFordScanner::new(4, 0.1);
        
        // TODO: 创建更复杂的图来测试跳数限制
    }
    
    // Helper function
    fn create_test_pool(
        id: &str,
        pair: &str,
        dex: &str,
        price: f64,
        base_reserve: u64,
        quote_reserve: u64,
    ) -> PoolPrice {
        PoolPrice {
            pool_id: id.to_string(),
            dex_name: dex.to_string(),
            pair: pair.to_string(),
            price,
            base_reserve,
            quote_reserve,
            base_decimals: 9,
            quote_decimals: 6,
            last_update: Instant::now(),
            slot: 1000,
        }
    }
}







