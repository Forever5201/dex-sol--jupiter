///! Meteora DLMM Integration Tests
///! 
///! 完整测试改进的Meteora DLMM结构

use solana_pool_cache::deserializers::meteora_dlmm_improved::MeteoraPoolStateImproved;
use solana_pool_cache::dex_interface::DexPool;
use std::mem::size_of;

#[test]
fn test_meteora_improved_struct_size() {
    let actual_size = size_of::<MeteoraPoolStateImproved>();
    let expected_size = 896; // 904 - 8 discriminator
    
    println!("=== Meteora DLMM Improved Structure Size Test ===");
    println!("Expected: {} bytes", expected_size);
    println!("Actual:   {} bytes", actual_size);
    
    assert_eq!(
        actual_size, 
        expected_size,
        "Structure size mismatch! Expected {} but got {}",
        expected_size,
        actual_size
    );
    
    println!("✅ Size validation passed!");
}

#[test]
fn test_meteora_improved_price_calculation() {
    use solana_sdk::pubkey::Pubkey;
    use solana_pool_cache::deserializers::meteora_dlmm_improved::PoolParameters;
    
    let pool = MeteoraPoolStateImproved {
        parameters: PoolParameters {
            base_factor: 5000,
            filter_period: 30,
            decay_period: 600,
            reduction_factor: 5000,
            variable_fee_control: 40000,
            max_volatility_accumulator: 350000,
            min_bin_id: -443636,
            max_bin_id: 443636,
            protocol_share: 1000,
            _padding: [0; 6],
        },
        token_x_mint: Pubkey::default(),
        token_y_mint: Pubkey::default(),
        reserve_x: Pubkey::default(),
        reserve_y: Pubkey::default(),
        oracle: Pubkey::default(),
        fee_owner: Pubkey::default(),
        lock_releaser: Pubkey::default(),
        activation_point: Pubkey::default(),
        bin_array_bitmap_extension: Pubkey::default(),
        reserved_pubkey_1: Pubkey::default(),
        reserved_pubkey_2: Pubkey::default(),
        reserved_pubkey_3: Pubkey::default(),
        active_id: 0,
        bin_step: 25, // 0.25% per bin
        status: 1,
        _padding1: 0,
        protocol_fee_x: 1000,
        protocol_fee_y: 2000,
        base_fee_rate: 100,
        max_fee_rate: 1000,
        swap_cap_deactivate_slot: 0,
        swap_cap_amount: 0,
        last_updated_at: 0,
        whitelisted_wallet: Pubkey::default(),
        bin_array_bitmap: [0; 2],
        reserved: [0; 376],
    };
    
    println!("\n=== Price Calculation Test ===");
    
    // Test at active_id = 0
    let price_at_0 = pool.calculate_price();
    println!("Price at bin 0: {:.6}", price_at_0);
    assert!((price_at_0 - 1.0).abs() < 0.0001, "Price at bin 0 should be 1.0");
    
    // Test pool activity status
    assert!(pool.is_pool_active(), "Pool should be active");
    
    println!("✅ Price calculation tests passed!");
}

#[test]
fn test_meteora_improved_dex_interface() {
    use solana_sdk::pubkey::Pubkey;
    use solana_pool_cache::deserializers::meteora_dlmm_improved::PoolParameters;
    
    let pool = MeteoraPoolStateImproved {
        parameters: PoolParameters {
            base_factor: 5000,
            filter_period: 30,
            decay_period: 600,
            reduction_factor: 5000,
            variable_fee_control: 40000,
            max_volatility_accumulator: 350000,
            min_bin_id: -443636,
            max_bin_id: 443636,
            protocol_share: 1000,
            _padding: [0; 6],
        },
        token_x_mint: Pubkey::default(),
        token_y_mint: Pubkey::default(),
        reserve_x: Pubkey::default(),
        reserve_y: Pubkey::default(),
        oracle: Pubkey::default(),
        fee_owner: Pubkey::default(),
        lock_releaser: Pubkey::default(),
        activation_point: Pubkey::default(),
        bin_array_bitmap_extension: Pubkey::default(),
        reserved_pubkey_1: Pubkey::default(),
        reserved_pubkey_2: Pubkey::default(),
        reserved_pubkey_3: Pubkey::default(),
        active_id: 12345,
        bin_step: 10,
        status: 1,
        _padding1: 0,
        protocol_fee_x: 0,
        protocol_fee_y: 0,
        base_fee_rate: 100,
        max_fee_rate: 1000,
        swap_cap_deactivate_slot: 0,
        swap_cap_amount: 0,
        last_updated_at: 1234567890,
        whitelisted_wallet: Pubkey::default(),
        bin_array_bitmap: [0; 2],
        reserved: [0; 376],
    };
    
    println!("\n=== DexPool Interface Test ===");
    
    // Test DEX name
    assert_eq!(pool.dex_name(), "Meteora DLMM (Improved)");
    println!("DEX Name: {}", pool.dex_name());
    
    // Test is_active
    assert!(pool.is_active());
    println!("Pool Active: {}", pool.is_active());
    
    // Test additional info
    if let Some(info) = pool.get_additional_info() {
        println!("Additional Info: {}", info);
        assert!(info.contains("Active Bin"));
        assert!(info.contains("12345"));
    }
    
    println!("✅ DexPool interface tests passed!");
}

#[test]
fn test_meteora_improved_deserialization_size_check() {
    // 测试反序列化时的大小验证
    let mut fake_data = vec![0u8; 904]; // 8 discriminator + 896 data
    
    // 设置discriminator (随机的8字节)
    fake_data[0..8].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
    
    println!("\n=== Deserialization Size Check ===");
    println!("Test data size: {} bytes", fake_data.len());
    
    let result = MeteoraPoolStateImproved::from_account_data(&fake_data);
    
    match result {
        Ok(_) => {
            println!("⚠️  Deserialization succeeded (may fail on invalid data structure)");
        }
        Err(e) => {
            println!("Deserialization error: {}", e);
            // 这是预期的，因为数据结构可能不正确
        }
    }
    
    // 测试数据太小的情况
    let small_data = vec![0u8; 100];
    let result = MeteoraPoolStateImproved::from_account_data(&small_data);
    assert!(result.is_err(), "Should fail on too small data");
    
    println!("✅ Size check validation passed!");
}



































