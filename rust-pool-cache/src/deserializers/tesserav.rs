use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};

/// TesseraV Pool State
/// 
/// TesseraV is a DEX on Solana
/// 
/// Program ID: TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH
/// Data size: 1264 bytes (实际测量)
/// 
/// Structure (基于真实链上数据逆向工程):
/// - 没有Anchor discriminator（前8字节全零）
/// - 动态解析储备量，不使用Borsh
#[derive(Debug, Clone)]
pub struct TesseraVPoolState {
    /// Raw account data
    pub data: Vec<u8>,
    
    /// Token A mint (从数据中提取)
    pub token_a_mint: Option<Pubkey>,
    
    /// Token B mint (从数据中提取)
    pub token_b_mint: Option<Pubkey>,
    
    /// Token A reserve amount (从offset 104提取)
    pub reserve_a: u64,
    
    /// Token B reserve amount (从offset 112提取)
    pub reserve_b: u64,
}

#[allow(dead_code)]
impl TesseraVPoolState {
    /// Parse from raw account data
    /// 
    /// TesseraV data structure (1264 bytes):
    /// - Offset 0-15: Header (全零，无discriminator)
    /// - Offset 16-23: 某种配置数据
    /// - Offset 24-55: Token A mint (32 bytes)
    /// - Offset 56-87: Token B mint (32 bytes)  
    /// - Offset 104: Token A reserve amount (u64)
    /// - Offset 112: Token B reserve amount (u64)
    /// - 其余: 各种配置和状态数据
    pub fn from_bytes(data: &[u8]) -> Result<Self, std::io::Error> {
        // 验证数据大小（精确匹配1264字节）
        if data.len() != 1264 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("TesseraV pool data should be exactly 1264 bytes, got {}", data.len()),
            ));
        }
        
        // 提取Token A mint (offset 24)
        let token_a_mint = if data.len() >= 56 {
            Some(Pubkey::new_from_array(
                data[24..56].try_into().unwrap()
            ))
        } else {
            None
        };
        
        // 提取Token B mint (offset 56)
        let token_b_mint = if data.len() >= 88 {
            Some(Pubkey::new_from_array(
                data[56..88].try_into().unwrap()
            ))
        } else {
            None
        };
        
        // 提取储备量 A (offset 104)
        let reserve_a = if data.len() >= 112 {
            u64::from_le_bytes(data[104..112].try_into().unwrap())
        } else {
            0
        };
        
        // 提取储备量 B (offset 112)  
        let reserve_b = if data.len() >= 120 {
            u64::from_le_bytes(data[112..120].try_into().unwrap())
        } else {
            0
        };
        
        Ok(TesseraVPoolState {
            data: data.to_vec(),
            token_a_mint,
            token_b_mint,
            reserve_a,
            reserve_b,
        })
    }
    
    /// Calculate price (token B per token A)
    pub fn calculate_price(&self) -> f64 {
        if self.reserve_a == 0 {
            return 0.0;
        }
        
        // USDC/SOL 池子，需要调整decimals
        // reserve_a 是 SOL (9 decimals)
        // reserve_b 是 USDC (6 decimals)
        let reserve_a_f64 = self.reserve_a as f64 / 1e9; // SOL
        let reserve_b_f64 = self.reserve_b as f64 / 1e6; // USDC
        
        if reserve_a_f64 == 0.0 {
            return 0.0;
        }
        
        reserve_b_f64 / reserve_a_f64 // USDC per SOL
    }
    
    /// Get human-readable reserve amounts
    pub fn get_reserves_formatted(&self, decimals_a: i32, decimals_b: i32) -> (f64, f64) {
        let reserve_a = self.reserve_a as f64 / 10_f64.powi(decimals_a);
        let reserve_b = self.reserve_b as f64 / 10_f64.powi(decimals_b);
        (reserve_a, reserve_b)
    }
    
    /// Get pool information for debugging
    pub fn get_pool_info(&self) -> String {
        let (reserve_a, reserve_b) = self.get_reserves_formatted(9, 6);
        format!(
            "TesseraV Pool:\n  Reserve A: {:.2} SOL\n  Reserve B: {:.2} USDC\n  Price: {:.2} USDC/SOL",
            reserve_a,
            reserve_b,
            self.calculate_price()
        )
    }
}

// ============================================
// DexPool Trait Implementation
// ============================================

impl DexPool for TesseraVPoolState {
    fn dex_name(&self) -> &'static str {
        "TesseraV"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        Self::from_bytes(data)
            .map_err(|e| DexError::DeserializationFailed(format!("TesseraV: {}", e)))
    }
    
    fn calculate_price(&self) -> f64 {
        TesseraVPoolState::calculate_price(self)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        (self.reserve_a, self.reserve_b)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        // TesseraV USDC/SOL池子
        // SOL = 9 decimals, USDC = 6 decimals
        (9, 6)
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if it has reserves
        self.reserve_a > 0 || self.reserve_b > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        let (res_a, res_b) = self.get_reserves_formatted(9, 6);
        Some(format!(
            "Reserves: A={:.2} SOL, B={:.2} USDC, Price: {:.2}",
            res_a,
            res_b,
            self.calculate_price()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_data_size() {
        // TesseraV池子固定1264字节
        let data = vec![0u8; 1264];
        let result = TesseraVPoolState::from_bytes(&data);
        assert!(result.is_ok(), "Should parse 1264 byte data");
        
        // 错误的大小应该失败
        let wrong_size = vec![0u8; 1000];
        let result = TesseraVPoolState::from_bytes(&wrong_size);
        assert!(result.is_err(), "Should reject wrong size");
    }
    
    #[test]
    fn test_price_calculation() {
        // 模拟真实数据：100 SOL, 价格 $150
        let mut data = vec![0u8; 1264];
        
        // 在offset 104写入reserve_a (100 SOL = 100 * 1e9 lamports)
        let reserve_a: u64 = 100_000_000_000;
        data[104..112].copy_from_slice(&reserve_a.to_le_bytes());
        
        // 在offset 112写入reserve_b (15000 USDC = 15000 * 1e6 microUSDC)
        let reserve_b: u64 = 15_000_000_000;
        data[112..120].copy_from_slice(&reserve_b.to_le_bytes());
        
        let pool = TesseraVPoolState::from_bytes(&data).unwrap();
        
        assert_eq!(pool.reserve_a, 100_000_000_000);
        assert_eq!(pool.reserve_b, 15_000_000_000);
        
        let price = pool.calculate_price();
        // 价格应该是 150 USDC/SOL
        assert!((price - 150.0).abs() < 0.01, "Price should be around $150");
    }
    
    #[test]
    fn test_is_active() {
        let mut data = vec![0u8; 1264];
        
        // 池子有储备
        let reserve_a: u64 = 1_000_000_000;
        data[104..112].copy_from_slice(&reserve_a.to_le_bytes());
        
        let pool = TesseraVPoolState::from_bytes(&data).unwrap();
        assert!(pool.is_active(), "Pool with reserves should be active");
    }
}



