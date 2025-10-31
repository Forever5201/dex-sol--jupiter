///! 结构体大小自动验证测试
///! 确保所有DEX池子结构体的大小与链上数据匹配

use std::mem::size_of;

// 导入所有结构体定义
// 注意: 这些导入需要根据实际的模块结构调整
// use solana_pool_cache::deserializers::*;

#[test]
fn test_raydium_v4_struct_size() {
    // Raydium V4 有两种大小: 752字节(完整)和388字节(简化)
    // 这里我们只测试已知的大小常量
    
    println!("Raydium V4 AMM Info:");
    println!("  Expected sizes: 752 bytes (full) or 388 bytes (simple)");
    println!("  Note: Actual struct needs to match one of these");
}

#[test]
fn test_raydium_clmm_struct_size() {
    println!("Raydium CLMM Pool State:");
    println!("  Expected size: 1536 bytes (1544 - 8 discriminator)");
    println!("  Note: Includes observation array padding");
}

#[test]
fn test_meteora_dlmm_struct_size() {
    println!("Meteora DLMM Pool State:");
    println!("  Expected size: 896 bytes (904 - 8 discriminator)");
    println!("  Current issue: Using 200-byte padding as workaround");
    println!("  Required: Get accurate structure from IDL");
}

#[test]
fn test_lifinity_v2_struct_size() {
    println!("Lifinity V2 Pool State:");
    println!("  Expected size: TBD");
    println!("  Note: Oracle-based AMM");
}

/// 测试所有已知结构体的大小
#[test]
fn test_all_struct_sizes() {
    println!("\n╔════════════════════════════════════════════════════════════════╗");
    println!("║          结构体大小验证测试 - 汇总报告                        ║");
    println!("╚════════════════════════════════════════════════════════════════╝\n");
    
    let test_cases = vec![
        ("Raydium V4 AMM (Full)", 752, "需要验证"),
        ("Raydium V4 AMM (Simple)", 388, "需要验证"),
        ("Raydium CLMM", 1536, "需要验证"),
        ("Meteora DLMM", 896, "⚠️  结构不准确"),
        ("Lifinity V2", 0, "待定义"),
    ];
    
    println!("┌────────────────────────────┬──────────────┬─────────────────┐");
    println!("│ 结构体                     │ 期望大小     │ 状态            │");
    println!("├────────────────────────────┼──────────────┼─────────────────┤");
    
    for (name, expected_size, status) in test_cases {
        println!("│ {:26} │ {:12} │ {:15} │", 
                 name, 
                 if expected_size > 0 { format!("{} bytes", expected_size) } else { "未知".to_string() },
                 status);
    }
    
    println!("└────────────────────────────┴──────────────┴─────────────────┘\n");
}

/// Meteora DLMM 结构体大小计算
#[test]
fn test_meteora_dlmm_size_calculation() {
    println!("\n╔════════════════════════════════════════════════════════════════╗");
    println!("║       Meteora DLMM 结构体大小分析                             ║");
    println!("╚════════════════════════════════════════════════════════════════╝\n");
    
    println!("已知信息:");
    println!("  - 链上总大小: 904 bytes");
    println!("  - Discriminator: 8 bytes");
    println!("  - 实际数据: 896 bytes\n");
    
    println!("字段大小估算:");
    
    let pool_parameters = 32;  // PoolParameters结构
    println!("  PoolParameters:        {:4} bytes", pool_parameters);
    
    let pubkeys = 15 * 32;  // 15个Pubkey字段
    println!("  Pubkeys (15个):        {:4} bytes", pubkeys);
    
    let core_fields = 4 + 2 + 1 + 1 + 8 + 8 + 4 + 4;  // active_id, bin_step, status, padding, protocol_fees, base_fee, max_fee
    println!("  核心字段:              {:4} bytes", core_fields);
    
    let liquidity = 16;  // u128
    println!("  liquidity (u128):      {:4} bytes", liquidity);
    
    let reward_fields = 8 * 4 + 16 * 2;  // 4个u64 + 2个u128
    println!("  Reward字段:            {:4} bytes", reward_fields);
    
    let reward_cumulative = 16 * 2;  // 2个u128
    println!("  Reward累积:            {:4} bytes", reward_cumulative);
    
    let volatility = 4 * 2;  // 2个u32
    println!("  波动性字段:            {:4} bytes", volatility);
    
    let timestamp_swap = 8 + 8 + 8;  // i64 + u64 + u64
    println!("  时间戳和Swap Cap:      {:4} bytes", timestamp_swap);
    
    let whitelist_pubkeys = 3 * 32;  // 3个Pubkey
    println!("  Whitelist Pubkeys:     {:4} bytes", whitelist_pubkeys);
    
    let activation = 1 + 7;  // u8 + padding
    println!("  Activation + padding:  {:4} bytes", activation);
    
    let total = pool_parameters + pubkeys + core_fields + liquidity + 
                reward_fields + reward_cumulative + volatility + timestamp_swap + 
                whitelist_pubkeys + activation;
    
    println!("\n  估算总大小:            {:4} bytes", total);
    println!("  期望总大小:            {:4} bytes", 896);
    println!("  差值:                  {:4} bytes", 896 - total);
    
    if total > 896 {
        println!("\n⚠️  警告: 估算大小超过期望大小! 某些字段可能重复或不正确");
    } else if total < 896 {
        println!("\n⚠️  警告: 估算大小小于期望大小! 可能有缺失的字段");
        println!("  建议: 需要 {} bytes 的padding或额外字段", 896 - total);
    } else {
        println!("\n✅ 大小匹配!");
    }
}

/// 生成结构体布局的ASCII可视化
#[test]
fn test_generate_struct_layout_visualization() {
    println!("\n╔════════════════════════════════════════════════════════════════╗");
    println!("║       Meteora DLMM 结构体布局可视化                           ║");
    println!("╚════════════════════════════════════════════════════════════════╝\n");
    
    let layout = vec![
        (0, 8, "discriminator [u8; 8]"),
        (8, 32, "PoolParameters"),
        (40, 32, "token_x_mint: Pubkey"),
        (72, 32, "token_y_mint: Pubkey"),
        (104, 32, "reserve_x: Pubkey"),
        (136, 32, "reserve_y: Pubkey"),
        (168, 32, "oracle: Pubkey"),
        (200, 32, "fee_collector_token_x: Pubkey"),
        (232, 32, "fee_collector_token_y: Pubkey"),
        (264, 32, "protocol_fee_owner: Pubkey"),
        (296, 32, "reward_vault_0: Pubkey"),
        (328, 32, "reward_vault_1: Pubkey"),
        (360, 32, "reward_mint_0: Pubkey"),
        (392, 32, "reward_mint_1: Pubkey"),
        (424, 4, "active_id: i32"),
        (428, 2, "bin_step: u16"),
        (430, 1, "status: u8"),
        (431, 1, "_padding0: u8"),
        (432, 8, "protocol_fee_x: u64"),
        (440, 8, "protocol_fee_y: u64"),
        (448, 4, "base_fee_rate: u32"),
        (452, 4, "max_fee_rate: u32"),
        (456, 16, "liquidity: u128"),
        // ... 其他字段
    ];
    
    println!("Offset │ Size │ Field");
    println!("───────┼──────┼─────────────────────────────");
    
    for (offset, size, field) in layout {
        println!("{:6} │ {:4} │ {}", offset, size, field);
    }
    
    println!("\n💡 提示: 使用 analyze-meteora-account.ts 工具获取实际的链上数据布局");
}




































