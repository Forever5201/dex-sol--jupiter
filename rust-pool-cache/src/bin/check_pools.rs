use std::env;
use std::str::FromStr;

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;

use solana_pool_cache::config::Config;

fn main() {
    // 1. 读取配置文件路径（默认 ./config.toml）
    let config_path = env::args()
        .nth(1)
        .unwrap_or_else(|| "config.toml".to_string());

    println!("🔍 Loading config from: {}", config_path);

    let config = match Config::load_from_file(&config_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("❌ Failed to load config: {}", e);
            std::process::exit(1);
        }
    };

    // 2. 选择 RPC URL：优先使用 initialization.rpc_urls[0]
    let rpc_url = config
        .initialization
        .as_ref()
        .and_then(|init| init.rpc_urls.first())
        .cloned()
        .unwrap_or_else(|| "https://api.mainnet-beta.solana.com".to_string());

    println!("🔌 Using RPC URL: {}", rpc_url);

    let rpc_client = RpcClient::new(rpc_url);

    // 3. 逐个检查池子的地址
    println!("\n📋 Checking {} pools defined in config...\n", config.pools.len());

    for pool in &config.pools {
        println!("────────────────────────────────────────────────────────");
        println!("池子名称: {}", pool.name);
        println!("池子地址: {}", pool.address);
        println!("池子类型: {}", pool.pool_type);

        // 解析为 Pubkey
        let pubkey = match Pubkey::from_str(&pool.address) {
            Ok(pk) => pk,
            Err(e) => {
                eprintln!("⚠️  Invalid pubkey format: {}", e);
                continue;
            }
        };

        // 调用 get_account 检查账户是否存在
        match rpc_client.get_account(&pubkey) {
            Ok(account) => {
                println!("✅ Account exists");
                println!("  Owner:   {}", account.owner);
                println!("  Data len: {} bytes", account.data.len());
                println!("  Lamports: {}", account.lamports);
            }
            Err(e) => {
                eprintln!("❌ RPC error: {}", e);
            }
        }
    }

    println!("\n✅ Done. Review any ❌ entries above for invalid or missing pools.");
}
