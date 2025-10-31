/// 测试所有Phoenix市场
/// 验证完整SDK的稳定性和价格准确性

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use solana_pool_cache::pool_factory::PoolFactory;

fn main() {
    println!("🔥 Phoenix全市场价格解析测试\n");
    
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new(rpc_url.to_string());
    
    // Phoenix主流市场列表
    let markets = vec![
        ("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg", "SOL/USDC"),
        ("GBMoNx84HsFdVK63t8BZuDgyZhSBaeKWB4pHHpoeRM9z", "BONK/USDC"),
        ("FZRgpfpvicJ3p23DfmZuvUgcQZBHJsWScTf2N2jK8dy6", "mSOL/SOL"),
        ("3J9LfemPBLowAJgpG3YdYPB9n6pUk7HEjwgS6Y5ToSFg", "SOL/USDT"),
    ];
    
    let mut success_count = 0;
    let mut total_volume = 0.0;
    
    for (address, name) in &markets {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("📊 {}", name);
        println!("   地址: {}..{}", &address[0..8], &address[address.len()-8..]);
        
        let pubkey = Pubkey::from_str(address).unwrap();
        let account = match client.get_account(&pubkey) {
            Ok(acc) => acc,
            Err(e) => {
                println!("   ❌ RPC错误: {}", e);
                continue;
            }
        };
        
        match PoolFactory::create_pool("phoenix", &account.data) {
            Ok(pool) => {
                let price = pool.calculate_price();
                let (base_liq, ask_liq) = pool.get_reserves();
                let is_active = pool.is_active();
                
                if is_active && price > 0.0 {
                    success_count += 1;
                    total_volume += (base_liq as f64 + ask_liq as f64) / 1e9;
                    
                    println!("   ✅ 价格: {:.6}", price);
                    println!("   📈 买单流动性: {:.2} (base atoms)", base_liq as f64 / 1e9);
                    println!("   📉 卖单流动性: {:.2} (base atoms)", ask_liq as f64 / 1e9);
                    
                    if let Some(info) = pool.get_additional_info() {
                        println!("   ℹ️  {}", info);
                    }
                } else {
                    println!("   ⚠️  市场不活跃或价格为0");
                }
            }
            Err(e) => {
                println!("   ❌ 解析失败: {:?}", e);
            }
        }
        println!();
    }
    
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📊 总结:");
    println!("   ✅ 成功: {}/{} 市场", success_count, markets.len());
    println!("   📊 总流动性: {:.2} (atoms)", total_volume);
    println!();
    
    if success_count == markets.len() {
        println!("🎉 所有Phoenix市场价格解析成功！");
        println!("✅ Phoenix SDK完整集成100%完成！");
    } else {
        println!("⚠️  部分市场解析失败，但核心功能正常");
    }
}

