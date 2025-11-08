/// 测试Meteora DLMM Improved版本的反序列化
use solana_pool_cache::deserializers::meteora_dlmm_improved::MeteoraPoolStateImproved;
use solana_pool_cache::dex_interface::DexPool;
use std::fs;

#[test]
fn test_jup_usdc_improved() {
    println!("\n=== 测试 JUP/USDC Meteora DLMM (Improved版本) ===\n");
    
    let file_path = "account_data/JUP-USDC-Meteora-DLMM_904.bin";
    
    let data = match fs::read(file_path) {
        Ok(d) => d,
        Err(_) => {
            println!("⚠️  文件不存在，跳过测试");
            return;
        }
    };
    
    println!("数据大小: {} bytes", data.len());
    
    match MeteoraPoolStateImproved::from_account_data(&data) {
        Ok(pool) => {
            println!("✅ 反序列化成功！\n");
            println!("=== 池子信息 ===");
            println!("Active Bin ID: {}", pool.active_id);
            println!("Bin Step: {}", pool.bin_step);
            println!("Status: {}", pool.status);
            println!("Token X: {}", pool.token_x_mint);
            println!("Token Y: {}", pool.token_y_mint);
            println!("Reserve X: {}", pool.reserve_x);
            println!("Reserve Y: {}", pool.reserve_y);
            
            let price = pool.calculate_price();
            println!("计算价格: {:.6}", price);
            
            assert!(pool.is_active(), "Pool should be active");
        }
        Err(e) => {
            panic!("❌ 反序列化失败: {}", e);
        }
    }
}

#[test]
fn test_sol_usdc_improved() {
    println!("\n=== 测试 SOL/USDC Meteora DLMM (Improved版本) ===\n");
    
    let file_path = "account_data/SOL-USDC-Meteora-DLMM_904.bin";
    
    let data = match fs::read(file_path) {
        Ok(d) => d,
        Err(_) => {
            println!("⚠️  文件不存在，跳过测试");
            return;
        }
    };
    
    println!("数据大小: {} bytes", data.len());
    
    match MeteoraPoolStateImproved::from_account_data(&data) {
        Ok(pool) => {
            println!("✅ 反序列化成功！\n");
            println!("=== 池子信息 ===");
            println!("Active Bin ID: {}", pool.active_id);
            println!("Bin Step: {}", pool.bin_step);
            println!("Status: {}", pool.status);
            
            let price = pool.calculate_price();
            println!("计算价格: {:.6}", price);
            
            // SOL/USDC价格应该在合理范围内
            assert!(price > 0.0 && price < 1000.0, "Price should be reasonable");
            assert!(pool.is_active(), "Pool should be active");
        }
        Err(e) => {
            panic!("❌ 反序列化失败: {}", e);
        }
    }
}

#[test]
fn test_both_meteora_pools() {
    println!("\n=== 测试两个Meteora DLMM池子 ===\n");
    
    let pools = vec![
        ("JUP/USDC", "account_data/JUP-USDC-Meteora-DLMM_904.bin"),
        ("SOL/USDC", "account_data/SOL-USDC-Meteora-DLMM_904.bin"),
    ];
    
    let mut success_count = 0;
    
    for (name, file_path) in &pools {
        println!("📁 测试: {}", name);
        
        if let Ok(data) = fs::read(file_path) {
            match MeteoraPoolStateImproved::from_account_data(&data) {
                Ok(pool) => {
                    println!("   ✅ 成功");
                    println!("      Active Bin: {}", pool.active_id);
                    println!("      Price: {:.6}", pool.calculate_price());
                    println!("      Active: {}", pool.is_active());
                    success_count += 1;
                }
                Err(e) => {
                    println!("   ❌ 失败: {}", e);
                }
            }
        } else {
            println!("   ⚠️  文件不存在");
        }
        println!();
    }
    
    println!("📊 结果: {}/{} 池子反序列化成功", success_count, pools.len());
    assert_eq!(success_count, 2, "Both pools should deserialize successfully");
}

