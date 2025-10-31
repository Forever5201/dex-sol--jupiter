/// 验证Phoenix和OpenBook市场配置
/// 
/// 这个工具会：
/// 1. 从RPC获取账户数据
/// 2. 验证program owner
/// 3. 验证数据大小
/// 4. 测试反序列化

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use solana_pool_cache::pool_factory::PoolFactory;

// Program IDs
const PHOENIX_PROGRAM_ID: &str = "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY";
const OPENBOOK_V2_PROGRAM_ID: &str = "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb";

struct MarketToVerify {
    address: &'static str,
    name: &'static str,
    pool_type: &'static str,
    expected_program: &'static str,
}

fn main() {
    println!("🔍 验证Phoenix和OpenBook市场配置\n");
    
    // RPC endpoint
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new(rpc_url.to_string());
    
    // 要验证的市场列表
    let markets = vec![
        // Phoenix
        MarketToVerify {
            address: "4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg",
            name: "SOL/USDC (Phoenix)",
            pool_type: "phoenix",
            expected_program: PHOENIX_PROGRAM_ID,
        },
        // OpenBook V2
        MarketToVerify {
            address: "4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg",
            name: "SOL/USDC (OpenBook V2)",
            pool_type: "openbook_v2",
            expected_program: OPENBOOK_V2_PROGRAM_ID,
        },
        MarketToVerify {
            address: "2pspvjWWaf3dNgt3jsgSzFCNvMGPb7t8FrEYvLGjvcCe",
            name: "JUP/USDC (OpenBook V2)",
            pool_type: "openbook_v2",
            expected_program: OPENBOOK_V2_PROGRAM_ID,
        },
        MarketToVerify {
            address: "GBMoNx84HsFdVK63t8BZuDgyZhSBaeKWB4pHHpoeRM9z",
            name: "BONK/USDC (OpenBook V2)",
            pool_type: "openbook_v2",
            expected_program: OPENBOOK_V2_PROGRAM_ID,
        },
        MarketToVerify {
            address: "6ojSigXF7nDPyhFRgmn3V9ywhYseKF9J32ZrranMGVSX",
            name: "WIF/USDC (OpenBook V2)",
            pool_type: "openbook_v2",
            expected_program: OPENBOOK_V2_PROGRAM_ID,
        },
    ];
    
    let mut verified_count = 0;
    let mut failed_count = 0;
    
    for market in markets {
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        println!("📊 验证: {}", market.name);
        println!("   地址: {}", market.address);
        println!("   类型: {}", market.pool_type);
        
        let pubkey = match Pubkey::from_str(market.address) {
            Ok(p) => p,
            Err(e) => {
                println!("   ❌ 地址格式错误: {}", e);
                failed_count += 1;
                continue;
            }
        };
        
        let expected_program = match Pubkey::from_str(market.expected_program) {
            Ok(p) => p,
            Err(e) => {
                println!("   ❌ Program ID格式错误: {}", e);
                failed_count += 1;
                continue;
            }
        };
        
        // 1. 获取账户信息
        print!("   [1/4] 获取账户数据... ");
        let account = match client.get_account(&pubkey) {
            Ok(acc) => {
                println!("✅ 成功");
                acc
            }
            Err(e) => {
                println!("❌ 失败: {}", e);
                failed_count += 1;
                continue;
            }
        };
        
        // 2. 验证program owner
        print!("   [2/4] 验证program owner... ");
        if account.owner == expected_program {
            println!("✅ 正确 ({})", account.owner);
        } else {
            println!("❌ 不匹配!");
            println!("       期望: {}", expected_program);
            println!("       实际: {}", account.owner);
            failed_count += 1;
            continue;
        }
        
        // 3. 检查数据大小
        print!("   [3/4] 检查数据大小... ");
        println!("{} bytes", account.data.len());
        if market.pool_type == "openbook_v2" && account.data.len() != 840 {
            println!("       ⚠️  警告: OpenBook V2应该是840字节，实际{}字节", account.data.len());
        }
        if market.pool_type == "phoenix" && account.data.len() < 400 {
            println!("       ⚠️  警告: Phoenix应该至少400字节，实际{}字节", account.data.len());
        }
        
        // 4. 测试反序列化
        print!("   [4/4] 测试反序列化... ");
        match PoolFactory::create_pool(market.pool_type, &account.data) {
            Ok(pool) => {
                println!("✅ 成功");
                println!("       DEX名称: {}", pool.dex_name());
                println!("       是否活跃: {}", pool.is_active());
                let (base_decimals, quote_decimals) = pool.get_decimals();
                println!("       精度: base={}, quote={}", base_decimals, quote_decimals);
                
                if let Some(info) = pool.get_additional_info() {
                    println!("       额外信息: {}", info);
                }
                
                verified_count += 1;
            }
            Err(e) => {
                println!("❌ 失败: {}", e);
                failed_count += 1;
                continue;
            }
        }
        
        println!("   ✅ 验证通过\n");
    }
    
    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📈 验证结果汇总:");
    println!("   ✅ 验证通过: {} 个", verified_count);
    println!("   ❌ 验证失败: {} 个", failed_count);
    println!("   📊 总计: {} 个", verified_count + failed_count);
    
    if failed_count > 0 {
        println!("\n⚠️  有{}个市场验证失败，请检查配置！", failed_count);
        std::process::exit(1);
    } else {
        println!("\n🎉 所有市场验证通过！");
    }
}

