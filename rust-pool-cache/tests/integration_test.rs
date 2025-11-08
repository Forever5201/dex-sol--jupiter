/*!
 * 集成测试 - 验证完整路由器功能
 */

#[cfg(test)]
mod integration_tests {
    use solana_pool_cache::price_cache::{PoolPrice, PriceCache};
    use solana_pool_cache::router_advanced::{AdvancedRouter, AdvancedRouterConfig, RouterMode};
    use std::sync::Arc;
    use std::time::Instant;
    
    #[tokio::test]
    async fn test_complete_router_workflow() {
        // 测试完整的路由器工作流程
        
        // 1. 创建测试数据
        let cache = Arc::new(PriceCache::new());
        
        // 添加测试池子
        let pools = create_test_pools();
        for pool in pools {
            cache.update_price(pool);
        }
        
        // 2. 创建高级路由器
        let config = AdvancedRouterConfig {
            mode: RouterMode::Complete,
            min_roi_percent: 0.1,
            max_hops: 6,
            enable_split_optimization: true,
            max_splits: 5,
            min_split_amount: 100.0,
        };
        
        let router = AdvancedRouter::new(cache, config);
        
        // 3. 寻找机会
        let routes = router.find_optimal_routes(1000.0).await;
        
        // 4. 验证结果
        println!("Found {} routes", routes.len());
        
        if !routes.is_empty() {
            let best = router.select_best(&routes);
            assert!(best.is_some());
            
            let best_route = best.unwrap();
            println!("Best route ROI: {}%", best_route.optimized_roi);
            println!("Best route profit: {}", best_route.optimized_net_profit);
        }
    }
    
    #[tokio::test]
    async fn test_mode_switching() {
        // 测试不同模式的行为
        let cache = Arc::new(PriceCache::new());
        
        for pool in create_test_pools() {
            cache.update_price(pool);
        }
        
        // Fast模式
        let config_fast = AdvancedRouterConfig {
            mode: RouterMode::Fast,
            ..Default::default()
        };
        let router_fast = AdvancedRouter::new(cache.clone(), config_fast);
        let fast_routes = router_fast.find_optimal_routes(1000.0).await;
        
        // Complete模式
        let config_complete = AdvancedRouterConfig {
            mode: RouterMode::Complete,
            ..Default::default()
        };
        let router_complete = AdvancedRouter::new(cache.clone(), config_complete);
        let complete_routes = router_complete.find_optimal_routes(1000.0).await;
        
        // Complete模式应该找到 >= Fast模式的机会
        println!("Fast mode: {} routes", fast_routes.len());
        println!("Complete mode: {} routes", complete_routes.len());
        
        // 注意：可能相等（如果没有复杂路径）
        assert!(complete_routes.len() >= fast_routes.len());
    }
    
    // Helper: 创建测试池子
    fn create_test_pools() -> Vec<PoolPrice> {
        vec![
            PoolPrice {
                pool_id: "raydium_sol_usdc".to_string(),
                dex_name: "Raydium AMM V4".to_string(),
                pair: "SOL/USDC".to_string(),
                price: 150.0,
                base_reserve: 1_000_000_000_000_000, // 1M SOL
                quote_reserve: 150_000_000_000_000,   // 150M USDC
                base_decimals: 9,
                quote_decimals: 6,
                last_update: Instant::now(),
                slot: 1000,
            },
            PoolPrice {
                pool_id: "orca_sol_usdc".to_string(),
                dex_name: "Orca Whirlpool".to_string(),
                pair: "SOL/USDC".to_string(),
                price: 150.5,
                base_reserve: 800_000_000_000_000,
                quote_reserve: 120_400_000_000_000,
                base_decimals: 9,
                quote_decimals: 6,
                last_update: Instant::now(),
                slot: 1000,
            },
            PoolPrice {
                pool_id: "solfi_usdc_usdt".to_string(),
                dex_name: "SolFi V2".to_string(),
                pair: "USDC/USDT".to_string(),
                price: 1.0001,
                base_reserve: 10_000_000_000_000,
                quote_reserve: 10_001_000_000_000,
                base_decimals: 6,
                quote_decimals: 6,
                last_update: Instant::now(),
                slot: 1000,
            },
            PoolPrice {
                pool_id: "raydium_sol_usdt".to_string(),
                dex_name: "Raydium AMM V4".to_string(),
                pair: "SOL/USDT".to_string(),
                price: 150.3,
                base_reserve: 900_000_000_000_000,
                quote_reserve: 135_270_000_000_000,
                base_decimals: 9,
                quote_decimals: 6,
                last_update: Instant::now(),
                slot: 1000,
            },
        ]
    }
}







