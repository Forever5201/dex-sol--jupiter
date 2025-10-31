// 测试结构体大小
use std::mem::size_of;

// Raydium CLMM 模拟
#[repr(C)]
struct RaydiumClmmTest {
    bump: [u8; 1],
    amm_config: [u8; 32],
    owner: [u8; 32],
    token_vault_0: [u8; 32],
    token_vault_1: [u8; 32],
    lp_mint: [u8; 32],
    token_mint_0: [u8; 32],
    token_mint_1: [u8; 32],
    token_program_0: [u8; 32],
    token_program_1: [u8; 32],
    observation_key: [u8; 32],
    protocol_fees_token_0: u64,
    protocol_fees_token_1: u64,
    swap_in_amount_token_0: u128,
    swap_out_amount_token_1: u128,
    swap_in_amount_token_1: u128,
    swap_out_amount_token_0: u128,
    status: u8,
    status_bit_flag: u8,
    mint_decimals_0: u8,
    mint_decimals_1: u8,
    tick_spacing: u16,
    liquidity: u128,
    tick_current: i32,
    protocol_fee_rate: u32,
    trade_fee_rate: u32,
    tick_array_bitmap: [u64; 16],
    total_fees_token_0: u64,
    total_fees_claimed_token_0: u64,
    total_fees_token_1: u64,
    total_fees_claimed_token_1: u64,
    fund_fees_token_0: u64,
    fund_fees_token_1: u64,
    open_time: u64,
    recent_epoch: u64,
}

fn main() {
    let base_size = size_of::<RaydiumClmmTest>();
    println!("Raydium CLMM base structure size: {} bytes", base_size);
    println!("Target size: 1544 bytes");
    println!("Need padding: {} bytes = {} u64", 1544 - base_size, (1544 - base_size) / 8);
    
    // Meteora
    println!("\nMeteora DLMM:");
    let meteora_base = 30 + 16*32 + 254; // PoolParameters + 16 Pubkeys + other fields
    println!("Base size estimate: {} bytes", meteora_base);
    println!("Target: 896 bytes (904 - 8 discriminator)");
    println!("Need padding: {} bytes", 896 - meteora_base);
}















