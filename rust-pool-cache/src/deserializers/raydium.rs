use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Raydium AMM V4 pool state structure
/// 
/// This structure mirrors the on-chain account layout used by Raydium's AMM V4 program.
/// Field order and sizes must match exactly for correct deserialization.
#[derive(Clone, Debug, BorshDeserialize, BorshSerialize)]
pub struct RaydiumAmmInfo {
    /// Pool status (0 = uninitialized, 1 = initialized, etc.)
    pub status: u64,
    
    /// Nonce for PDA derivation
    pub nonce: u64,
    
    /// Order number
    pub order_num: u64,
    
    /// Depth
    pub depth: u64,
    
    /// Base token decimals (e.g., 9 for SOL)
    pub coin_decimals: u64,
    
    /// Quote token decimals (e.g., 6 for USDC)
    pub pc_decimals: u64,
    
    /// State
    pub state: u64,
    
    /// Reset flag
    pub reset_flag: u64,
    
    /// Minimum size
    pub min_size: u64,
    
    /// Volume max cut ratio
    pub vol_max_cut_ratio: u64,
    
    /// Amount wave ratio
    pub amount_wave_ratio: u64,
    
    /// Coin lot size
    pub coin_lot_size: u64,
    
    /// PC lot size
    pub pc_lot_size: u64,
    
    /// Min price multiplier
    pub min_price_multiplier: u64,
    
    /// Max price multiplier
    pub max_price_multiplier: u64,
    
    /// System decimal value
    pub system_decimal_value: u64,
    
    // Mint addresses
    /// Base token mint
    pub coin_mint: Pubkey,
    
    /// Quote token mint
    pub pc_mint: Pubkey,
    
    /// LP token mint
    pub lp_mint: Pubkey,
    
    // Market related
    /// Open orders account
    pub open_orders: Pubkey,
    
    /// Serum market ID
    pub market_id: Pubkey,
    
    /// Serum market program ID
    pub market_program_id: Pubkey,
    
    /// Target orders
    pub target_orders: Pubkey,
    
    /// Withdraw queue
    pub withdraw_queue: Pubkey,
    
    // Vault addresses
    /// Base token vault
    pub coin_vault: Pubkey,
    
    /// Quote token vault
    pub pc_vault: Pubkey,
    
    /// Coin vault mint
    pub coin_vault_mint: Pubkey,
    
    /// PC vault mint
    pub pc_vault_mint: Pubkey,
    
    /// ⭐ CRITICAL: Base token reserve amount
    pub coin_vault_amount: u64,
    
    /// ⭐ CRITICAL: Quote token reserve amount
    pub pc_vault_amount: u64,
    
    /// LP token supply
    pub lp_supply: u64,
    
    // Additional fields from Raydium AMM V4 (total size: 752 bytes)
    /// Fees and rewards (27 u64 values for various fee parameters)
    /// Calculation: 19 u64 + 12 Pubkey + 27 u64 = (19+27)*8 + 12*32 = 368 + 384 = 752 bytes
    pub fees: [u64; 27],
}

#[allow(dead_code)]
impl RaydiumAmmInfo {
    /// Calculate the current price (quote token per base token)
    /// 
    /// For a SOL/USDC pool:
    /// - coin_vault_amount = SOL reserve
    /// - pc_vault_amount = USDC reserve
    /// - Result = USDC/SOL price
    #[allow(dead_code)]
    pub fn calculate_price(&self) -> f64 {
        let coin_reserve = self.coin_vault_amount as f64 / 10_f64.powi(self.coin_decimals as i32);
        let pc_reserve = self.pc_vault_amount as f64 / 10_f64.powi(self.pc_decimals as i32);
        
        if coin_reserve == 0.0 {
            return 0.0;
        }
        
        pc_reserve / coin_reserve
    }
    
    /// Calculate swap output using the constant product formula (x * y = k)
    /// 
    /// # Arguments
    /// * `amount_in` - Input amount (in base units, not decimals)
    /// * `is_coin_to_pc` - True if swapping base token to quote token
    /// * `fee_numerator` - Fee numerator (e.g., 25 for 0.25%)
    /// * `fee_denominator` - Fee denominator (e.g., 10000)
    /// 
    /// # Returns
    /// Output amount (in base units)
    #[allow(dead_code)]
    pub fn calculate_swap_output(
        &self,
        amount_in: u64,
        is_coin_to_pc: bool,
        fee_numerator: u64,
        fee_denominator: u64,
    ) -> u64 {
        let (reserve_in, reserve_out) = if is_coin_to_pc {
            (self.coin_vault_amount, self.pc_vault_amount)
        } else {
            (self.pc_vault_amount, self.coin_vault_amount)
        };
        
        // Deduct fee
        let amount_in_with_fee = amount_in
            .checked_mul(fee_denominator - fee_numerator)
            .unwrap_or(0)
            .checked_div(fee_denominator)
            .unwrap_or(0);
        
        // Calculate output: (reserve_out * amount_in_with_fee) / (reserve_in + amount_in_with_fee)
        reserve_out
            .checked_mul(amount_in_with_fee)
            .unwrap_or(0)
            .checked_div(reserve_in.checked_add(amount_in_with_fee).unwrap_or(u64::MAX))
            .unwrap_or(0)
    }
    
    /// Get human-readable reserve amounts
    pub fn get_reserves(&self) -> (f64, f64) {
        let coin_reserve = self.coin_vault_amount as f64 / 10_f64.powi(self.coin_decimals as i32);
        let pc_reserve = self.pc_vault_amount as f64 / 10_f64.powi(self.pc_decimals as i32);
        (coin_reserve, pc_reserve)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_calculate_price() {
        let pool = RaydiumAmmInfo {
            coin_vault_amount: 100_000 * 1_000_000_000, // 100,000 SOL
            pc_vault_amount: 18_500_000 * 1_000_000,    // 18,500,000 USDC
            coin_decimals: 9,
            pc_decimals: 6,
            ..Default::default()
        };
        
        let price = pool.calculate_price();
        assert!((price - 185.0).abs() < 0.01, "Expected price ~185 USDC/SOL, got {}", price);
    }
    
    #[test]
    fn test_calculate_swap_output() {
        let pool = RaydiumAmmInfo {
            coin_vault_amount: 100_000 * 1_000_000_000,
            pc_vault_amount: 18_500_000 * 1_000_000,
            ..Default::default()
        };
        
        // Swap 1 SOL for USDC (0.25% fee)
        let amount_in = 1_000_000_000; // 1 SOL
        let output = pool.calculate_swap_output(amount_in, true, 25, 10000);
        
        // Expected: ~184.5 USDC (after 0.25% fee)
        let expected = 184_500_000;
        assert!((output as i64 - expected as i64).abs() < 1_000_000, 
                "Expected ~{} USDC, got {}", expected, output);
    }
}

// Default implementation for testing
impl Default for RaydiumAmmInfo {
    fn default() -> Self {
        Self {
            status: 0,
            nonce: 0,
            order_num: 0,
            depth: 0,
            coin_decimals: 9,
            pc_decimals: 6,
            state: 0,
            reset_flag: 0,
            min_size: 0,
            vol_max_cut_ratio: 0,
            amount_wave_ratio: 0,
            coin_lot_size: 0,
            pc_lot_size: 0,
            min_price_multiplier: 0,
            max_price_multiplier: 0,
            system_decimal_value: 0,
            coin_mint: Pubkey::default(),
            pc_mint: Pubkey::default(),
            lp_mint: Pubkey::default(),
            open_orders: Pubkey::default(),
            market_id: Pubkey::default(),
            market_program_id: Pubkey::default(),
            target_orders: Pubkey::default(),
            withdraw_queue: Pubkey::default(),
            coin_vault: Pubkey::default(),
            pc_vault: Pubkey::default(),
            coin_vault_mint: Pubkey::default(),
            pc_vault_mint: Pubkey::default(),
            coin_vault_amount: 0,
            pc_vault_amount: 0,
            lp_supply: 0,
            fees: [0; 27],
        }
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for RaydiumAmmInfo {
    fn dex_name(&self) -> &'static str {
        "Raydium AMM V4"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // Check for "serum" prefix in 388-byte pools
        // 388-byte pools have a 5-byte "serum" prefix, 752-byte pools don't
        let data_to_parse = if data.len() == 388 && data.starts_with(b"serum") {
            // Skip the 5-byte "serum" prefix
            &data[5..]
        } else {
            data
        };
        
        // Try full structure first (752 bytes or 383 bytes after prefix removal)
        if let Ok(pool) = Self::try_from_slice(data_to_parse) {
            return Ok(pool);
        }
        
        // If standard parsing fails, try simplified structure
        // Note: 388-byte pools become 383 bytes after removing "serum" prefix
        if let Ok(simple_pool) = RaydiumAmmInfoSimple::try_from_slice(data_to_parse) {
            return Ok(simple_pool.into());
        }
        
        Err(DexError::DeserializationFailed(format!(
            "Raydium V4: Unexpected length of input, Data length: {} bytes (parsed: {} bytes)",
            data.len(),
            data_to_parse.len()
        )))
    }
    
    fn calculate_price(&self) -> f64 {
        // Reuse existing implementation
        let (coin_reserve, pc_reserve) = self.get_reserves();
        
        if coin_reserve == 0.0 {
            return 0.0;
        }
        
        pc_reserve / coin_reserve
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        (self.coin_vault_amount, self.pc_vault_amount)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (self.coin_decimals as u8, self.pc_decimals as u8)
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if status is non-zero
        self.status > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "LP Supply: {}, Status: {}",
            self.lp_supply,
            self.status
        ))
    }
}

// ============================================
// Simplified Raydium AMM Structure (383 bytes after "serum" prefix)
// ============================================
// For older Raydium V4 pools with "serum" prefix
// Structure: 16 u64 + 7 Pubkeys + 3 u64 + 7 bytes padding = 383 bytes

#[derive(Clone, Debug, BorshDeserialize, BorshSerialize)]
pub struct RaydiumAmmInfoSimple {
    // 16 u64 header fields (128 bytes)
    pub status: u64,
    pub nonce: u64,
    pub order_num: u64,
    pub depth: u64,
    pub coin_decimals: u64,
    pub pc_decimals: u64,
    pub state: u64,
    pub reset_flag: u64,
    pub min_size: u64,
    pub vol_max_cut_ratio: u64,
    pub amount_wave_ratio: u64,
    pub coin_lot_size: u64,
    pub pc_lot_size: u64,
    pub min_price_multiplier: u64,
    pub max_price_multiplier: u64,
    pub system_decimal_value: u64,
    
    // 7 Pubkeys (224 bytes) - older version has fewer Pubkeys
    pub coin_mint: Pubkey,
    pub pc_mint: Pubkey,
    pub lp_mint: Pubkey,
    pub coin_vault: Pubkey,
    pub pc_vault: Pubkey,
    pub market_id: Pubkey,
    pub open_orders: Pubkey,
    
    // 3 critical reserve fields (24 bytes)
    pub coin_vault_amount: u64,
    pub pc_vault_amount: u64,
    pub lp_supply: u64,
    
    // 7 bytes padding to reach 383 bytes
    pub padding: [u8; 7],
}

// Convert simplified to full structure
impl From<RaydiumAmmInfoSimple> for RaydiumAmmInfo {
    fn from(simple: RaydiumAmmInfoSimple) -> Self {
        Self {
            status: simple.status,
            nonce: simple.nonce,
            order_num: simple.order_num,
            depth: simple.depth,
            coin_decimals: simple.coin_decimals,
            pc_decimals: simple.pc_decimals,
            state: simple.state,
            reset_flag: simple.reset_flag,
            min_size: simple.min_size,
            vol_max_cut_ratio: simple.vol_max_cut_ratio,
            amount_wave_ratio: simple.amount_wave_ratio,
            coin_lot_size: simple.coin_lot_size,
            pc_lot_size: simple.pc_lot_size,
            min_price_multiplier: simple.min_price_multiplier,
            max_price_multiplier: simple.max_price_multiplier,
            system_decimal_value: simple.system_decimal_value,
            coin_mint: simple.coin_mint,
            pc_mint: simple.pc_mint,
            lp_mint: simple.lp_mint,
            open_orders: simple.open_orders,
            market_id: simple.market_id,
            market_program_id: Pubkey::default(), // Not in simple version
            target_orders: Pubkey::default(),      // Not in simple version
            withdraw_queue: Pubkey::default(),     // Not in simple version
            coin_vault: simple.coin_vault,
            pc_vault: simple.pc_vault,
            coin_vault_mint: Pubkey::default(),    // Not in simple version
            pc_vault_mint: Pubkey::default(),      // Not in simple version
            coin_vault_amount: simple.coin_vault_amount,
            pc_vault_amount: simple.pc_vault_amount,
            lp_supply: simple.lp_supply,
            fees: [0; 27], // Simple version has no fee fields
        }
    }
}


