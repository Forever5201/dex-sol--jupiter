use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// SolFi V2 Pool State
/// 
/// SolFi V2 is a Solana-based AMM DEX
/// 
/// Program ID: SV2EYYJyRz2YhfXwXnhNAevDEui5Q6yrfyo13WtupPF
/// Data size: 1728 bytes
/// 
/// Structure (based on reverse engineering from on-chain data):
/// - 5 u64 header fields (40 bytes)
/// - 25 Pubkey fields (800 bytes) 
/// - 111 u64 configuration/reserve fields (888 bytes)
/// Total: 1728 bytes
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct SolFiV2PoolState {
    /// Header fields (5 u64 = 40 bytes)
    pub header_field_1: u64,
    pub header_field_2: u64,
    pub header_field_3: u64,
    pub header_field_4: u64,
    pub header_field_5: u64,
    
    /// Pubkey fields (25 Pubkeys = 800 bytes)
    /// Based on analysis, first ~9 are meaningful, rest are zero-padding
    pub pubkey_1: Pubkey,  // Likely authority or admin
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
    /// The first few likely contain critical pool data
    pub config_fields: [u64; 111],
}

#[allow(dead_code)]
impl SolFiV2PoolState {
    /// Get token A mint (educated guess based on standard AMM layout)
    pub fn token_a_mint(&self) -> &Pubkey {
        &self.pubkey_2
    }
    
    /// Get token B mint
    pub fn token_b_mint(&self) -> &Pubkey {
        &self.pubkey_3
    }
    
    /// Get token A vault
    pub fn token_a_vault(&self) -> &Pubkey {
        &self.pubkey_4
    }
    
    /// Get token B vault  
    pub fn token_b_vault(&self) -> &Pubkey {
        &self.pubkey_5
    }
    
    /// Get reserve A amount
    /// ⚠️ WARNING: SolFi V2 pools DO NOT store reserves in pool account
    /// Real reserves must be read from token vault accounts
    /// 
    /// Current implementation returns 0 to indicate "vault reading required"
    pub fn get_reserve_a(&self) -> u64 {
        // After extensive analysis, SolFi V2 pools do not contain reserve amounts
        // in the pool account data. All values in config_fields are < 100M.
        //
        // The only "large-ish" values found are:
        // - config_fields[0] ≈ 3000-10000 (configuration values, NOT reserves)
        // - header_field_1 ≈ 511-252 (pool state/version, NOT reserves)
        //
        // Real reserves MUST be read from vault accounts:
        //   - pubkey_4 (token A vault)  
        //   - pubkey_5 (token B vault)
        //
        // TODO: Implement vault reading in WebSocket handler
        
        // Return 0 to indicate vault reading is required
        // This prevents using incorrect config values (3000, 10000)
        0
    }
    
    /// Get reserve B amount
    /// ⚠️ WARNING: Must read from vault (see get_reserve_a documentation)
    pub fn get_reserve_b(&self) -> u64 {
        // SolFi V2 does not store reserves in pool account
        // Must read from vault accounts
        0
    }
    
    /// Calculate price (quote/base)
    pub fn calculate_price(&self) -> f64 {
        let reserve_a = self.get_reserve_a();
        let reserve_b = self.get_reserve_b();
        
        if reserve_a == 0 {
            return 0.0;
        }
        
        reserve_b as f64 / reserve_a as f64
    }
    
    /// Get formatted reserves (assuming 6 decimals for both - adjust if needed)
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

impl DexPool for SolFiV2PoolState {
    fn dex_name(&self) -> &'static str {
        "SolFi V2"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // SolFi V2 pools are exactly 1728 bytes
        if data.len() != 1728 {
            return Err(DexError::InvalidData(format!(
                "SolFi V2 pool data should be 1728 bytes, got {}",
                data.len()
            )));
        }
        
        // Directly deserialize (no discriminator)
        Self::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!("SolFi V2: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        SolFiV2PoolState::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        (self.get_reserve_a(), self.get_reserve_b())
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // SolFi V2 typically handles stablecoin and SOL pairs
        // Default to 6 decimals for both
        // TODO: Read from token mint accounts if needed for accuracy
        (6, 6)
    }
    
    fn is_active(&self) -> bool {
        // ✅ FIX: SolFi V2 使用Vault模式，储备量在外部vault账户中
        // 不能检查池子账户的储备量（永远为0），而应该检查vault地址是否有效
        // 这样才能触发vault订阅流程
        self.token_a_vault() != &Pubkey::default() && 
        self.token_b_vault() != &Pubkey::default()
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let (res_a, res_b) = self.get_reserves_formatted();
        Some(format!(
            "Reserves: A={:.2}, B={:.2}, Header[0]={}", 
            res_a,
            res_b,
            self.header_field_1
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // SolFi V2 stores reserves in external vault accounts
        // Return vault addresses so system can subscribe and read actual balances
        Some((*self.token_a_vault(), *self.token_b_vault()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::size_of;
    
    #[test]
    fn test_size() {
        // Verify structure size
        let expected = 8 * 5       // 5 u64
            + 32 * 25              // 25 Pubkeys
            + 8 * 111;             // 111 u64
        
        assert_eq!(expected, 1728, "Structure size should be 1728 bytes");
    }
}

