/// 验证OpenBook V2市场地址
/// 
/// 用法: cargo run --example verify_openbook_address <market_address>

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use solana_pool_cache::pool_factory::PoolFactory;

const OPENBOOK_V2_PROGRAM: &str = "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb";

fn main() {
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new(rpc_url.to_string());
    
    // 从命令行参数获取地址
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        println!("用法: cargo run --example verify_openbook_address <market_address>");
        println!("\n常见OpenBook V2市场尝试:");
        println!("  8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6  (可能的SOL/USDC)");
        println!("  CFSMrBssNG8Ud1edW59jNLnq2cwrQ9uY5cM3wXmqRJj3  (可能的市场)");
        return;
    }
    
    let address = &args[1];
    println!("🔍 验证OpenBook V2地址: {}\n", address);
    
    let pubkey = match Pubkey::from_str(address) {
        Ok(p) => p,
        Err(e) => {
            println!("❌ 地址格式错误: {}", e);
            return;
        }
    };
    
    // 步骤1: 获取账户
    println!("[1/4] 获取账户数据...");
    let account = match client.get_account(&pubkey) {
        Ok(acc) => {
            println!("      ✅ 账户存在");
            println!("      大小: {} bytes", acc.data.len());
            println!("      Owner: {}", acc.owner);
            acc
        }
        Err(e) => {
            println!("      ❌ 账户不存在: {}", e);
            return;
        }
    };
    
    // 步骤2: 验证Owner
    println!("\n[2/4] 验证Program Owner...");
    let expected = Pubkey::from_str(OPENBOOK_V2_PROGRAM).unwrap();
    if account.owner == expected {
        println!("      ✅ Program Owner正确");
    } else {
        println!("      ❌ Program Owner不匹配:");
        println!("         期望: {}", OPENBOOK_V2_PROGRAM);
        println!("         实际: {}", account.owner);
        return;
    }
    
    // 步骤3: 验证大小
    println!("\n[3/4] 验证账户大小...");
    if account.data.len() == 840 {
        println!("      ✅ 账户大小正确 (840 bytes = OpenBook V2 Market)");
    } else {
        println!("      ⚠️  账户大小: {} bytes (期望840)", account.data.len());
        println!("         这可能不是Market账户");
        return;
    }
    
    // 步骤4: 尝试反序列化
    println!("\n[4/4] 测试反序列化...");
    match PoolFactory::create_pool("openbook_v2", &account.data) {
        Ok(pool) => {
            println!("      ✅ 反序列化成功!\n");
            
            println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            println!("📊 市场信息:");
            println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            
            if let Some(info) = pool.get_additional_info() {
                println!("  {}", info);
            }
            
            let (base_dec, quote_dec) = pool.get_decimals();
            println!("  基础精度: {}", base_dec);
            println!("  报价精度: {}", quote_dec);
            
            let is_active = pool.is_active();
            println!("  活跃状态: {}", if is_active { "活跃" } else { "不活跃" });
            
            let (base_deposit, quote_deposit) = pool.get_reserves();
            println!("  基础存款: {}", base_deposit);
            println!("  报价存款: {}", quote_deposit);
            
            println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            println!("✅ 这是一个有效的OpenBook V2市场！\n");
            
            println!("添加到config.toml:");
            println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            println!("[[pools]]");
            println!("address = \"{}\"", address);
            println!("name = \"待确认名称 (OpenBook V2)\"");
            println!("pool_type = \"openbook_v2\"");
            println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        }
        Err(e) => {
            println!("      ❌ 反序列化失败: {:?}", e);
            println!("         这可能不是OpenBook V2 Market账户");
        }
    }
}


















































































