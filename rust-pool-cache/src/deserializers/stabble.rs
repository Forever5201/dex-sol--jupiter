use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// Stabble Stable Swap Pool State
/// 
/// Stabble is a stable swap DEX on Solana specializing in stablecoin pairs
/// Similar to Curve Finance on Ethereum
/// 
/// Program ID: swapNyd8XiQwJ6ianp9snpu4brUqFxadzvHebnAXjJZ
/// Data size: 438 bytes (实际测量，简化版本)
/// 
/// Structure (基于真实链上数据):
/// - Discriminator: 0xf19a6d0411b16dbc
/// - 紧凑的数据结构，只包含核心字段
#[derive(Debug, Clone)]
pub struct StabblePoolState {
    /// Raw account data
    pub data: Vec<u8>,
    
    /// Discriminator (offset 0-7)
    pub discriminator: [u8; 8],
    
    /// Token A mint (从数据提取)
    pub token_a_mint: Option<Pubkey>,
    
    /// Token B mint (从数据提取)
    pub token_b_mint: Option<Pubkey>,
    
    /// Reserve A amount (offset 104)
    pub reserve_a: u64,
    
    /// Reserve B amount (offset 168)
    pub reserve_b: u64,
    
    /// Amplification coefficient (offset 272)
    pub amplification_coefficient: u64,
}

#[allow(dead_code)]
impl StabblePoolState {
    /// Parse from raw account data
    /// 
    /// Stabble支持多版本:
    /// - V1: 338 bytes (简化版本)
    /// - V2: 438 bytes (完整版本)
    /// 
    /// 两者使用相同的discriminator: 0xf19a6d0411b16dbc
    pub fn from_bytes(data: &[u8]) -> Result<Self, std::io::Error> {
        // 支持两个版本
        if data.len() != 338 && data.len() != 438 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Stabble pool data should be 338 or 438 bytes, got {}", data.len()),
            ));
        }
        
        // 提取discriminator
        let discriminator: [u8; 8] = data[0..8].try_into().unwrap();
        
        // 提取Token A mint (offset 8-40，推测)
        let token_a_mint = if data.len() >= 40 {
            Some(Pubkey::new_from_array(
                data[8..40].try_into().unwrap()
            ))
        } else {
            None
        };
        
        // 提取Token B mint (offset 40-72，推测)
        let token_b_mint = if data.len() >= 72 {
            Some(Pubkey::new_from_array(
                data[40..72].try_into().unwrap()
            ))
        } else {
            None
        };
        
        // 提取Reserve A (offset 104)
        let reserve_a = if data.len() >= 112 {
            u64::from_le_bytes(data[104..112].try_into().unwrap())
        } else {
            0
        };
        
        // 提取Reserve B (offset 168)
        let reserve_b = if data.len() >= 176 {
            u64::from_le_bytes(data[168..176].try_into().unwrap())
        } else {
            0
        };
        
        // 提取Amplification coefficient (offset 272)
        let amplification_coefficient = if data.len() >= 280 {
            u64::from_le_bytes(data[272..280].try_into().unwrap())
        } else {
            1000 // Default A coefficient
        };
        
        Ok(StabblePoolState {
            data: data.to_vec(),
            discriminator,
            token_a_mint,
            token_b_mint,
            reserve_a,
            reserve_b,
            amplification_coefficient,
        })
    }
    
    /// Calculate price (token B per token A)
    /// For stable swap pools, price should be close to 1.0
    pub fn calculate_price(&self) -> f64 {
        if self.reserve_a == 0 {
            return 0.0;
        }
        
        // For stablecoin pairs, both have same decimals (6)
        let reserve_a_f64 = self.reserve_a as f64 / 1e6;
        let reserve_b_f64 = self.reserve_b as f64 / 1e6;
        
        if reserve_a_f64 == 0.0 {
            return 0.0;
        }
        
        reserve_b_f64 / reserve_a_f64
    }
    
    /// Get human-readable reserve amounts
    pub fn get_reserves_formatted(&self) -> (f64, f64) {
        const DECIMALS: i32 = 6;
        let reserve_a = self.reserve_a as f64 / 10_f64.powi(DECIMALS);
        let reserve_b = self.reserve_b as f64 / 10_f64.powi(DECIMALS);
        (reserve_a, reserve_b)
    }
    
    /// Get amplification coefficient (A parameter)
    pub fn get_amplification(&self) -> u64 {
        self.amplification_coefficient
    }
    
    /// Get pool information for debugging
    pub fn get_pool_info(&self) -> String {
        let (reserve_a, reserve_b) = self.get_reserves_formatted();
        format!(
            "Stabble Pool:\n  Reserve A: ${:.2}\n  Reserve B: ${:.2}\n  Price: {:.6}\n  Amp Coeff: {}",
            reserve_a,
            reserve_b,
            self.calculate_price(),
            self.get_amplification()
        )
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for StabblePoolState {
    fn dex_name(&self) -> &'static str {
        "Stabble"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        Self::from_bytes(data)
            .map_err(|e| DexError::DeserializationFailed(format!("Stabble: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        StabblePoolState::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        (self.reserve_a, self.reserve_b)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // Stabble handles stablecoin pairs (USD1/USDC)
        // Both have 6 decimals
        (6, 6)
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if it has reserves
        self.reserve_a > 0 || self.reserve_b > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let (res_a, res_b) = self.get_reserves_formatted();
        Some(format!(
            "Amp: {}, Reserves: ${:.0} / ${:.0}",
            self.get_amplification(),
            res_a,
            res_b
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_data_size() {
        // Stabble V1: 338字节
        let data_v1 = vec![0u8; 338];
        let result = StabblePoolState::from_bytes(&data_v1);
        assert!(result.is_ok(), "Should parse 338 byte data (V1)");
        
        // Stabble V2: 438字节
        let data_v2 = vec![0u8; 438];
        let result = StabblePoolState::from_bytes(&data_v2);
        assert!(result.is_ok(), "Should parse 438 byte data (V2)");
        
        // 错误的大小应该失败
        let wrong_size = vec![0u8; 664];
        let result = StabblePoolState::from_bytes(&wrong_size);
        assert!(result.is_err(), "Should reject wrong size");
    }
    
    #[test]
    fn test_stable_price() {
        let mut data = vec![0u8; 438];
        
        // 在offset 104写入reserve_a (1M USD1 = 1M * 1e6 microUSD1)
        let reserve_a: u64 = 1_000_000_000_000;
        data[104..112].copy_from_slice(&reserve_a.to_le_bytes());
        
        // 在offset 168写入reserve_b (1M USDC = 1M * 1e6 microUSDC)
        let reserve_b: u64 = 1_000_000_000_000;
        data[168..176].copy_from_slice(&reserve_b.to_le_bytes());
        
        // 在offset 272写入amplification coefficient
        let amp: u64 = 100;
        data[272..280].copy_from_slice(&amp.to_le_bytes());
        
        let pool = StabblePoolState::from_bytes(&data).unwrap();
        
        assert_eq!(pool.reserve_a, 1_000_000_000_000);
        assert_eq!(pool.reserve_b, 1_000_000_000_000);
        assert_eq!(pool.amplification_coefficient, 100);
        
        let price = pool.calculate_price();
        // For 1:1 stablecoin pool, price should be ~1.0
        assert!((price - 1.0).abs() < 0.001, "Stable swap price should be close to 1.0");
    }
    
    #[test]
    fn test_is_active() {
        let mut data = vec![0u8; 438];
        
        // 添加储备
        let reserve_a: u64 = 1_000_000_000;
        data[104..112].copy_from_slice(&reserve_a.to_le_bytes());
        
        let pool = StabblePoolState::from_bytes(&data).unwrap();
        assert!(pool.is_active(), "Pool with reserves should be active");
    }
}



