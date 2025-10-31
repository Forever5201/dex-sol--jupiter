use crate::dex_interface::{DexError, DexPool};
use crate::deserializers::{
    LifinityV2PoolState, MeteoraPoolState, MeteoraPoolStateImproved, RaydiumAmmInfo, RaydiumClmmPoolState, 
    AlphaQPoolState, SolFiV2PoolState, HumidiFiPoolState, GoonFiPoolState,
    TesseraVPoolState, StabblePoolState, AquiferPoolState, WhirlpoolState,
    PancakeSwapPoolState, PhoenixMarketState, PhoenixMarketSDK, PhoenixMarketFull, OpenBookMarketState
};

/// Factory for creating DEX pool instances
/// 
/// This factory enables dynamic creation of pool instances based on pool type,
/// centralizing the type-to-implementation mapping in one place.
pub struct PoolFactory;

impl PoolFactory {
    /// Create a pool instance from account data
    /// 
    /// # Arguments
    /// * `pool_type` - The pool type identifier (e.g., "amm_v4", "clmm")
    /// * `data` - Raw account data bytes
    /// 
    /// # Returns
    /// A boxed trait object implementing DexPool
    /// 
    /// # Example
    /// ```
    /// let pool = PoolFactory::create_pool("amm_v4", account_data)?;
    /// let price = pool.calculate_price();
    /// ```
    pub fn create_pool(pool_type: &str, data: &[u8]) -> Result<Box<dyn DexPool>, DexError> {
        match pool_type.to_lowercase().as_str() {
            // Raydium AMM V4
            "amm_v4" | "ammv4" | "raydium_v4" | "raydiumv4" => {
                Ok(Box::new(RaydiumAmmInfo::from_account_data(data)?))
            }
            
            // Raydium CLMM
            "clmm" | "raydium_clmm" | "raydiumclmm" => {
                Ok(Box::new(RaydiumClmmPoolState::from_account_data(data)?))
            }
            
            // Lifinity V2
            "lifinity_v2" | "lifinityv2" | "lifinity" => {
                Ok(Box::new(LifinityV2PoolState::from_account_data(data)?))
            }
            
            // Meteora DLMM (使用改进的结构)
            "meteora_dlmm" | "meteora" | "dlmm" => {
                // 尝试新的改进结构（896字节精确匹配）
                match MeteoraPoolStateImproved::from_account_data(data) {
                    Ok(pool) => Ok(Box::new(pool)),
                    Err(e) => {
                        // 如果新结构失败，尝试原来的结构作为降级
                        eprintln!("⚠️  Meteora Improved failed, trying legacy: {}", e);
                        Ok(Box::new(MeteoraPoolState::from_account_data(data)?))
                    }
                }
            }
            
            // AlphaQ
            "alphaq" | "alpha_q" | "alphaQ" => {
                Ok(Box::new(AlphaQPoolState::from_account_data(data)?))
            }
            
            // SolFi V2
            "solfi_v2" | "solfiv2" | "solfi" => {
                Ok(Box::new(SolFiV2PoolState::from_account_data(data)?))
            }
            
            // HumidiFi
            "humidifi" | "humidi_fi" | "humid" => {
                Ok(Box::new(HumidiFiPoolState::from_account_data(data)?))
            }
            
            // GoonFi
            "goonfi" | "goon_fi" | "goon" => {
                Ok(Box::new(GoonFiPoolState::from_account_data(data)?))
            }
            
            // TesseraV
            "tesserav" | "tessera_v" | "tessera" => {
                Ok(Box::new(TesseraVPoolState::from_account_data(data)?))
            }
            
            // Stabble Stable Swap
            "stabble" | "stabble_swap" | "stabbleswap" => {
                Ok(Box::new(StabblePoolState::from_account_data(data)?))
            }
            
            // Aquifer
            "aquifer" | "aqui_fer" | "aqui" => {
                Ok(Box::new(AquiferPoolState::from_account_data(data)?))
            }
            
            // Orca Whirlpool (CLMM)
            "whirlpool" | "orca_whirlpool" | "orcawhirlpool" | "orca" => {
                Ok(Box::new(WhirlpoolState::from_account_data(data)?))
            }
            
            // PancakeSwap
            "pancakeswap" | "pancake_swap" | "pancake" | "pcs" => {
                Ok(Box::new(PancakeSwapPoolState::from_account_data(data)?))
            }
            
            // Phoenix (CLOB) - Full SDK version (推荐！完整OrderBook解析)
            "phoenix" | "phoenix_full" | "phoenix_sdk" => {
                Ok(Box::new(PhoenixMarketFull::from_account_data(data)?))
            }
            
            // Phoenix (CLOB) - Placeholder version (价格为0)
            "phoenix_placeholder" => {
                Ok(Box::new(PhoenixMarketSDK::from_account_data(data)?))
            }
            
            // Phoenix (CLOB) - Simple version (Header only)
            "phoenix_simple" | "phoenix_clob" | "phoenixclob" => {
                Ok(Box::new(PhoenixMarketState::from_account_data(data)?))
            }
            
            // OpenBook V2 (CLOB)
            "openbook_v2" | "openbookv2" | "openbook" | "obv2" => {
                Ok(Box::new(OpenBookMarketState::from_account_data(data)?))
            }
            
            // Unknown type
            _ => Err(DexError::UnknownPoolType(pool_type.to_string())),
        }
    }
    
    /// Create a pool with automatic type detection based on data length
    /// 
    /// This is useful when pool_type is "unknown" or when you want to
    /// auto-detect the pool type from the data.
    pub fn create_pool_auto_detect(data: &[u8]) -> Result<Box<dyn DexPool>, DexError> {
        let len = data.len();
        
        // Try to detect based on common data lengths
        if len >= 1500 && len <= 1600 {
            // Likely CLMM (around 1544 bytes)
            if let Ok(pool) = RaydiumClmmPoolState::from_account_data(data) {
                return Ok(Box::new(pool));
            }
        }
        
        // Try AMM V4 (around 752 bytes)
        if let Ok(pool) = RaydiumAmmInfo::from_account_data(data) {
            return Ok(Box::new(pool));
        }
        
        // Try CLMM as fallback
        if let Ok(pool) = RaydiumClmmPoolState::from_account_data(data) {
            return Ok(Box::new(pool));
        }
        
        // Try Lifinity V2
        if let Ok(pool) = LifinityV2PoolState::from_account_data(data) {
            return Ok(Box::new(pool));
        }
        
        Err(DexError::InvalidData(format!(
            "Unable to auto-detect pool type from {} bytes of data",
            len
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_pool_type_matching() {
        // Test case-insensitive matching
        let test_cases = vec![
            ("amm_v4", true),
            ("AMM_V4", true),
            ("clmm", true),
            ("CLMM", true),
            ("lifinity_v2", true),
            ("unknown_dex", false),
        ];
        
        for (pool_type, should_have_impl) in test_cases {
            // We can't test actual creation without data, but we can verify
            // that the match arms are correct by checking if unknown types fail
            let dummy_data = vec![0u8; 100];
            let result = PoolFactory::create_pool(pool_type, &dummy_data);
            
            if should_have_impl {
                // Should fail on deserialization, not unknown type
                match result {
                    Err(DexError::UnknownPoolType(_)) => {
                        panic!("Pool type {} should be recognized", pool_type);
                    }
                    _ => {} // Other errors are OK (like deserialization failure)
                }
            } else {
                // Should fail with unknown type
                assert!(matches!(result, Err(DexError::UnknownPoolType(_))));
            }
        }
    }
}



