/// 🔥 池子统计功能演示程序
/// 
/// 功能：演示PoolStatsCollector的所有功能
/// 用法：cargo run --example test_pool_stats

use solana_pool_cache::pool_stats::PoolStatsCollector;
use std::thread;
use std::time::Duration;

fn main() {
    println!("\n╔═══════════════════════════════════════════════════════════╗");
    println!("║       🔥 池子活跃度统计系统功能演示                     ║");
    println!("╚═══════════════════════════════════════════════════════════╝\n");

    // 创建统计收集器（价格变化阈值0.05%）
    let collector = PoolStatsCollector::new(0.05);

    println!("📝 模拟池子活动...\n");

    // 模拟SOL/USDC池子活动（高活跃度）
    println!("1️⃣ 模拟 SOL/USDC (Phoenix) - 高活跃池子");
    collector.record_subscription("SOL/USDC (Phoenix)", "4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");
    
    for i in 0..50 {
        let price = 269.0 + (i as f64 * 0.5); // 价格从269到294
        collector.record_price_update("SOL/USDC (Phoenix)", price);
        
        if i % 5 == 0 {
            collector.record_vault_update("SOL/USDC (Phoenix)");
        }
        
        if i % 10 == 0 {
            collector.record_subscription("SOL/USDC (Phoenix)", "4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");
        }
    }
    println!("   ✅ 完成 50 次价格更新");

    thread::sleep(Duration::from_millis(100));

    // 模拟BONK/USDC池子活动（中活跃度）
    println!("\n2️⃣ 模拟 BONK/USDC (Phoenix) - 中活跃池子");
    collector.record_subscription("BONK/USDC (Phoenix)", "GBMoNx84HsFdVK63t8BZuDgyZhSBaeKWB4pHHpoeRM9z");
    
    for i in 0..30 {
        let price = 0.0000007 + (i as f64 * 0.00000001);
        collector.record_price_update("BONK/USDC (Phoenix)", price);
        
        if i % 8 == 0 {
            collector.record_vault_update("BONK/USDC (Phoenix)");
        }
    }
    println!("   ✅ 完成 30 次价格更新");

    // 模拟Raydium V4池子活动（低活跃度）
    println!("\n3️⃣ 模拟 USDC/USDT (Raydium V4) - 低活跃池子");
    collector.record_subscription("USDC/USDT (Raydium V4)", "77quYg4MGneUdjgXCunt9GgM1usmrxKY31twEy3WHwcS");
    
    for i in 0..10 {
        let price = 1.0 + (i as f64 * 0.0001);
        collector.record_price_update("USDC/USDT (Raydium V4)", price);
    }
    println!("   ✅ 完成 10 次价格更新");

    // 模拟更多池子
    println!("\n4️⃣ 模拟其他池子...");
    let other_pools = vec![
        ("SOL/USDT (Raydium V4)", "7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX", 25),
        ("RAY/USDC (Raydium V4)", "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg", 20),
        ("ETH/USDC (Raydium V4)", "EoNrn8iUhwgJySD1pHu8Qxm5gSQqLK3za4m8xzD2RuEb", 15),
        ("WIF/SOL (Raydium V4)", "EP2ib6dYdEeqD8MfE2ezHCxX3kP3K2eLKkirfPm5eyMx", 12),
        ("SOL/USDC (Lifinity V2)", "DrRd8gYMJu9XGxLhwTCPdHNLXCKHsxJtMpbn62YqmwQe", 18),
    ];

    for (name, address, updates) in other_pools {
        collector.record_subscription(name, address);
        for i in 0..updates {
            let price = 100.0 + (i as f64 * 0.1);
            collector.record_price_update(name, price);
        }
    }
    println!("   ✅ 完成 5 个额外池子");

    println!("\n{}", "=".repeat(80));
    println!("\n📊 统计报告生成中...\n");

    // 输出统计摘要
    collector.print_summary(3600);

    // 输出详细统计（TOP 10）
    collector.print_detailed_stats(10, 3600);

    // 输出每分钟统计
    collector.print_per_minute_stats();

    // 测试单个池子查询
    println!("\n🔍 查询单个池子详细信息:");
    println!("{}", "=".repeat(80));
    
    if let Some(stats) = collector.get_pool_stats("SOL/USDC (Phoenix)") {
        println!("\n池子: {}", stats.pool_name);
        println!("地址: {}", stats.pool_address);
        println!("首次订阅: {}", stats.first_subscription);
        println!("最后订阅: {}", stats.last_subscription);
        println!("总订阅次数: {}", stats.total_subscriptions);
        println!("价格更新: {}", stats.price_updates);
        println!("显著变化: {}", stats.significant_price_changes);
        println!("最大变化: {:.2}%", stats.max_price_change_percent);
        println!("累计变化: {:.2}%", stats.cumulative_price_change);
        println!("Vault更新: {}", stats.vault_updates);
        println!("活跃度评分: {:.1}/100", stats.activity_score());
        println!("运行时长: {}秒", stats.uptime_seconds());
    }

    // 生成JSON报告
    println!("\n💾 生成JSON报告...");
    let json = collector.generate_json_report();
    println!("JSON报告已生成（{}字节）", json.len());
    println!("可保存为: pool_stats_report.json");

    println!("\n✅ 演示完成！\n");
    println!("💡 提示：在实际程序中，这些统计会自动记录并每30秒输出。");
    println!("   按 Ctrl+C 停止程序时会看到完整的TOP 20详细报告。\n");
}

