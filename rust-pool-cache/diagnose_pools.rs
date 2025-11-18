use rust_pool_cache::price_cache::PriceCache;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let price_cache = Arc::new(PriceCache::new());

    // 等待30秒让WebSocket加载数据
    println!("等待30秒加载池子数据...");
    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

    // 获取所有池子
    let all_prices = price_cache.get_all_prices();

    println!("\n========== 池子数据诊断报告 ==========\n");
    println!("总池子数量: {}", all_prices.len());

    if all_prices.is_empty() {
        println!("❌ 严重错误: 没有加载到任何池子数据！");
        println!("可能原因:");
        println!("  1. WebSocket连接失败");
        println!("  2. 池子地址配置错误");
        println!("  3. Helius API没有返回数据");
        return;
    }

    // 按交易对分组
    use std::collections::HashMap;
    let mut pair_map: HashMap<String, Vec<_>> = HashMap::new();
    let mut dex_map: HashMap<String, usize> = HashMap::new();

    for price in &all_prices {
        pair_map.entry(price.pair.clone()).or_insert_with(Vec::new).push(price);
        *dex_map.entry(price.dex_name.clone()).or_insert(0) += 1;
    }

    println!("\n唯一交易对数量: {}", pair_map.len());
    println!("\n各交易对的池子分布:");
    for (pair, pools) in &pair_map {
        println!("  {}: {} 个池子", pair, pools.len());
        for pool in pools {
            println!("    - {} (价格: {:.6})", pool.dex_name, pool.price);
        }
    }

    println!("\nDEX分布:");
    for (dex, count) in &dex_map {
        println!("  {}: {} 个池子", dex, count);
    }

    // 检查可套利对
    let arbitrable_pairs: Vec<_> = pair_map.iter()
        .filter(|(_, pools)| pools.len() >= 2)
        .collect();

    println!("\n可套利交易对 (≥2个池子): {}", arbitrable_pairs.len());

    if arbitrable_pairs.is_empty() {
        println!("❌ 警告: 没有可套利的交易对！");
        println!("需要在至少一个交易对的多个DEX上配置池子");
    } else {
        println!("\n✅ 发现可套利机会:");
        for (pair, pools) in &arbitrable_pairs {
            println!("\n  {}:", pair);
            let prices: Vec<f64> = pools.iter().map(|p| p.price).collect();
            let min_price = prices.iter().cloned().fold(f64::INFINITY, f64::min);
            let max_price = prices.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let diff_pct = ((max_price - min_price) / min_price) * 100.0;

            println!("    价格范围: {:.6} - {:.6}", min_price, max_price);
            println!("    价差: {:.3}%", diff_pct);

            if diff_pct >= 0.5 {
                println!("    ✅ 价差≥0.5%，应该能发现路径");
            } else {
                println!("    ⚠️  价差<0.5%，会被过滤");
            }
        }
    }

    println!("\n========== 诊断完成 ==========\n");
}
