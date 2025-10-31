use borsh::{BorshDeserialize, BorshSerialize};
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::DexError;

/// SPL Token Account State
/// 
/// This matches the on-chain layout of an SPL Token account (165 bytes total)
#[derive(Clone, Debug, BorshDeserialize, BorshSerialize)]
pub struct TokenAccount {
    /// The mint associated with this account
    pub mint: Pubkey,
    
    /// The owner of this account
    pub owner: Pubkey,
    
    /// ⭐ CRITICAL: The amount of tokens (in base units)
    pub amount: u64,
    
    /// Optional delegate
    pub delegate: Option<Pubkey>,
    
    /// Account state (0 = uninitialized, 1 = initialized, 2 = frozen)
    pub state: u8,
    
    /// Optional native amount (for wrapped SOL)
    pub is_native: Option<u64>,
    
    /// Delegated amount
    pub delegated_amount: u64,
    
    /// Optional close authority
    pub close_authority: Option<Pubkey>,
}

#[allow(dead_code)]
impl TokenAccount {
    /// Deserialize from account data
    /// 
    /// SPL Token accounts are 165 bytes:
    /// - No discriminator (not an Anchor account)
    /// - Direct Borsh deserialization
    pub fn from_account_data(data: &[u8]) -> Result<Self, DexError> {
        if data.len() != 165 {
            return Err(DexError::DeserializationFailed(format!(
                "SPL Token account: Expected 165 bytes, got {} bytes",
                data.len()
            )));
        }
        
        Self::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "SPL Token account: Borsh deserialization failed: {}",
                e
            )))
    }
    
    /// Get the token amount as a human-readable value
    pub fn get_amount_ui(&self, decimals: u8) -> f64 {
        self.amount as f64 / 10f64.powi(decimals as i32)
    }
    
    /// Check if account is initialized
    pub fn is_initialized(&self) -> bool {
        self.state == 1 || self.state == 2
    }
    
    /// Check if account is frozen
    pub fn is_frozen(&self) -> bool {
        self.state == 2
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_amount_ui() {
        let account = TokenAccount {
            mint: Pubkey::default(),
            owner: Pubkey::default(),
            amount: 1_000_000_000, // 1 SOL
            delegate: None,
            state: 1,
            is_native: None,
            delegated_amount: 0,
            close_authority: None,
        };
        
        assert_eq!(account.get_amount_ui(9), 1.0);
    }
    
    #[test]
    fn test_state_checks() {
        let account = TokenAccount {
            mint: Pubkey::default(),
            owner: Pubkey::default(),
            amount: 0,
            delegate: None,
            state: 1,
            is_native: None,
            delegated_amount: 0,
            close_authority: None,
        };
        
        assert!(account.is_initialized());
        assert!(!account.is_frozen());
    }
}



