use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// PancakeSwap Pool State (Solana)
/// 
/// PancakeSwap is a cross-chain DEX that expanded from BSC to Solana
/// 
/// Program ID: HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq
/// Data size: 1544 bytes (实际测量，可能是CLMM版本)
/// 
/// Structure (基于真实链上数据):
/// - Discriminator: 0xf7ede3f5d7c3de46
/// - 大型数据结构，包含额外的配置和状态
#[derive(Debug, Clone)]
pub struct PancakeSwapPoolState {
    /// Raw account data
    pub data: Vec<u8>,
    
    /// Discriminator (offset 0-7)
    pub discriminator: [u8; 8],
    
    /// Token A mint (从数据提取)
    pub token_a_mint: Option<Pubkey>,
    
    /// Token B mint (从数据提取)
    pub token_b_mint: Option<Pubkey>,
    
    /// Reserve A amount (offset 256)
    pub reserve_a: u64,
    
    /// Reserve B amount (offset 280)
    pub reserve_b: u64,
    
    /// LP supply (推测)
    pub lp_supply: u64,
}

#[allow(dead_code)]
impl PancakeSwapPoolState {
    /// Parse from raw account data
    /// 
    /// PancakeSwap data structure (1544 bytes):
    /// - Offset 0-7: Discriminator 0xf7ede3f5d7c3de46
    /// - Offset 256: Reserve A (u64)
    /// - Offset 280: Reserve B (u64)
    /// - 包含大量配置和CLMM相关数据
    pub fn from_bytes(data: &[u8]) -> Result<Self, std::io::Error> {
        if data.len() != 1544 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("PancakeSwap pool data should be exactly 1544 bytes, got {}", data.len()),
            ));
        }
        
        // 提取discriminator
        let discriminator: [u8; 8] = data[0..8].try_into().unwrap();
        
        // 提取Token A mint (offset 40-72，推测)
        let token_a_mint = if data.len() >= 72 {
            Some(Pubkey::new_from_array(
                data[40..72].try_into().unwrap()
            ))
        } else {
            None
        };
        
        // 提取Token B mint (offset 72-104，推测)
        let token_b_mint = if data.len() >= 104 {
            Some(Pubkey::new_from_array(
                data[72..104].try_into().unwrap()
            ))
        } else {
            None
        };
        
        // 提取Reserve A (offset 256)
        let reserve_a = if data.len() >= 264 {
            u64::from_le_bytes(data[256..264].try_into().unwrap())
        } else {
            0
        };
        
        // 提取Reserve B (offset 280)
        let reserve_b = if data.len() >= 288 {
            u64::from_le_bytes(data[280..288].try_into().unwrap())
        } else {
            0
        };
        
        // 提取LP supply (offset 296，推测)
        let lp_supply = if data.len() >= 304 {
            u64::from_le_bytes(data[296..304].try_into().unwrap())
        } else {
            0
        };
        
        Ok(PancakeSwapPoolState {
            data: data.to_vec(),
            discriminator,
            token_a_mint,
            token_b_mint,
            reserve_a,
            reserve_b,
            lp_supply,
        })
    }
    
    /// Calculate price (token B per token A)
    pub fn calculate_price(&self) -> f64 {
        if self.reserve_a == 0 {
            return 0.0;
        }
        
        // USDC/USDT pair, both 6 decimals
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
    
    /// Get LP supply formatted
    pub fn get_lp_supply_formatted(&self) -> f64 {
        const DECIMALS: i32 = 6;
        self.lp_supply as f64 / 10_f64.powi(DECIMALS)
    }
    
    /// Get pool information for debugging
    pub fn get_pool_info(&self) -> String {
        let (reserve_a, reserve_b) = self.get_reserves_formatted();
        format!(
            "PancakeSwap Pool:\n  Reserve A: ${:.2}\n  Reserve B: ${:.2}\n  Price: {:.6}",
            reserve_a,
            reserve_b,
            self.calculate_price()
        )
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for PancakeSwapPoolState {
    fn dex_name(&self) -> &'static str {
        "PancakeSwap"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        Self::from_bytes(data)
            .map_err(|e| DexError::DeserializationFailed(format!("PancakeSwap: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        PancakeSwapPoolState::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        (self.reserve_a, self.reserve_b)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // PancakeSwap USDC/USDT 稳定币对
        // 都是 6 decimals
        (6, 6)
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if it has reserves
        self.reserve_a > 0 || self.reserve_b > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let (res_a, res_b) = self.get_reserves_formatted();
        Some(format!(
            "Reserves: ${:.0} / ${:.0}",
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
        // PancakeSwap池子固定1544字节
        let data = vec![0u8; 1544];
        let result = PancakeSwapPoolState::from_bytes(&data);
        assert!(result.is_ok(), "Should parse 1544 byte data");
        
        // 错误的大小应该失败
        let wrong_size = vec![0u8; 849];
        let result = PancakeSwapPoolState::from_bytes(&wrong_size);
        assert!(result.is_err(), "Should reject wrong size");
    }
    
    #[test]
    fn test_price_calculation() {
        let mut data = vec![0u8; 1544];
        
        // 在offset 256写入reserve_a (1M USDC = 1M * 1e6 microUSDC)
        let reserve_a: u64 = 1_000_000_000_000;
        data[256..264].copy_from_slice(&reserve_a.to_le_bytes());
        
        // 在offset 280写入reserve_b (1M USDT = 1M * 1e6 microUSDT)
        let reserve_b: u64 = 1_000_000_000_000;
        data[280..288].copy_from_slice(&reserve_b.to_le_bytes());
        
        let pool = PancakeSwapPoolState::from_bytes(&data).unwrap();
        
        assert_eq!(pool.reserve_a, 1_000_000_000_000);
        assert_eq!(pool.reserve_b, 1_000_000_000_000);
        
        let price = pool.calculate_price();
        // For 1:1 stablecoin pool, price should be ~1.0
        assert!((price - 1.0).abs() < 0.001, "Price should be close to 1.0");
    }
    
    #[test]
    fn test_is_active() {
        let mut data = vec![0u8; 1544];
        
        // 添加储备
        let reserve_a: u64 = 1_000_000_000;
        data[256..264].copy_from_slice(&reserve_a.to_le_bytes());
        
        let pool = PancakeSwapPoolState::from_bytes(&data).unwrap();
        assert!(pool.is_active(), "Pool with reserves should be active");
    }
}



