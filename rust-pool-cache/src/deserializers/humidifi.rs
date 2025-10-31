use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// HumidiFi Pool State
/// 
/// HumidiFi is a Solana-based DEX
/// 
/// Program ID: 9H6tua7jkLhdm3w8BvgpTn5LZNU7g4ZynDmCiNN3q6Rp
/// Data size: 1728 bytes (same structure size as SolFi V2, but different data layout)
/// 
/// ⚠️ CRITICAL DIFFERENCE from SolFi V2:
/// - All config_fields are 0 (verified 2025-10-28)
/// - Reserves are stored in external vault accounts
/// - Must use vault reading to get actual reserves
/// 
/// Structure:
/// - 5 u64 header fields (40 bytes) - contains large encoded values
/// - 25 Pubkey fields (800 bytes) - pubkey_4 and pubkey_5 are vaults
/// - 111 u64 configuration/reserve fields (888 bytes) - ALL ZEROS
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct HumidiFiPoolState {
    /// Header fields (5 u64 = 40 bytes)
    pub header_field_1: u64,
    pub header_field_2: u64,
    pub header_field_3: u64,
    pub header_field_4: u64,
    pub header_field_5: u64,
    
    /// Pubkey fields (25 Pubkeys = 800 bytes)
    pub pubkey_1: Pubkey,
    pub pubkey_2: Pubkey,  // Likely token A mint
    pub pubkey_3: Pubkey,  // Likely token B mint
    pub pubkey_4: Pubkey,  // Likely token A vault
    pub pubkey_5: Pubkey,  // Likely token B vault
    pub pubkey_6: Pubkey,  // Likely LP mint
    pub pubkey_7: Pubkey,
    pub pubkey_8: Pubkey,
    pub pubkey_9: Pubkey,
    pub pubkey_10: Pubkey,
    pub pubkey_11: Pubkey,
    pub pubkey_12: Pubkey,
    pub pubkey_13: Pubkey,
    pub pubkey_14: Pubkey,
    pub pubkey_15: Pubkey,
    pub pubkey_16: Pubkey,
    pub pubkey_17: Pubkey,
    pub pubkey_18: Pubkey,
    pub pubkey_19: Pubkey,
    pub pubkey_20: Pubkey,
    pub pubkey_21: Pubkey,
    pub pubkey_22: Pubkey,
    pub pubkey_23: Pubkey,
    pub pubkey_24: Pubkey,
    pub pubkey_25: Pubkey,
    
    /// Configuration and reserve fields (111 u64 = 888 bytes)
    pub config_fields: [u64; 111],
}

impl HumidiFiPoolState {
    /// Get token A vault address
    pub fn token_a_vault(&self) -> &Pubkey {
        &self.pubkey_4
    }
    
    /// Get token B vault address
    pub fn token_b_vault(&self) -> &Pubkey {
        &self.pubkey_5
    }
    
    /// Get reserve A amount
    /// ⚠️ WARNING: HumidiFi pools DO NOT store reserves in pool account
    /// Real reserves must be read from token vault accounts
    /// 
    /// Analysis shows all config_fields are 0, meaning vault reading is required
    pub fn get_reserve_a(&self) -> u64 {
        // HumidiFi stores reserves in external vault accounts
        // All config_fields are 0 (verified 2025-10-28)
        // Must read from vault accounts
        0
    }
    
    /// Get reserve B amount
    /// ⚠️ WARNING: Must read from vault (see get_reserve_a documentation)
    pub fn get_reserve_b(&self) -> u64 {
        // HumidiFi does not store reserves in pool account
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
    
    /// Get formatted reserves
    pub fn get_reserves_formatted(&self) -> (f64, f64) {
        const DECIMALS: i32 = 6;
        let reserve_a = self.get_reserve_a() as f64 / 10_f64.powi(DECIMALS);
        let reserve_b = self.get_reserve_b() as f64 / 10_f64.powi(DECIMALS);
        (reserve_a, reserve_b)
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for HumidiFiPoolState {
    fn dex_name(&self) -> &'static str {
        "HumidiFi"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        if data.len() != 1728 {
            return Err(DexError::InvalidData(format!(
                "HumidiFi pool data should be 1728 bytes, got {}",
                data.len()
            )));
        }
        
        Self::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!("HumidiFi: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        HumidiFiPoolState::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        (self.get_reserve_a(), self.get_reserve_b())
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (6, 6)
    }
    
    fn is_active(&self) -> bool {
        // ✅ CORRECT: HumidiFi 使用Vault模式，储备量在外部vault账户中
        // 检查vault地址是否有效（虽然HumidiFi已禁用，但保持代码正确性）
        self.token_a_vault() != &Pubkey::default() && 
        self.token_b_vault() != &Pubkey::default()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "Vault Reading Mode - Header[0]={}, Header[1]={}",
            self.header_field_1,
            self.header_field_2
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // HumidiFi stores reserves in external vault accounts
        // Return vault addresses so system can subscribe and read actual balances
        Some((*self.token_a_vault(), *self.token_b_vault()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_size() {
        let expected = 8 * 5 + 32 * 25 + 8 * 111;
        assert_eq!(expected, 1728);
    }
}




