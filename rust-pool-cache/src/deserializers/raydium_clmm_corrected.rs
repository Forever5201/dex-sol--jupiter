use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};
use std::convert::TryInto;

/// Raydium CLMM (Concentrated Liquidity Market Maker) Pool State
/// 
/// 🔥 CORRECTED STRUCTURE based on official Raydium CLMM program
/// Source: https://github.com/raydium-io/raydium-clmm/blob/master/programs/amm/src/states/pool.rs
/// 
/// Data length: 1544 bytes (1536 bytes + 8 bytes Anchor discriminator)
/// Uses Anchor zero_copy (bytemuck) deserialization, NOT Borsh!
/// 
/// Field offsets (after 8-byte discriminator):
/// - 0: bump (1 byte)
/// - 1-33: amm_config (Pubkey)
/// - 33-65: owner (Pubkey)
/// - 65-97: token_mint_0 (Pubkey) ← 第4个字段！
/// - 97-129: token_mint_1 (Pubkey)
/// - 129-161: token_vault_0 (Pubkey) ← vault在mint之后！
/// - 161-193: token_vault_1 (Pubkey)
/// - 193-225: observation_key (Pubkey)
/// - 225: mint_decimals_0 (u8)
/// - 226: mint_decimals_1 (u8)
/// - 227-229: tick_spacing (u16)
/// - 229-245: liquidity (u128)
/// - 245-261: sqrt_price_x64 (u128)
/// - 261-265: tick_current (i32)
/// - ...
#[derive(Debug, Clone)]
pub struct RaydiumClmmPoolState {
    /// Bump seed for PDA
    pub bump: u8,
    
    /// AMM configuration
    pub amm_config: Pubkey,
    
    /// Pool creator
    pub owner: Pubkey,
    
    /// Token mint A (SOL, mSOL, etc.)
    pub token_mint_0: Pubkey,
    
    /// Token mint B
    pub token_mint_1: Pubkey,
    
    /// Token vault A
    pub token_vault_0: Pubkey,
    
    /// Token vault B  
    pub token_vault_1: Pubkey,
    
    /// Observation account
    pub observation_key: Pubkey,
    
    /// Token decimals
    pub mint_decimals_0: u8,
    pub mint_decimals_1: u8,
    
    /// Tick spacing (for price ranges)
    pub tick_spacing: u16,
    
    /// Liquidity
    pub liquidity: u128,
    
    /// Current price as sqrt(token_1/token_0) in Q64.64 format
    pub sqrt_price_x64: u128,
    
    /// Current tick (price)
    pub tick_current: i32,
}

impl RaydiumClmmPoolState {
    /// Parse from raw account data (manual parsing for Anchor zero_copy format)
    pub fn from_account_data_manual(data: &[u8]) -> Result<Self, DexError> {
        // Raydium CLMM accounts are 1544 bytes (including 8-byte Anchor discriminator)
        if data.len() != 1544 {
            return Err(DexError::InvalidData(format!(
                "Raydium CLMM pool data must be exactly 1544 bytes, got {}",
                data.len()
            )));
        }
        
        // Skip 8-byte Anchor discriminator
        let data = &data[8..];
        
        // Manually extract fields according to official structure
        let mut offset = 0;
        
        // bump (1 byte)
        let bump = data[offset];
        offset += 1;
        
        // amm_config (32 bytes)
        let amm_config = Pubkey::new(&data[offset..offset+32]);
        offset += 32;
        
        // owner (32 bytes)
        let owner = Pubkey::new(&data[offset..offset+32]);
        offset += 32;
        
        // 🔥 token_mint_0 (32 bytes) - 第4个字段！
        let token_mint_0 = Pubkey::new(&data[offset..offset+32]);
        offset += 32;
        
        // token_mint_1 (32 bytes)
        let token_mint_1 = Pubkey::new(&data[offset..offset+32]);
        offset += 32;
        
        // 🔥 token_vault_0 (32 bytes) - vault在mint之后！
        let token_vault_0 = Pubkey::new(&data[offset..offset+32]);
        offset += 32;
        
        // token_vault_1 (32 bytes)
        let token_vault_1 = Pubkey::new(&data[offset..offset+32]);
        offset += 32;
        
        // observation_key (32 bytes)
        let observation_key = Pubkey::new(&data[offset..offset+32]);
        offset += 32;
        
        // mint_decimals_0 (1 byte)
        let mint_decimals_0 = data[offset];
        offset += 1;
        
        // mint_decimals_1 (1 byte)
        let mint_decimals_1 = data[offset];
        offset += 1;
        
        // tick_spacing (2 bytes, u16 little-endian)
        let tick_spacing = u16::from_le_bytes(data[offset..offset+2].try_into().unwrap());
        offset += 2;
        
        // liquidity (16 bytes, u128 little-endian)
        let liquidity = u128::from_le_bytes(data[offset..offset+16].try_into().unwrap());
        offset += 16;
        
        // sqrt_price_x64 (16 bytes, u128 little-endian)
        let sqrt_price_x64 = u128::from_le_bytes(data[offset..offset+16].try_into().unwrap());
        offset += 16;
        
        // tick_current (4 bytes, i32 little-endian)
        let tick_current = i32::from_le_bytes(data[offset..offset+4].try_into().unwrap());
        
        Ok(RaydiumClmmPoolState {
            bump,
            amm_config,
            owner,
            token_mint_0,
            token_mint_1,
            token_vault_0,
            token_vault_1,
            observation_key,
            mint_decimals_0,
            mint_decimals_1,
            tick_spacing,
            liquidity,
            sqrt_price_x64,
            tick_current,
        })
    }
    
    /// Calculate price from sqrt_price_x64
    /// 
    /// price = (sqrt_price / 2^64) ^ 2
    pub fn calculate_price(&self) -> f64 {
        if self.sqrt_price_x64 == 0 {
            return 0.0;
        }
        
        // sqrt_price is Q64.64 format
        const Q64: f64 = (1u128 << 64) as f64;
        let sqrt_price_f64 = self.sqrt_price_x64 as f64 / Q64;
        
        // price = sqrt_price^2
        let price = sqrt_price_f64 * sqrt_price_f64;
        
        // Adjust for decimals
        let decimal_adjustment = 10_f64.powi(
            self.mint_decimals_0 as i32 - self.mint_decimals_1 as i32
        );
        
        price * decimal_adjustment
    }
    
    /// Get effective reserves based on liquidity and price
    /// This is an approximation as CLMM doesn't store reserves directly
    pub fn get_effective_reserves(&self) -> (f64, f64) {
        let liquidity = self.liquidity as f64;
        let price = self.calculate_price();
        
        if liquidity == 0.0 || price <= 0.0 {
            return (0.0, 0.0);
        }
        
        // Approximate reserves from liquidity and price
        // reserve_0 ≈ L / sqrt(P)
        // reserve_1 ≈ L * sqrt(P)
        let sqrt_price = price.sqrt();
        
        let base_reserve = liquidity / sqrt_price;
        let quote_reserve = liquidity * sqrt_price;
        
        // Adjust for decimals
        let base_reserve = base_reserve / 10_f64.powi(self.mint_decimals_0 as i32);
        let quote_reserve = quote_reserve / 10_f64.powi(self.mint_decimals_1 as i32);
        
        (base_reserve, quote_reserve)
    }
    
    /// Check if pool is active
    pub fn is_active(&self) -> bool {
        self.liquidity > 0
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for RaydiumClmmPoolState {
    fn dex_name(&self) -> &'static str {
        "Raydium CLMM"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        Self::from_account_data_manual(data)
    }
    
    fn calculate_price(&self) -> f64 {
        self.calculate_price()
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // For CLMM, we approximate reserves from liquidity
        let (r0, r1) = self.get_effective_reserves();
        let reserve_0 = (r0 * 10_f64.powi(self.mint_decimals_0 as i32)) as u64;
        let reserve_1 = (r1 * 10_f64.powi(self.mint_decimals_1 as i32)) as u64;
        (reserve_0, reserve_1)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (self.mint_decimals_0, self.mint_decimals_1)
    }
    
    fn is_active(&self) -> bool {
        self.is_active()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "Tick: {}, Liquidity: {}, Price: {:.6}",
            self.tick_current,
            self.liquidity,
            self.calculate_price()
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // Raydium CLMM stores reserves in external vault accounts
        Some((self.token_vault_0, self.token_vault_1))
    }
}




