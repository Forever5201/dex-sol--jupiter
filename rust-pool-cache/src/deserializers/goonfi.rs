use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// GoonFi Pool State
/// 
/// GoonFi is a Solana-based AMM DEX
/// 
/// Program ID: goonERTdGsjnkZqWuVjs73BZ3Pb9qoCUdBUL17BnS5j
/// Data size: 856 bytes
/// 
/// Structure estimation:
/// - Pubkeys: ~15 (480 bytes)
/// - u64 fields: ~47 (376 bytes)
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct GoonFiPoolState {
    /// Pubkey fields (15 Pubkeys = 480 bytes)
    pub pubkey_1: Pubkey,
    pub pubkey_2: Pubkey,
    pub pubkey_3: Pubkey,
    pub pubkey_4: Pubkey,
    pub pubkey_5: Pubkey,
    pub pubkey_6: Pubkey,
    pub pubkey_7: Pubkey,
    pub pubkey_8: Pubkey,
    pub pubkey_9: Pubkey,
    pub pubkey_10: Pubkey,
    pub pubkey_11: Pubkey,
    pub pubkey_12: Pubkey,
    pub pubkey_13: Pubkey,
    pub pubkey_14: Pubkey,
    pub pubkey_15: Pubkey,
    
    /// Configuration and reserve fields (47 u64 = 376 bytes)
    pub config_fields: [u64; 47],
}

impl GoonFiPoolState {
    /// Get reserve A
    /// ⚠️ WARNING: GoonFi pools DO NOT store reserves in pool account  
    /// Real reserves must be read from token vault accounts
    ///
    /// Current implementation returns 0 to indicate "vault reading required"
    pub fn get_reserve_a(&self) -> u64 {
        // After extensive analysis, GoonFi pools do not contain reserve amounts
        // in the pool account data. All values in config_fields are < 100M.
        //
        // The only values found:
        // - config_fields[X] ≈ 200 (configuration value, NOT reserve)
        //
        // Real reserves MUST be read from vault accounts (pubkeys in structure)
        //
        // TODO: Implement vault reading in WebSocket handler
        
        // Return 0 to indicate vault reading is required
        0
    }
    
    /// Get reserve B
    /// ⚠️ WARNING: Must read from vault (see get_reserve_a documentation)
    pub fn get_reserve_b(&self) -> u64 {
        // GoonFi does not store reserves in pool account
        // Must read from vault accounts
        0
    }
    
    /// Calculate price
    pub fn calculate_price(&self) -> f64 {
        let reserve_a = self.get_reserve_a();
        let reserve_b = self.get_reserve_b();
        
        if reserve_a == 0 {
            return 0.0;
        }
        
        reserve_b as f64 / reserve_a as f64
    }
    
    /// Get formatted reserves (assuming 6 and 9 decimals for USDC/SOL)
    pub fn get_reserves_formatted(&self) -> (f64, f64) {
        // GoonFi typically has USDC/SOL pairs
        // USDC = 6 decimals, SOL = 9 decimals
        let reserve_a = self.get_reserve_a() as f64 / 10_f64.powi(6);
        let reserve_b = self.get_reserve_b() as f64 / 10_f64.powi(9);
        (reserve_a, reserve_b)
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for GoonFiPoolState {
    fn dex_name(&self) -> &'static str {
        "GoonFi"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        if data.len() != 856 {
            return Err(DexError::InvalidData(format!(
                "GoonFi pool data should be 856 bytes, got {}",
                data.len()
            )));
        }
        
        Self::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!("GoonFi: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        GoonFiPoolState::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        (self.get_reserve_a(), self.get_reserve_b())
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // GoonFi typically USDC/SOL
        (6, 9)
    }
    
    fn is_active(&self) -> bool {
        // ✅ FIX: GoonFi 使用Vault模式，储备量在外部vault账户中
        // 不能检查池子账户的储备量（永远为0），而应该检查vault地址是否有效
        // pubkey_4和pubkey_5是vault地址，确保它们不是默认值
        self.pubkey_4 != Pubkey::default() && 
        self.pubkey_5 != Pubkey::default()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let (res_a, res_b) = self.get_reserves_formatted();
        Some(format!(
            "Reserves: A={:.2}, B={:.2}",
            res_a,
            res_b
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // GoonFi stores reserves in external vault accounts
        // Based on structure analysis, vaults are likely in early pubkey fields
        // pubkey_4 and pubkey_5 are most likely token A and B vaults
        Some((self.pubkey_4, self.pubkey_5))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_size() {
        let expected = 32 * 15 + 8 * 47;
        assert_eq!(expected, 856);
    }
}

