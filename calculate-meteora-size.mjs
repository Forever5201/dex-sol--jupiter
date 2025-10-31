// 计算Meteora DLMM结构体大小

console.log('Meteora DLMM 结构体大小计算:');
console.log('='.repeat(60));

let offset = 0;

console.log(`Discriminator: 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nPoolParameters: 32 bytes (offset ${offset})`);
console.log('  - base_factor (u16): 2');
console.log('  - filter_period (u16): 2');
console.log('  - decay_period (u16): 2');
console.log('  - reduction_factor (u16): 2');
console.log('  - variable_fee_control (u32): 4');
console.log('  - max_volatility_accumulator (u32): 4');
console.log('  - min_bin_id (i32): 4');
console.log('  - max_bin_id (i32): 4');
console.log('  - protocol_share (u16): 2');
console.log('  - padding ([u8; 6]): 6');
offset += 32;

console.log(`\n12 Pubkeys: 384 bytes (offset ${offset})`);
offset += 384;

console.log(`\nactive_id (i32): 4 bytes (offset ${offset})`);
offset += 4;

console.log(`\nbin_step (u16): 2 bytes (offset ${offset})`);
offset += 2;

console.log(`\nstatus (u8): 1 byte (offset ${offset})`);
offset += 1;

console.log(`\n_padding0 (u8): 1 byte (offset ${offset})`);
offset += 1;

console.log(`\nprotocol_fee_x (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nprotocol_fee_y (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nbase_fee_rate (u32): 4 bytes (offset ${offset})`);
offset += 4;

console.log(`\nmax_fee_rate (u32): 4 bytes (offset ${offset})`);
offset += 4;

console.log(`\nliquidity (u128): 16 bytes (offset ${offset})`);
offset += 16;

console.log(`\nreward_duration_0 (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nreward_duration_1 (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nreward_duration_end_0 (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nreward_duration_end_1 (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nreward_rate_0 (u128): 16 bytes (offset ${offset})`);
offset += 16;

console.log(`\nreward_rate_1 (u128): 16 bytes (offset ${offset})`);
offset += 16;

console.log(`\nreward_last_update_time_0 (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nreward_last_update_time_1 (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nreward_cumulative_per_share_x_0 (u128): 16 bytes (offset ${offset})`);
offset += 16;

console.log(`\nreward_cumulative_per_share_x_1 (u128): 16 bytes (offset ${offset})`);
offset += 16;

console.log(`\nvolatility_accumulator (u32): 4 bytes (offset ${offset})`);
offset += 4;

console.log(`\nvolatility_reference (u32): 4 bytes (offset ${offset})`);
offset += 4;

console.log(`\nlast_update_timestamp (i64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nswap_cap_amount (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nswap_cap_deactivate_slot (u64): 8 bytes (offset ${offset})`);
offset += 8;

console.log(`\nwhitelisted_wallet (Pubkey): 32 bytes (offset ${offset})`);
offset += 32;

console.log(`\npre_activation_swap_address (Pubkey): 32 bytes (offset ${offset})`);
offset += 32;

console.log(`\nbase_key (Pubkey): 32 bytes (offset ${offset})`);
offset += 32;

console.log(`\nactivation_type (u8): 1 byte (offset ${offset})`);
offset += 1;

console.log(`\n_padding1 ([u8; 7]): 7 bytes (offset ${offset})`);
offset += 7;

console.log('\n' + '='.repeat(60));
console.log(`当前总计: ${offset} bytes`);
console.log(`目标大小: 904 bytes (含discriminator) = 896 bytes (不含discriminator)`);
console.log(`还需填充: ${904 - offset} bytes`);

const paddingNeeded = 904 - offset;
const u64Count = Math.floor(paddingNeeded / 8);
const remainingBytes = paddingNeeded % 8;

console.log(`\n填充方案:`);
console.log(`  - padding: [u64; ${u64Count}] = ${u64Count * 8} bytes`);
console.log(`  - padding_bytes: [u8; ${remainingBytes}] = ${remainingBytes} bytes`);
console.log(`  - 总填充: ${u64Count * 8 + remainingBytes} bytes`);
console.log(`  - 最终大小: ${offset + u64Count * 8 + remainingBytes} bytes`);












