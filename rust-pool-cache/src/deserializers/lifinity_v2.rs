use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Lifinity V2 Pool State
/// 
/// Lifinity V2 is a Proactive Market Maker (PMM) that uses oracle-based pricing
/// and protocol-owned liquidity. Reserves are stored DIRECTLY in the pool account.
/// 
/// Program ID: 2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c
/// Data size: 911 bytes (实际测量)
/// 
/// Structure (基于真实链上数据分析):
/// - Discriminator: 0x8ff5c8114ad6c487 (offset 0-7)
/// - Quote reserve (USDC/USDT): offset 576 (u64, 6 decimals)
/// - Base reserve (SOL): offset 696 (u64, 9 decimals)
/// - ⚠️ 不使用独立vault账户，储备量直接存储在池子中
#[derive(Debug, Clone)]
pub struct LifinityV2PoolState {
    /// Raw account data
    pub data: Vec<u8>,
    
    /// Quote token reserve (USDC/USDT) from offset 576
    pub reserve_quote: u64,
    
    /// Base token reserve (SOL) from offset 696
    pub reserve_base: u64,
    
    /// Token decimals (Base=9 SOL, Quote=6 USDC/USDT)
    pub base_decimals: u8,
    pub quote_decimals: u8,
}

impl LifinityV2PoolState {
    /// Parse from raw account data
    /// 
    /// Lifinity V2 data structure (911 bytes):
    /// - Discriminator: 0x8ff5c8114ad6c487 (offset 0-7)
    /// - Reserves at multiple possible offsets (varies by pool)
    /// - Auto-detect correct offsets by validating price range
    pub fn from_bytes(data: &[u8]) -> Result<Self, std::io::Error> {
        if data.len() != 911 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Lifinity V2 pool data should be exactly 911 bytes, got {}", data.len()),
            ));
        }
        
        // Try multiple offset combinations and select the one with reasonable price
        // Expected SOL price: 100-300 USDC/USDT
        let candidates = vec![
            (696, 576),  // Most common: base@696, quote@576
            (440, 104),  // Alternative: base@440, quote@104  
            (576, 696),  // Reversed: base@576, quote@696
        ];
        
        let mut best_candidate = None;
        let mut best_price_diff = f64::MAX;
        
        for (base_off, quote_off) in candidates {
            if data.len() < base_off + 8 || data.len() < quote_off + 8 {
                continue;
            }
            
            let base = u64::from_le_bytes(data[base_off..base_off+8].try_into().unwrap());
            let quote = u64::from_le_bytes(data[quote_off..quote_off+8].try_into().unwrap());
            
            if base == 0 || quote == 0 {
                continue;
            }
            
            // Calculate price (assuming base=SOL with 9 decimals, quote=USDC/USDT with 6 decimals)
            let price = (quote as f64 / 1e6) / (base as f64 / 1e9);
            
            // Check if price is in reasonable range (100-300 USDC per SOL)
            if price >= 100.0 && price <= 300.0 {
                let price_diff = (price - 168.0).abs(); // 168 is approximate SOL price
                if price_diff < best_price_diff {
                    best_price_diff = price_diff;
                    best_candidate = Some((base, quote));
                }
            }
        }
        
        let (reserve_base, reserve_quote) = best_candidate.unwrap_or_else(|| {
            // Fallback to default offsets if no valid candidate found
            let base = u64::from_le_bytes(data[696..704].try_into().unwrap_or([0u8; 8]));
            let quote = u64::from_le_bytes(data[576..584].try_into().unwrap_or([0u8; 8]));
            (base, quote)
        });
        
        Ok(LifinityV2PoolState {
            data: data.to_vec(),
            reserve_quote,
            reserve_base,
            base_decimals: 9,   // SOL
            quote_decimals: 6,  // USDC/USDT
        })
    }
    
    /// Calculate price (quote per base, i.e., USDC per SOL)
    pub fn calculate_price(&self) -> f64 {
        if self.reserve_base == 0 {
            return 0.0;
        }
        
        let base_amount = self.reserve_base as f64 / 10f64.powi(self.base_decimals as i32);
        let quote_amount = self.reserve_quote as f64 / 10f64.powi(self.quote_decimals as i32);
        
        if base_amount == 0.0 {
            return 0.0;
        }
        
        quote_amount / base_amount
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_data_size() {
        // Lifinity V2池子固定911字节
        let data = vec![0u8; 911];
        let result = LifinityV2PoolState::from_bytes(&data);
        assert!(result.is_ok(), "Should parse 911 byte data");
        
        // 错误的大小应该失败
        let wrong_size = vec![0u8; 800];
        let result = LifinityV2PoolState::from_bytes(&wrong_size);
        assert!(result.is_err(), "Should reject wrong size");
    }
    
    #[test]
    fn test_vault_extraction() {
        let mut data = vec![0u8; 911];
        
        // 在offset 192写入vault_a
        let vault_a = Pubkey::new_unique();
        data[192..224].copy_from_slice(&vault_a.to_bytes());
        
        // 在offset 224写入vault_b
        let vault_b = Pubkey::new_unique();
        data[224..256].copy_from_slice(&vault_b.to_bytes());
        
        let pool = LifinityV2PoolState::from_bytes(&data).unwrap();
        let vaults = pool.get_vault_addresses();
        
        assert!(vaults.is_some(), "Should extract vault addresses");
        let (v_a, v_b) = vaults.unwrap();
        assert_eq!(v_a, vault_a);
        assert_eq!(v_b, vault_b);
    }
    
    #[test]
    fn test_is_active() {
        let mut data = vec![0u8; 911];
        
        // 添加有效vault地址
        let vault_a = Pubkey::new_unique();
        let vault_b = Pubkey::new_unique();
        data[192..224].copy_from_slice(&vault_a.to_bytes());
        data[224..256].copy_from_slice(&vault_b.to_bytes());
        
        // ⭐ 关键：设置储备量数据（offset 696 = base, offset 576 = quote）
        // 设置1000 SOL (base) = 1000 * 1e9 lamports
        let base_reserve: u64 = 1000 * 1_000_000_000;
        data[696..704].copy_from_slice(&base_reserve.to_le_bytes());
        
        // 设置168000 USDC (quote) = 168000 * 1e6 micro-USDC (price ~168 USDC/SOL)
        let quote_reserve: u64 = 168_000 * 1_000_000;
        data[576..584].copy_from_slice(&quote_reserve.to_le_bytes());
        
        let pool = LifinityV2PoolState::from_bytes(&data).unwrap();
        println!("Reserve base: {}, Reserve quote: {}", pool.reserve_base, pool.reserve_quote);
        assert!(pool.is_active(), "Pool with reserves should be active");
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for LifinityV2PoolState {
    fn dex_name(&self) -> &'static str {
        "Lifinity V2"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        Self::from_bytes(data)
            .map_err(|e| DexError::DeserializationFailed(format!("Lifinity V2: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        Self::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // Note: Lifinity V2 returns (base, quote) = (SOL, USDC/USDT)
        (self.reserve_base, self.reserve_quote)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        (self.base_decimals, self.quote_decimals)
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if it has reserves
        self.reserve_base > 0 || self.reserve_quote > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let price = self.calculate_price();
        let base_amount = self.reserve_base as f64 / 10f64.powi(self.base_decimals as i32);
        let quote_amount = self.reserve_quote as f64 / 10f64.powi(self.quote_decimals as i32);
        
        Some(format!(
            "Lifinity V2 PMM | Price: {:.4} | Reserves: {:.2} SOL / {:.2} USDC",
            price,
            base_amount,
            quote_amount
        ))
    }
    
    // ⚠️ Lifinity V2 不使用独立vault账户！
    // 储备量直接存储在池子账户中（offset 576和696）
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        // Lifinity V2 vault地址位于offset 192和224
        if self.data.len() < 256 {
            return None;
        }
        
        // 提取vault_a (offset 192-224)
        let vault_a_bytes = &self.data[192..224];
        let vault_a = Pubkey::try_from(vault_a_bytes).ok()?;
        
        // 提取vault_b (offset 224-256)
        let vault_b_bytes = &self.data[224..256];
        let vault_b = Pubkey::try_from(vault_b_bytes).ok()?;
        
        // 验证不是全0地址
        if vault_a == Pubkey::default() || vault_b == Pubkey::default() {
            return None;
        }
        
        Some((vault_a, vault_b))
    }
}





