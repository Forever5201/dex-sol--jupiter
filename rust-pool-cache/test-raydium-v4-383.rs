// 测试383字节Raydium V4结构
use std::mem::size_of;

#[repr(C)]
struct RaydiumV4_383 {
    // 19个u64 (header + config fields)
    status: u64,
    nonce: u64,
    order_num: u64,
    depth: u64,
    coin_decimals: u64,
    pc_decimals: u64,
    state: u64,
    reset_flag: u64,
    min_size: u64,
    vol_max_cut_ratio: u64,
    amount_wave_ratio: u64,
    coin_lot_size: u64,
    pc_lot_size: u64,
    min_price_multiplier: u64,
    max_price_multiplier: u64,
    system_decimal_value: u64,
    // = 16 u64 = 128 bytes
    
    // 试探：可能只有7个Pubkeys，不是12个
    field1: [u8; 32],
    field2: [u8; 32],
    field3: [u8; 32],
    field4: [u8; 32],
    field5: [u8; 32],
    field6: [u8; 32],
    field7: [u8; 32],
    // = 7*32 = 224 bytes
    
    // 关键：储备量字段
    reserve_a: u64,
    reserve_b: u64,
    lp_supply: u64,
    // = 3*8 = 24 bytes
}

fn main() {
    println!("RaydiumV4 383-byte structure test:");
    let size_16_u64_7_pubkey_3_u64 = size_of::<RaydiumV4_383>();
    println!("16 u64 + 7 Pubkey + 3 u64 = {} bytes", size_16_u64_7_pubkey_3_u64);
    
    // 试探其他组合
    println!("\n16 u64 = {} bytes", 16 * 8);
    println!("12 Pubkey = {} bytes", 12 * 32);
    println!("3 u64 = {} bytes", 3 * 8);
    println!("Total = {} bytes", 16 * 8 + 12 * 32 + 3 * 8);
    
    println!("\nTarget: 383 bytes");
    println!("If 16 u64 + X Pubkeys + 3 u64:");
    let remaining = 383 - 16 * 8 - 3 * 8;
    println!("  Need {} bytes for Pubkeys", remaining);
    println!("  = {} Pubkeys", remaining / 32);
}















