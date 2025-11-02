/// 调试OpenBook账户结构
/// 分析848字节vs 840字节的差异

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        println!("用法: cargo run --example debug_openbook_account <address>");
        println!("\n已知OpenBook V2账户:");
        println!("  CFSMrBssNG8Ud1edW59jNLnq2cwrQ9uY5cM3wXmqRJj3 (848 bytes)");
        return;
    }
    
    let address = &args[1];
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new(rpc_url.to_string());
    
    println!("🔍 调试OpenBook账户: {}\n", address);
    
    let pubkey = Pubkey::from_str(address).unwrap();
    let account = client.get_account(&pubkey).expect("Failed to get account");
    
    println!("账户信息:");
    println!("  Owner: {}", account.owner);
    println!("  大小: {} bytes", account.data.len());
    println!("  Lamports: {}", account.lamports);
    println!("\n数据结构分析:");
    
    // 尝试读取前面的字段
    if account.data.len() >= 64 {
        println!("  前64字节 (hex): {:02x?}", &account.data[0..64]);
        
        // 尝试读取市场名称（OpenBook V2 Market的name字段在offset 48）
        if account.data.len() >= 64 {
            let name_bytes = &account.data[48..64];
            let name = String::from_utf8_lossy(name_bytes)
                .trim_end_matches('\0')
                .to_string();
            if !name.is_empty() {
                println!("\n  可能的市场名称: '{}'", name);
            }
        }
    }
    
    println!("\n尝试多种大小的反序列化:");
    
    // 尝试840字节（标准OpenBook V2）
    if account.data.len() >= 840 {
        println!("\n1. 尝试840字节（标准Market）:");
        match try_deserialize_openbook(&account.data[0..840]) {
            Ok(info) => println!("   ✅ 成功! {}", info),
            Err(e) => println!("   ❌ 失败: {}", e),
        }
    }
    
    // 尝试848字节（实际大小）
    println!("\n2. 尝试848字节（实际大小）:");
    match try_deserialize_openbook(&account.data) {
        Ok(info) => println!("   ✅ 成功! {}", info),
        Err(e) => println!("   ❌ 失败: {}", e),
    }
    
    // 尝试不同大小
    for size in [832, 840, 848, 856] {
        if account.data.len() >= size {
            println!("\n3. 尝试{}字节:", size);
            match try_deserialize_openbook(&account.data[0..size]) {
                Ok(info) => println!("   ✅ 成功! {}", info),
                Err(_) => println!("   ❌ 失败"),
            }
        }
    }
}

fn try_deserialize_openbook(data: &[u8]) -> Result<String, String> {
    use solana_pool_cache::pool_factory::PoolFactory;
    
    match PoolFactory::create_pool("openbook_v2", data) {
        Ok(pool) => {
            let mut info = String::new();
            if let Some(details) = pool.get_additional_info() {
                info.push_str(&details);
            }
            let (base_dec, quote_dec) = pool.get_decimals();
            info.push_str(&format!(" | Decimals: base={}, quote={}", base_dec, quote_dec));
            Ok(info)
        }
        Err(e) => Err(format!("{:?}", e)),
    }
}
























































