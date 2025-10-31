/// 扫描所有OpenBook V2市场
/// 
/// 使用getProgramAccounts查询所有840字节的Market账户

use solana_client::rpc_client::RpcClient;
use solana_client::rpc_config::{RpcProgramAccountsConfig, RpcAccountInfoConfig};
use solana_client::rpc_filter::RpcFilterType;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::commitment_config::CommitmentConfig;
use std::str::FromStr;
use solana_pool_cache::pool_factory::PoolFactory;

const OPENBOOK_V2_PROGRAM: &str = "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb";
const MARKET_SIZE: u64 = 840;

// 已知的主流代币地址
const SOL_MINT: &str = "So11111111111111111111111111111111111111112";
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

fn main() {
    println!("🔍 扫描OpenBook V2市场\n");
    
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new_with_commitment(
        rpc_url.to_string(), 
        CommitmentConfig::confirmed()
    );
    
    let program_id = Pubkey::from_str(OPENBOOK_V2_PROGRAM).unwrap();
    
    println!("📡 Program ID: {}", OPENBOOK_V2_PROGRAM);
    println!("🔎 查询条件: 账户大小 = {} bytes\n", MARKET_SIZE);
    
    // 配置查询：只获取840字节的账户（OpenBook V2 Market固定大小）
    let config = RpcProgramAccountsConfig {
        filters: Some(vec![
            RpcFilterType::DataSize(MARKET_SIZE),
        ]),
        account_config: RpcAccountInfoConfig {
            encoding: None,
            commitment: Some(CommitmentConfig::confirmed()),
            data_slice: None,
            min_context_slot: None,
        },
        ..Default::default()
    };
    
    println!("⏳ 正在查询... (可能需要10-30秒)\n");
    
    match client.get_program_accounts_with_config(&program_id, config) {
        Ok(accounts) => {
            if accounts.is_empty() {
                println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                println!("⚠️  未找到OpenBook V2市场账户\n");
                println!("可能原因：");
                println!("1. OpenBook V2在mainnet上市场很少");
                println!("2. RPC节点限制了getProgramAccounts查询");
                println!("3. 需要使用付费RPC或专用索引服务\n");
                println!("备用方案：");
                println!("1. 访问 https://solscan.io/account/{}", OPENBOOK_V2_PROGRAM);
                println!("2. 点击 'Accounts' 标签");
                println!("3. 筛选大小=840字节的账户");
                println!("4. 使用 verify_openbook_address 验证");
                return;
            }
            
            println!("✅ 找到 {} 个OpenBook V2市场\n", accounts.len());
            println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            
            let mut valid_markets = Vec::new();
            
            for (i, (pubkey, account)) in accounts.iter().enumerate() {
                println!("\n市场 #{}: {}", i + 1, pubkey);
                
                // 尝试反序列化
                match PoolFactory::create_pool("openbook_v2", &account.data) {
                    Ok(pool) => {
                        println!("   ✅ 反序列化成功");
                        
                        if let Some(info) = pool.get_additional_info() {
                            println!("   {}", info);
                        }
                        
                        let (base_dec, quote_dec) = pool.get_decimals();
                        let is_active = pool.is_active();
                        
                        println!("   精度: base={}, quote={}", base_dec, quote_dec);
                        println!("   状态: {}", if is_active { "活跃" } else { "不活跃" });
                        
                        if is_active {
                            valid_markets.push(pubkey.to_string());
                        }
                    }
                    Err(e) => {
                        println!("   ⚠️  反序列化失败: {:?}", e);
                    }
                }
            }
            
            // 生成配置
            if !valid_markets.is_empty() {
                println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                println!("📝 添加到config.toml:");
                println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                
                for (i, addr) in valid_markets.iter().enumerate() {
                    println!("[[pools]]");
                    println!("address = \"{}\"", addr);
                    println!("name = \"OpenBook V2 Market #{}\"", i + 1);
                    println!("pool_type = \"openbook_v2\"\n");
                }
            }
            
            println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            println!("✅ 扫描完成！找到 {} 个活跃市场", valid_markets.len());
        }
        Err(e) => {
            println!("❌ RPC查询失败: {}\n", e);
            println!("这通常是因为：");
            println!("1. 免费RPC不支持getProgramAccounts");
            println!("2. 网络问题");
            println!("3. Program ID输入错误\n");
            println!("备用方案：手动查询");
            println!("访问: https://solscan.io/account/{}", OPENBOOK_V2_PROGRAM);
        }
    }
}

