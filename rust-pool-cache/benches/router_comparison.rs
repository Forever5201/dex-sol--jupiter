/*!
 * 路由器性能基准测试
 * 
 * 对比优化前后的性能差异
 */

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use solana_pool_cache::price_cache::{PoolPrice, PriceCache};
use solana_pool_cache::router::Router;
use solana_pool_cache::router_bfs::BfsScanner;
use solana_pool_cache::router_bellman_ford::BellmanFordScanner;
use std::sync::Arc;
use std::time::Instant;

fn create_realistic_pool_set(num_pools: usize) -> Vec<PoolPrice> {
    let pairs = vec!["SOL/USDC", "SOL/USDT", "USDC/USDT", "SOL/RAY", "RAY/USDC"];
    let dexes = vec!["Raydium", "Orca", "Meteora", "Phoenix"];
    
    let mut pools = Vec::new();
    for i in 0..num_pools {
        let pair = pairs[i % pairs.len()];
        let dex = dexes[i % dexes.len()];
        let base_price = 185.0 + (i as f64 * 0.1);
        
        pools.push(PoolPrice {
            pool_id: format!("pool_{}", i),
            dex_name: dex.to_string(),
            pair: pair.to_string(),
            base_reserve: 1000_000_000_000,
            quote_reserve: (base_price * 1000.0 * 1_000_000.0) as u64,
            base_decimals: 9,
            quote_decimals: 6,
            price: base_price,
            last_update: Instant::now(),
            slot: 1000,
        });
    }
    
    pools
}

fn bench_quick_scanner(c: &mut Criterion) {
    let price_cache = Arc::new(PriceCache::new());
    
    // 预填充缓存
    for pool in create_realistic_pool_set(32) {
        price_cache.update_price(pool);
    }
    
    let router = Router::new(price_cache);
    
    c.bench_function("quick_scanner_32_pools", |b| {
        b.iter(|| {
            router.find_all_opportunities(black_box(1000.0))
        })
    });
}

fn bench_bfs_scanner(c: &mut Criterion) {
    let pools = create_realistic_pool_set(32);
    let scanner = BfsScanner::new(3, 0.1);
    
    c.bench_function("bfs_scanner_32_pools", |b| {
        b.iter(|| {
            scanner.find_all_opportunities(black_box(&pools), black_box(1000.0))
        })
    });
}

fn bench_bellman_ford_scanner(c: &mut Criterion) {
    let pools = create_realistic_pool_set(32);
    let scanner = BellmanFordScanner::new(6, 0.1);
    
    c.bench_function("bellman_ford_32_pools", |b| {
        b.iter(|| {
            scanner.find_all_cycles(black_box(&pools), black_box(1000.0))
        })
    });
}

fn bench_scaling(c: &mut Criterion) {
    let mut group = c.benchmark_group("router_scaling");
    
    for pool_count in [10, 20, 32, 50, 100].iter() {
        let pools = create_realistic_pool_set(*pool_count);
        let scanner = BfsScanner::new(3, 0.1);
        
        group.bench_with_input(
            BenchmarkId::new("bfs", pool_count),
            pool_count,
            |b, _| {
                b.iter(|| {
                    scanner.find_all_opportunities(&pools, 1000.0)
                })
            },
        );
    }
    
    group.finish();
}

criterion_group!(
    benches,
    bench_quick_scanner,
    bench_bfs_scanner,
    bench_bellman_ford_scanner,
    bench_scaling
);

criterion_main!(benches);

