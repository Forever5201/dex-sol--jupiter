/// Meteora DLMM反序列化测试
/// 
/// 验证Meteora DLMM池子的反序列化，特别是JUP/USDC池子

use borsh::BorshDeserialize;
use solana_pool_cache::deserializers::meteora_dlmm::{MeteoraPoolState, PoolParameters};
use std::fs;
use std::mem::size_of;

#[test]
fn test_meteora_struct_size() {
    println!("\n=== Meteora DLMM 结构体大小分析 ===");
    println!("目标: 896字节 (904 - 8字节discriminator)\n");
    
    println!("PoolParameters: {} 字节", size_of::<PoolParameters>());
    println!("MeteoraPoolState: {} 字节", size_of::<MeteoraPoolState>());
    println!();
    
    let expected = 896;
    let actual = size_of::<MeteoraPoolState>();
    
    if actual == expected {
        println!("✅ 大小完美匹配！");
    } else {
        println!("⚠️  大小不匹配:");
        println!("   期望: {} 字节", expected);
        println!("   实际: {} 字节", actual);
        println!("   差异: {} 字节", actual as i32 - expected as i32);
    }
}

#[test]
fn test_deserialize_jup_usdc() {
    println!("\n=== 测试 JUP/USDC Meteora DLMM 反序列化 ===\n");
    
    let file_path = "account_data/JUP-USDC-Meteora-DLMM_904.bin";
    println!("📁 测试文件: {}", file_path);
    
    let data = match fs::read(file_path) {
        Ok(d) => d,
        Err(e) => {
            println!("   ⚠️  文件读取失败: {} (运行 fetch_pool_account 下载数据)", e);
            println!("   跳过测试");
            return;
        }
    };
    
    println!("   数据大小: {} 字节", data.len());
    
    // Meteora使用8字节discriminator
    if data.len() < 8 {
        println!("   ❌ 数据太短，无法包含discriminator");
        return;
    }
    
    // 显示discriminator
    print!("   Discriminator: ");
    for byte in &data[0..8] {
        print!("{:02x}", byte);
    }
    println!();
    
    // 尝试反序列化（跳过discriminator）
    let data_without_discriminator = &data[8..];
    println!("   数据部分: {} 字节", data_without_discriminator.len());
    
    match MeteoraPoolState::try_from_slice(data_without_discriminator) {
        Ok(pool) => {
            println!("   ✅ 反序列化成功！\n");
            println!("   === 池子信息 ===");
            println!("   Active Bin ID: {}", pool.active_id);
            println!("   Bin Step: {}", pool.bin_step);
            println!("   Liquidity: {}", pool.liquidity);
            println!("   Base Fee Rate: {} bps", pool.base_fee_rate);
            println!("   Max Fee Rate: {} bps", pool.max_fee_rate);
            println!("   Status: {}", pool.status);
            println!("   Token X Mint: {}", pool.token_x_mint);
            println!("   Token Y Mint: {}", pool.token_y_mint);
            println!("   Reserve X: {}", pool.reserve_x);
            println!("   Reserve Y: {}", pool.reserve_y);
            
            // 计算价格
            let price = pool.calculate_price();
            println!("   计算价格: {}", price);
            
            // 检查池子是否在范围内
            println!("   在范围内: {}", pool.is_in_range());
            println!("   Min Bin ID: {}", pool.parameters.min_bin_id);
            println!("   Max Bin ID: {}", pool.parameters.max_bin_id);
        }
        Err(e) => {
            println!("   ❌ 反序列化失败: {}", e);
            println!("\n   这可能意味着:");
            println!("   1. 结构体定义不正确");
            println!("   2. 字段顺序错误");
            println!("   3. 某些字段类型不匹配");
            println!("   4. Padding计算错误");
        }
    }
}

#[test]
fn test_deserialize_sol_usdc() {
    println!("\n=== 测试 SOL/USDC Meteora DLMM 反序列化 ===\n");
    
    let file_path = "account_data/SOL-USDC-Meteora-DLMM_904.bin";
    println!("📁 测试文件: {}", file_path);
    
    let data = match fs::read(file_path) {
        Ok(d) => d,
        Err(e) => {
            println!("   ⚠️  文件读取失败: {} (运行 fetch_pool_account 下载数据)", e);
            println!("   跳过测试");
            return;
        }
    };
    
    println!("   数据大小: {} 字节", data.len());
    
    let data_without_discriminator = &data[8..];
    
    match MeteoraPoolState::try_from_slice(data_without_discriminator) {
        Ok(pool) => {
            println!("   ✅ 反序列化成功！\n");
            println!("   === 池子信息 ===");
            println!("   Active Bin ID: {}", pool.active_id);
            println!("   Bin Step: {}", pool.bin_step);
            println!("   Liquidity: {}", pool.liquidity);
            println!("   Status: {}", pool.status);
            
            let price = pool.calculate_price();
            println!("   计算价格: {}", price);
        }
        Err(e) => {
            println!("   ❌ 反序列化失败: {}", e);
        }
    }
}

#[test]
fn test_both_pools_comparison() {
    println!("\n=== 对比两个Meteora DLMM池子 ===\n");
    
    let jup_data = fs::read("account_data/JUP-USDC-Meteora-DLMM_904.bin").ok();
    let sol_data = fs::read("account_data/SOL-USDC-Meteora-DLMM_904.bin").ok();
    
    match (jup_data, sol_data) {
        (Some(jup), Some(sol)) => {
            println!("JUP/USDC 大小: {} 字节", jup.len());
            println!("SOL/USDC 大小: {} 字节", sol.len());
            
            if jup.len() == sol.len() {
                println!("✅ 两个池子大小相同");
            } else {
                println!("⚠️  两个池子大小不同！");
            }
            
            // 比较discriminator
            if jup[..8] == sol[..8] {
                println!("✅ Discriminator相同");
            } else {
                println!("⚠️  Discriminator不同");
            }
        }
        _ => {
            println!("⚠️  无法读取文件，请先运行 fetch_pool_account");
        }
    }
}

















