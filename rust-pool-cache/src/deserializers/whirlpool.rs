use borsh::BorshDeserialize;
use solana_sdk::pubkey::Pubkey;
use crate::dex_interface::{DexPool, DexError};
use crate::mint_decimals_cache::get_global_mint_cache;

/// Orca Whirlpool Pool State (wrapper for official Orca SDK type)
/// 
/// Whirlpool is Orca's concentrated liquidity market maker (CLMM)
/// Similar to Uniswap V3 and Raydium CLMM
/// 
/// Program ID: whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc
/// Data size: 653 bytes (Borsh) / 656 bytes (memory with alignment)
/// 
/// We wrap the official `orca_whirlpools_client::Whirlpool` type
/// This ensures 100% compatibility with Orca's on-chain program
#[derive(Debug, Clone)]
pub struct WhirlpoolState {
    inner: orca_whirlpools_client::Whirlpool,
}

impl WhirlpoolState {
    /// Create from official Whirlpool type
    pub fn new(whirlpool: orca_whirlpools_client::Whirlpool) -> Self {
        Self { inner: whirlpool }
    }
    
    /// Get reference to inner Whirlpool
    pub fn inner(&self) -> &orca_whirlpools_client::Whirlpool {
        &self.inner
    }
    /// Calculate price from sqrt_price with token decimals adjustment
    ///
    /// **正确公式**: price = (sqrt_price / 2^64)² × (10^(base_decimals - quote_decimals))
    ///
    /// 其中：
    /// - sqrt_price: Q64.64 定点数格式
    /// - base_decimals: 基础代币的小数位数 (如 SOL=9)
    /// - quote_decimals: 报价代币的小数位数 (如 USDC=6)
    ///
    /// # Example
    /// ```
    /// // SOL/USDC 池子
    /// // base_decimals = 9 (SOL)
    /// // quote_decimals = 6 (USDC)
    /// // decimals_adjustment = 10^(9-6) = 1000
    /// // 如果 sqrt_price 计算得到 0.014，最终价格为 0.014 × 1000 = 14.0
    /// ```
    pub fn calculate_price_with_decimals(&self, base_decimals: u8, quote_decimals: u8) -> f64 {
        if self.inner.sqrt_price == 0 {
            return 0.0;
        }

        // 1. 计算 sqrt_price 部分: (sqrt_price / 2^64)^2
        const Q64: f64 = (1u128 << 64) as f64;
        let sqrt_price_f64 = self.inner.sqrt_price as f64 / Q64;
        let sqrt_price_squared = sqrt_price_f64 * sqrt_price_f64;

        // 2. 计算 decimals 调整因子: 10^(base_decimals - quote_decimals)
        //    当 base_decimals > quote_decimals 时，需要放大价格
        //    当 base_decimals < quote_decimals 时，需要缩小价格
        let decimal_diff = base_decimals as i32 - quote_decimals as i32;
        let decimals_factor = 10f64.powi(decimal_diff);

        // 3. 最终价格 = sqrt_price^2 × decimals_factor
        sqrt_price_squared * decimals_factor
    }

    /// 兼容旧接口的 calculate_price 方法（默认 decimals）
    ///
    /// 对于 Orca Whirlpool，默认假设：
    /// - base_token = SOL (9 decimals)
    /// - quote_token = USDC/USDT (6 decimals)
    pub fn calculate_price(&self) -> f64 {
        self.calculate_price_with_decimals(9, 6)
    }
}

// ============================================
// DexPool Trait Implementation (wrapper for official Orca type)
// ============================================

impl DexPool for WhirlpoolState {
    fn dex_name(&self) -> &'static str {
        "Whirlpool (Orca)"
    }
    
    fn from_account_data(data: &[u8]) -> Result<Self, DexError>
    where
        Self: Sized,
    {
        // Orca Whirlpool accounts are exactly 653 bytes
        if data.len() != 653 {
            return Err(DexError::InvalidData(format!(
                "Whirlpool pool data must be exactly 653 bytes, got {}",
                data.len()
            )));
        }
        
        // Use official Orca deserialization
        let whirlpool = orca_whirlpools_client::Whirlpool::try_from_slice(data)
            .map_err(|e| DexError::DeserializationFailed(format!(
                "Whirlpool Borsh deserialization failed: {}", 
                e
            )))?;
        
        Ok(WhirlpoolState::new(whirlpool))
    }
    
    fn calculate_price(&self) -> f64 {
        // ✅ 修复：使用正确的价格计算方法，包含 decimals 调整
        // 从 get_decimals() 获取池子的 token decimals
        let (base_decimals, quote_decimals) = self.get_decimals();
        self.calculate_price_with_decimals(base_decimals, quote_decimals)
    }
    
    fn get_reserves(&self) -> (u64, u64) {
        // CLMM doesn't have simple reserves like AMM
        // We can approximate using liquidity and tick
        // For now, return (0, 0) as reserves aren't directly stored
        (0, 0)
    }
    
    fn get_decimals(&self) -> (u8, u8) {
        if let Some(cache) = get_global_mint_cache() {
            let base = cache
                .get_or_fetch_decimals(&self.inner.token_mint_a)
                .unwrap_or(9);
            let quote = cache
                .get_or_fetch_decimals(&self.inner.token_mint_b)
                .unwrap_or(6);
            (base, quote)
        } else {
            (9, 6)
        }
    }
    
    fn is_active(&self) -> bool {
        // Pool is active if it has liquidity
        self.inner.liquidity > 0
    }
    
    fn get_additional_info(&self) -> Option<String> {
        Some(format!(
            "Liquidity: {:.2}, Tick: {}, Fee: {}bps",
            self.inner.liquidity as f64,
            self.inner.tick_current_index,
            self.inner.fee_rate
        ))
    }
    
    fn get_vault_addresses(&self) -> Option<(Pubkey, Pubkey)> {
        Some((self.inner.token_vault_a, self.inner.token_vault_b))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    
    #[test]
    fn test_price_calculation() {
        // Test with real data from chain
        let file_path = "account_data/SOL-USDC-Whirlpool_653.bin";

        if let Ok(data) = fs::read(file_path) {
            if let Ok(pool) = WhirlpoolState::from_account_data(&data) {
                // ✅ 测试默认 decimals (9,6)
                let price_default = pool.calculate_price();
                println!("Whirlpool price (default 9,6): {:.6}", price_default);

                // ✅ 测试自定义 decimals
                let price_custom = pool.calculate_price_with_decimals(9, 6);
                println!("Whirlpool price (custom 9,6): {:.6}", price_custom);

                assert_eq!(price_default, price_custom, "默认和自定义计算应该相同");

                // ✅ 测试 decimals 调整因子是否正确
                // 对于 SOL/USDC (9,6)，decimals_factor = 10^(9-6) = 1000
                // 如果 sqrt_price 计算得到 ~0.014，最终价格应为 ~0.014 × 1000 = 14.0
                // 所以价格应该在合理范围内 (0.1 to 500)
                assert!(price_default > 0.1 && price_default < 500.0,
                        "SOL/USDC 价格应该在 0.1-500 范围内，实际: {:.6}", price_default);

                // ✅ 测试不同 decimals 组合
                // 如果颠倒 decimals，价格应该相差 1000 倍
                let price_swapped = pool.calculate_price_with_decimals(6, 9);
                let expected_ratio = 0.001; // 10^(6-9) = 0.001
                let actual_ratio = price_swapped / price_default;
                assert!((actual_ratio - expected_ratio).abs() < 0.001,
                        "decimals 颠倒后价格比例应为 0.001 (10^(6-9))");

                assert!(pool.inner.liquidity > 0, "Pool should have liquidity");

                println!("📊 Liquidity: {}", pool.inner.liquidity);
                println!("📊 Tick: {}", pool.inner.tick_current_index);
                println!("📊 Fee: {} bps", pool.inner.fee_rate);
                println!("📊 Sqrt Price: {}", pool.inner.sqrt_price);
                println!("✅ Price calculation test passed!");
            }
        }
    }
}



