use std::str::FromStr;
use solana_sdk::pubkey::Pubkey;
use solana_client::rpc_client::RpcClient;
use borsh::BorshDeserialize;

// 引入必要的模块
use solana_pool_cache::dex_interface::DexPool;
use solana_pool_cache::deserializers::raydium_clmm::RaydiumClmmPoolState;

fn main() {
    let rpc = RpcClient::new("https://mainnet.helius-rpc.com/?api-key=d261c4a1-fffe-4263-b0ac-a667c05b5683".to_string());
    
    let pool_addr = Pubkey::from_str("8EzbUfvcRT1Q6RL462ekGkgqbxsPmwC5FMLQZhSPMjJ3").unwrap();
    
    println!("正在查询SOL/mSOL CLMM池子...");
    let acc = rpc.get_account(&pool_addr).unwrap();
    
    println!("池子账户 ({} bytes):", acc.data.len());
    println!("  Owner: {}", acc.owner);
    
    match RaydiumClmmPoolState::from_account_data_manual(&acc.data) {
        Ok(pool) => {
            println!("\n✅ Raydium CLMM结构反序列化成功!");
            println!("  Liquidity: {}", pool.liquidity);
            println!("  Tick: {}", pool.tick_current);
            println!("  Token Mint 0: {}", pool.token_mint_0);
            println!("  Token Mint 1: {}", pool.token_mint_1);
            println!("  Token Vault 0: {}", pool.token_vault_0);
            println!("  Token Vault 1: {}", pool.token_vault_1);
            println!("  Decimals: {} / {}", pool.mint_decimals_0, pool.mint_decimals_1);
            
            let price = pool.calculate_price();
            println!("\n计算结果:");
            println!("  Price: {:.6}", price);
            
            let (r0, r1) = pool.get_effective_reserves();
            println!("  Effective reserves: {:.2} / {:.2}", r0, r1);
            
            // 验证vault账户是否存在
            println!("\n验证vault账户:");
            match rpc.get_account(&pool.token_vault_0) {
                Ok(_) => println!("  ✅ Vault 0 存在"),
                Err(e) => println!("  ❌ Vault 0 不存在: {}", e),
            }
            match rpc.get_account(&pool.token_vault_1) {
                Ok(_) => println!("  ✅ Vault 1 存在"),
                Err(e) => println!("  ❌ Vault 1 不存在: {}", e),
            }
            
            // 验证mint账户
            println!("\n验证mint账户:");
            match rpc.get_account(&pool.token_mint_0) {
                Ok(_) => println!("  ✅ Mint 0 存在"),
                Err(e) => println!("  ❌ Mint 0 不存在: {}", e),
            }
            match rpc.get_account(&pool.token_mint_1) {
                Ok(_) => println!("  ✅ Mint 1 存在"),
                Err(e) => println!("  ❌ Mint 1 不存在: {}", e),
            }
        }
        Err(e) => {
            println!("\n❌ 反序列化失败: {}", e);
        }
    }
}

