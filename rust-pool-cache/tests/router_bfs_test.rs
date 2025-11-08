/*!
 * BFS路由器测试
 * 
 * 验证BFS算法的正确性和性能
 */

use solana_pool_cache::router_bfs::BfsScanner;
use solana_pool_cache::price_cache::{PoolPrice, PriceCache};
use std::time::Instant;
use std::sync::Arc;

fn create_test_pool(
    pool_id: &str,
    dex_name: &str,
    pair: &str,
    price: f64,
    base_reserve: u64,
    quote_reserve: u64,
) -> PoolPrice {
    PoolPrice {
        pool_id: pool_id.to_string(),
        dex_name: dex_name.to_string(),
        pair: pair.to_string(),
        base_reserve,
        quote_reserve,
        base_decimals: 9,
        quote_decimals: 6,
        price,
        last_update: Instant::now(),
        slot: 1000,
    }
}

#[test]
fn test_bfs_simple_2hop() {
    // 简单2跳套利：SOL/USDC价差
    let pools = vec![
        create_test_pool("pool1", "Raydium", "SOL/USDC", 185.0, 1000_000_000_000, 185_000_000_000),
        create_test_pool("pool2", "Orca", "SOL/USDC", 186.0, 1000_000_000_000, 186_000_000_000),
    ];
    
    let scanner = BfsScanner::new(3, 0.1);
    let paths = scanner.find_all_opportunities(&pools, 1000.0);
    
    // 应该找到至少1条路径：USDC → SOL (pool1) → USDC (pool2)
    assert!(paths.len() >= 1, "Should find at least 1 arbitrage path");
    
    // 验证第一条路径是有利可图的
    assert!(paths[0].net_profit > 0.0, "Path should be profitable");
    assert_eq!(paths[0].steps.len(), 2, "Should be 2-hop path");
}

#[test]
fn test_bfs_triangle_3hop() {
    // 三角套利：SOL → USDC → USDT → SOL
    let pools = vec![
        create_test_pool("pool1", "Raydium", "SOL/USDC", 185.0, 1000_000_000_000, 185_000_000_000),
        create_test_pool("pool2", "Orca", "USDC/USDT", 1.001, 1_000_000_000, 1_001_000_000),
        create_test_pool("pool3", "Meteora", "USDT/SOL", 0.00541, 1_000_000_000, 5_410_000_000_000),
    ];
    
    let scanner = BfsScanner::new(4, 0.05);
    let paths = scanner.find_all_opportunities(&pools, 1.0);  // 1 SOL
    
    // 应该找到三角套利路径
    assert!(paths.len() >= 1, "Should find triangle arbitrage");
    
    for path in &paths {
        assert_eq!(path.steps.len(), 3, "Should be 3-hop triangle");
        assert_eq!(path.start_token, path.end_token, "Should be circular");
    }
}

#[test]
fn test_bfs_early_pruning() {
    // 测试早期剪枝：如果第一跳就亏损，应该被剪掉
    let pools = vec![
        create_test_pool("pool1", "Raydium", "SOL/USDC", 185.0, 1000_000_000_000, 185_000_000_000),
        create_test_pool("pool2", "Orca", "SOL/USDC", 180.0, 1000_000_000_000, 180_000_000_000),  // 价格更低
        create_test_pool("pool3", "Meteora", "USDC/USDT", 1.0, 1_000_000_000, 1_000_000_000),
    ];
    
    let scanner = BfsScanner::new(4, 0.1);
    let paths = scanner.find_all_opportunities(&pools, 1000.0);
    
    // pool2价格更低，不应该产生有效套利
    for path in &paths {
        assert!(path.net_profit > 0.0, "All returned paths should be profitable");
    }
}

#[test]
fn test_bfs_no_infinite_loop() {
    // 测试不会陷入无限循环（即使图中有环）
    let pools = vec![
        create_test_pool("pool1", "Raydium", "SOL/USDC", 185.0, 1000_000_000_000, 185_000_000_000),
        create_test_pool("pool2", "Orca", "USDC/SOL", 0.0054, 185_000_000_000, 1000_000_000_000),
        create_test_pool("pool3", "Meteora", "SOL/USDC", 184.0, 1000_000_000_000, 184_000_000_000),
    ];
    
    let scanner = BfsScanner::new(3, 0.1);
    
    // 应该在合理时间内完成（不死循环）
    let start = std::time::Instant::now();
    let _paths = scanner.find_all_opportunities(&pools, 1000.0);
    let elapsed = start.elapsed();
    
    assert!(elapsed.as_millis() < 100, "BFS should complete within 100ms, took: {}ms", elapsed.as_millis());
}

#[test]
fn test_bfs_path_deduplication() {
    // 测试路径去重
    let pools = vec![
        create_test_pool("pool1", "Raydium", "SOL/USDC", 185.0, 1000_000_000_000, 185_000_000_000),
        create_test_pool("pool2", "Orca", "SOL/USDC", 186.0, 1000_000_000_000, 186_000_000_000),
        create_test_pool("pool3", "Meteora", "SOL/USDC", 185.5, 1000_000_000_000, 185_500_000_000),
    ];
    
    let scanner = BfsScanner::new(3, 0.1);
    let paths = scanner.find_all_opportunities(&pools, 1000.0);
    
    // 验证没有完全重复的路径
    let mut signatures = std::collections::HashSet::new();
    for path in &paths {
        let sig = format!("{:?}", path.steps.iter().map(|s| &s.pool_id).collect::<Vec<_>>());
        assert!(!signatures.contains(&sig), "Found duplicate path");
        signatures.insert(sig);
    }
}

