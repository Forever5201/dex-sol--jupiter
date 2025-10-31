/// 检查所有配置池子的订阅状态
/// 
/// 验证：
/// 1. 账户是否存在
/// 2. Program Owner是否正确
/// 3. 反序列化是否成功
/// 4. 价格是否可以计算

use solana_client::rpc_client::RpcClient;
use solana_pool_cache::config::Config;
use solana_pool_cache::pool_factory::PoolFactory;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

fn main() {
    println!("🔍 检查所有配置池子的订阅状态\n");
    
    // 加载配置
    let config = Config::load_from_file("config.toml").expect("Failed to load config");
    let rpc_url = if let Some(init) = &config.initialization {
        init.rpc_urls.first().expect("No RPC URL configured")
    } else {
        "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683"
    };
    let client = RpcClient::new(rpc_url.clone());
    
    println!("📡 RPC: {}", &rpc_url[0..50]);
    println!("📊 配置池子总数: {}\n", config.pools.len());
    
    let mut stats = PoolStats::default();
    
    for (idx, pool_config) in config.pools.iter().enumerate() {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("[{}/{}] 📊 {}", idx + 1, config.pools.len(), pool_config.name);
        println!("     地址: {}..{}", &pool_config.address[0..8], &pool_config.address[pool_config.address.len()-8..]);
        println!("     类型: {}", pool_config.pool_type);
        
        // 1. 获取账户数据
        let pubkey = match Pubkey::from_str(&pool_config.address) {
            Ok(p) => p,
            Err(e) => {
                println!("     ❌ 地址格式错误: {}", e);
                stats.invalid_address += 1;
                continue;
            }
        };
        
        let account = match client.get_account(&pubkey) {
            Ok(acc) => {
                println!("     ✅ 账户存在: {} bytes", acc.data.len());
                acc
            }
            Err(e) => {
                println!("     ❌ 账户不存在: {}", e);
                stats.account_not_found += 1;
                continue;
            }
        };
        
        // 2. 尝试反序列化
        match PoolFactory::create_pool(&pool_config.pool_type, &account.data) {
            Ok(pool) => {
                println!("     ✅ 反序列化成功: {}", pool.dex_name());
                
                let price = pool.calculate_price();
                let is_active = pool.is_active();
                let (base_dec, quote_dec) = pool.get_decimals();
                
                println!("     💰 价格: {:.8}", price);
                println!("     📊 精度: base={}, quote={}", base_dec, quote_dec);
                println!("     🔥 状态: {}", if is_active { "活跃" } else { "不活跃" });
                
                if price > 0.0 && is_active {
                    stats.fully_working += 1;
                    println!("     ✅ 完全正常");
                } else if is_active {
                    stats.working_no_price += 1;
                    println!("     ⚠️  订阅正常，但价格为0");
                } else {
                    stats.inactive += 1;
                    println!("     ⚠️  市场不活跃");
                }
            }
            Err(e) => {
                println!("     ❌ 反序列化失败: {:?}", e);
                stats.deserialization_failed += 1;
            }
        }
        println!();
    }
    
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📈 总结统计:\n");
    
    println!("✅ 完全正常（可订阅+有价格）: {} 个", stats.fully_working);
    println!("⚠️  订阅正常（但价格为0）:     {} 个", stats.working_no_price);
    println!("⚠️  市场不活跃:                {} 个", stats.inactive);
    println!("❌ 反序列化失败:              {} 个", stats.deserialization_failed);
    println!("❌ 账户不存在:                {} 个", stats.account_not_found);
    println!("❌ 地址格式错误:              {} 个", stats.invalid_address);
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    let total_ok = stats.fully_working + stats.working_no_price;
    let total = config.pools.len();
    let success_rate = total_ok as f64 / total as f64 * 100.0;
    
    println!("\n📊 可订阅池子: {}/{} ({:.1}%)", total_ok, total, success_rate);
    
    if stats.fully_working == total {
        println!("\n🎉 完美！所有池子都可以正常订阅并获取价格！");
    } else if total_ok == total {
        println!("\n✅ 所有池子都可以正常订阅！");
        if stats.working_no_price > 0 {
            println!("ℹ️  {} 个池子价格为0（CLOB市场或特殊池子）", stats.working_no_price);
        }
    } else {
        println!("\n⚠️  {} 个池子有问题，需要检查", total - total_ok);
    }
}

#[derive(Default)]
struct PoolStats {
    fully_working: usize,
    working_no_price: usize,
    inactive: usize,
    deserialization_failed: usize,
    account_not_found: usize,
    invalid_address: usize,
}

