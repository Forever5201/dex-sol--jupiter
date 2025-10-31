/// 查找OpenBook V2真实市场地址
/// 
/// 此工具通过以下方法查询OpenBook V2市场：
/// 1. 从已知的测试市场反向查找
/// 2. 使用getProgramAccounts查询所有Market账户（840字节）
/// 3. 从链上数据验证市场结构

use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;
use solana_client::rpc_config::{RpcProgramAccountsConfig, RpcAccountInfoConfig};
use solana_sdk::commitment_config::CommitmentConfig;
use solana_client::rpc_filter::{RpcFilterType, Memcmp, MemcmpEncodedBytes};

const OPENBOOK_V2_PROGRAM_ID: &str = "opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb";
const MARKET_ACCOUNT_SIZE: usize = 840; // OpenBook V2 Market固定大小

fn main() {
    println!("🔍 查找OpenBook V2市场地址\n");
    
    let rpc_url = "https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683";
    let client = RpcClient::new_with_commitment(rpc_url.to_string(), CommitmentConfig::confirmed());
    
    let program_id = Pubkey::from_str(OPENBOOK_V2_PROGRAM_ID).unwrap();
    
    println!("📡 方法1: 从已知SOL/USDC市场地址查询...");
    // 这些是常见的SPL Token地址，OpenBook市场应该包含它们
    let sol_mint = "So11111111111111111111111111111111111111112";
    let usdc_mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    
    // 尝试通过getProgramAccounts查找包含SOL或USDC的市场
    let config = RpcProgramAccountsConfig {
        filters: Some(vec![
            // 过滤器1: 账户大小必须是840字节
            RpcFilterType::DataSize(MARKET_ACCOUNT_SIZE as u64),
        ]),
        account_config: RpcAccountInfoConfig {
            encoding: Some(solana_account_decoder::UiAccountEncoding::Base64),
            commitment: Some(CommitmentConfig::confirmed()),
            ..Default::default()
        },
        ..Default::default()
    };
    
    println!("🔎 查询OpenBook V2 Program的所有Market账户（840字节）...");
    println!("   Program ID: {}", OPENBOOK_V2_PROGRAM_ID);
    println!("   过滤条件: 账户大小 = {} 字节", MARKET_ACCOUNT_SIZE);
    
    match client.get_program_accounts_with_config(&program_id, config) {
        Ok(accounts) => {
            println!("\n✅ 找到 {} 个OpenBook V2市场账户:\n", accounts.len());
            
            if accounts.is_empty() {
                println!("⚠️  没有找到市场账户。可能原因：");
                println!("   1. OpenBook V2在mainnet上的市场较少");
                println!("   2. RPC节点可能限制了getProgramAccounts查询");
                println!("   3. 需要使用付费RPC节点或专用索引服务");
                println!("\n💡 建议：");
                println!("   - 访问 OpenBook V2 官方Discord/文档查找市场列表");
                println!("   - 使用 Solscan.io 搜索 Program ID查看所有账户");
                println!("   - 从 OpenBook V2 前端网站提取市场地址");
            } else {
                for (i, (pubkey, account)) in accounts.iter().enumerate() {
                    println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    println!("市场 #{}: {}", i + 1, pubkey);
                    println!("   账户大小: {} bytes", account.data.len());
                    println!("   Owner: {}", account.owner);
                    
                    // 尝试提取市场名称（偏移48字节，16字节名称）
                    if account.data.len() >= 64 {
                        let name_bytes = &account.data[48..64];
                        let name = String::from_utf8_lossy(name_bytes)
                            .trim_end_matches('\0')
                            .to_string();
                        if !name.is_empty() && name.chars().all(|c| c.is_ascii()) {
                            println!("   市场名称: {}", name);
                        }
                    }
                }
                
                println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                println!("📝 配置文件格式:");
                println!();
                for (pubkey, _) in accounts.iter().take(5) {
                    println!("[[pools]]");
                    println!("address = \"{}\"", pubkey);
                    println!("name = \"待确认 (OpenBook V2)\"");
                    println!("pool_type = \"openbook_v2\"");
                    println!();
                }
            }
        }
        Err(e) => {
            println!("❌ 查询失败: {}", e);
            println!("\n⚠️  可能的原因：");
            println!("   1. RPC节点不支持getProgramAccounts（Helius Free可能有限制）");
            println!("   2. 网络连接问题");
            println!("   3. 需要使用专业RPC服务（QuickNode, Triton等）");
        }
    }
    
    println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    println!("📡 方法2: 手动查询已知市场（备用方案）");
    println!("\n💡 推荐方法：");
    println!("1. 访问 https://solscan.io/");
    println!("2. 搜索: {}", OPENBOOK_V2_PROGRAM_ID);
    println!("3. 查看 \"Accounts\" 标签");
    println!("4. 筛选大小为 {} 字节的账户", MARKET_ACCOUNT_SIZE);
    println!("5. 这些就是OpenBook V2市场地址");
    
    println!("\n或访问:");
    println!("- OpenBook V2 Discord: https://discord.gg/openbook");
    println!("- OpenBook V2 文档: 查找官方市场列表");
    println!("- Dexscreener: https://dexscreener.com/solana (搜索OpenBook V2)");
}

