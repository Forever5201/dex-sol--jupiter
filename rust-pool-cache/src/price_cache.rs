use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use tokio::sync::broadcast;

/// Pool price information
#[derive(Clone, Debug)]
pub struct PoolPrice {
    pub pool_id: String,
    pub dex_name: String,
    pub pair: String,
    pub base_reserve: u64,
    pub quote_reserve: u64,
    #[allow(dead_code)]
    pub base_decimals: u8,
    #[allow(dead_code)]
    pub quote_decimals: u8,
    pub price: f64,
    pub last_update: Instant,
    pub slot: u64,  // 🎯 Solana区块slot，用于数据一致性
}

/// Price update event for event-driven arbitrage
#[derive(Clone, Debug)]
pub struct PriceUpdateEvent {
    pub pool_id: String,
    pub pair: String,
    pub old_price: Option<f64>,
    pub new_price: f64,
    pub price_change_percent: f64,
    pub timestamp: Instant,
}

#[allow(dead_code)]
impl PoolPrice {
    /// Calculate price from reserves
    #[allow(dead_code)]
    pub fn calculate_price(
        base_reserve: u64,
        quote_reserve: u64,
        base_decimals: u8,
        quote_decimals: u8,
    ) -> f64 {
        let base = base_reserve as f64 / 10f64.powi(base_decimals as i32);
        let quote = quote_reserve as f64 / 10f64.powi(quote_decimals as i32);
        
        if base == 0.0 {
            return 0.0;
        }
        
        quote / base
    }
}

/// Thread-safe price cache
pub struct PriceCache {
    prices: Arc<RwLock<HashMap<String, PoolPrice>>>,
    update_tx: broadcast::Sender<PriceUpdateEvent>,
}

impl PriceCache {
    pub fn new() -> Self {
        let (update_tx, _) = broadcast::channel(1000);
        Self {
            prices: Arc::new(RwLock::new(HashMap::new())),
            update_tx,
        }
    }
    
    /// Subscribe to price update events
    pub fn subscribe_updates(&self) -> broadcast::Receiver<PriceUpdateEvent> {
        self.update_tx.subscribe()
    }
    
    /// Update price for a pool
    pub fn update_price(&self, pool_price: PoolPrice) {
        let event = {
            let mut prices = self.prices.write().unwrap();
            let old_price = prices.get(&pool_price.pool_id).map(|p| p.price);
            let new_price = pool_price.price;
            
            let price_change_percent = if let Some(old) = old_price {
                let change = ((new_price - old) / old * 100.0).abs();
                // 🔥 优化判断逻辑：
                // - 如果价格完全相同（change=0），返回0不触发
                // - 如果变化极小（0 < change < 0.001），视为噪声，不触发（修复100%误报）
                if change == 0.0 {
                    0.0  // 完全相同的价格，不触发
                } else if change < 0.001 {
                    0.0  // 微小差异视为噪声，不触发（避免误报）
                } else {
                    change  // 正常变化，返回实际百分比
                }
            } else {
                100.0  // First update always triggers
            };
            
            prices.insert(pool_price.pool_id.clone(), pool_price.clone());
            
            PriceUpdateEvent {
                pool_id: pool_price.pool_id,
                pair: pool_price.pair,
                old_price,
                new_price,
                price_change_percent,
                timestamp: Instant::now(),
            }
        };
        
        // Send event (ignore if no receivers)
        let _ = self.update_tx.send(event);
    }
    
    /// Get price for a specific pool    
    #[allow(dead_code)]
    pub fn get_price(&self, pool_id: &str) -> Option<PoolPrice> {
        let prices = self.prices.read().unwrap();
        prices.get(pool_id).cloned()
    }
    
    /// Get all pools for a specific pair
    pub fn get_pools_by_pair(&self, pair: &str) -> Vec<PoolPrice> {
        let prices = self.prices.read().unwrap();
        prices
            .values()
            .filter(|p| p.pair == pair)
            .cloned()
            .collect()
    }
    
    /// Get all cached prices
    pub fn get_all_prices(&self) -> Vec<PoolPrice> {
        let prices = self.prices.read().unwrap();
        prices.values().cloned().collect()
    }
    
    /// Get statistics
    pub fn get_stats(&self) -> (usize, Vec<String>) {
        let prices = self.prices.read().unwrap();
        let pairs: Vec<String> = prices
            .values()
            .map(|p| p.pair.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        
        (prices.len(), pairs)
    }
    
    // ============================================
    // 🎯 数据一致性方法 (Data Consistency Methods)
    // ============================================
    
    /// 获取新鲜数据 - 只返回在指定时间内更新的数据
    /// 
    /// # Arguments
    /// * `max_age_ms` - 最大数据年龄（毫秒）
    /// 
    /// # Returns
    /// 新鲜的池子价格列表
    /// 
    /// # Example
    /// ```
    /// // 只获取500ms内更新的数据
    /// let fresh_prices = price_cache.get_fresh_prices(500);
    /// ```
    pub fn get_fresh_prices(&self, max_age_ms: u64) -> Vec<PoolPrice> {
        let prices = self.prices.read().unwrap();
        let now = Instant::now();
        
        prices.values()
            .filter(|p| {
                let age_ms = now.duration_since(p.last_update).as_millis() as u64;
                age_ms <= max_age_ms
            })
            .cloned()
            .collect()
    }
    
    /// 获取slot对齐的一致性快照 - Jupiter级别的数据一致性
    /// 
    /// 只返回与最新slot时间差在阈值内的数据，确保所有数据来自相近的区块
    /// 
    /// # Arguments
    /// * `max_slot_spread` - 允许的最大slot差异
    /// 
    /// # Returns
    /// Slot对齐的价格快照
    /// 
    /// # Example
    /// ```
    /// // 获取slot差异<5的一致性数据
    /// let snapshot = price_cache.get_slot_aligned_snapshot(5);
    /// ```
    pub fn get_slot_aligned_snapshot(&self, max_slot_spread: u64) -> Vec<PoolPrice> {
        let prices = self.prices.read().unwrap();
        
        // 找到最新的slot
        let latest_slot = prices.values()
            .map(|p| p.slot)
            .max()
            .unwrap_or(0);
        
        if latest_slot == 0 {
            return Vec::new();
        }
        
        // 只返回与最新slot差异 <= max_slot_spread 的数据
        prices.values()
            .filter(|p| {
                let slot_diff = latest_slot.saturating_sub(p.slot);
                slot_diff <= max_slot_spread
            })
            .cloned()
            .collect()
    }
    
    /// 组合方法：获取新鲜且slot对齐的数据 - 最强一致性保证
    /// 
    /// # Arguments
    /// * `max_age_ms` - 最大数据年龄（毫秒）
    /// * `max_slot_spread` - 允许的最大slot差异
    /// 
    /// # Returns
    /// 同时满足时间新鲜度和slot一致性的数据
    pub fn get_consistent_snapshot(&self, max_age_ms: u64, max_slot_spread: u64) -> Vec<PoolPrice> {
        let prices = self.prices.read().unwrap();
        let now = Instant::now();
        
        // 找到最新的slot
        let latest_slot = prices.values()
            .map(|p| p.slot)
            .max()
            .unwrap_or(0);
        
        if latest_slot == 0 {
            return Vec::new();
        }
        
        // 同时过滤时间和slot
        prices.values()
            .filter(|p| {
                // 检查数据新鲜度
                let age_ms = now.duration_since(p.last_update).as_millis() as u64;
                if age_ms > max_age_ms {
                    return false;
                }
                
                // 检查slot对齐
                let slot_diff = latest_slot.saturating_sub(p.slot);
                slot_diff <= max_slot_spread
            })
            .cloned()
            .collect()
    }
    
    /// 获取当前最新的slot号
    pub fn get_latest_slot(&self) -> u64 {
        let prices = self.prices.read().unwrap();
        prices.values()
            .map(|p| p.slot)
            .max()
            .unwrap_or(0)
    }
    
    /// 获取数据质量统计 - 用于监控和调试
    /// 
    /// # Returns
    /// (总池子数, 新鲜数据数, slot对齐数, 平均数据年龄ms, slot分布)
    pub fn get_data_quality_stats(&self) -> (usize, usize, usize, u64, HashMap<u64, usize>) {
        let prices = self.prices.read().unwrap();
        let now = Instant::now();
        let total = prices.len();
        
        // 统计新鲜数据（<2秒）
        let fresh_count = prices.values()
            .filter(|p| now.duration_since(p.last_update).as_secs() < 2)
            .count();
        
        // 找最新slot
        let latest_slot = prices.values()
            .map(|p| p.slot)
            .max()
            .unwrap_or(0);
        
        // 统计slot对齐数据（与最新slot差异<5）
        let aligned_count = prices.values()
            .filter(|p| latest_slot.saturating_sub(p.slot) < 5)
            .count();
        
        // 计算平均年龄
        let total_age: u128 = prices.values()
            .map(|p| now.duration_since(p.last_update).as_millis())
            .sum();
        let avg_age = if total > 0 { (total_age / total as u128) as u64 } else { 0 };
        
        // Slot分布
        let mut slot_distribution: HashMap<u64, usize> = HashMap::new();
        for p in prices.values() {
            *slot_distribution.entry(p.slot).or_insert(0) += 1;
        }
        
        (total, fresh_count, aligned_count, avg_age, slot_distribution)
    }
}

impl Clone for PriceCache {
    fn clone(&self) -> Self {
        Self {
            prices: Arc::clone(&self.prices),
            update_tx: self.update_tx.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_calculate_price() {
        // 100,000 SOL, 18,500,000 USDC
        let price = PoolPrice::calculate_price(
            100_000 * 1_000_000_000,
            18_500_000 * 1_000_000,
            9,
            6,
        );
        
        assert!((price - 185.0).abs() < 0.01);
    }
    
    #[test]
    fn test_price_cache() {
        let cache = PriceCache::new();
        
        let price = PoolPrice {
            pool_id: "raydium_sol_usdc".to_string(),
            dex_name: "Raydium".to_string(),
            pair: "SOL/USDC".to_string(),
            base_reserve: 100_000 * 1_000_000_000,
            quote_reserve: 18_500_000 * 1_000_000,
            base_decimals: 9,
            quote_decimals: 6,
            price: 185.0,
            last_update: Instant::now(),
            slot: 1000,
        };
        
        cache.update_price(price.clone());
        
        let retrieved = cache.get_price("raydium_sol_usdc");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().price, 185.0);
    }
    
    #[test]
    fn test_slot_aligned_snapshot() {
        let cache = PriceCache::new();
        let now = Instant::now();
        
        // 添加不同slot的数据
        cache.update_price(PoolPrice {
            pool_id: "pool1".to_string(),
            dex_name: "Raydium".to_string(),
            pair: "SOL/USDC".to_string(),
            base_reserve: 1000,
            quote_reserve: 1000,
            base_decimals: 6,
            quote_decimals: 6,
            price: 1.0,
            last_update: now,
            slot: 1000,  // 旧slot
        });
        
        cache.update_price(PoolPrice {
            pool_id: "pool2".to_string(),
            dex_name: "Orca".to_string(),
            pair: "SOL/USDT".to_string(),
            base_reserve: 1000,
            quote_reserve: 1000,
            base_decimals: 6,
            quote_decimals: 6,
            price: 1.0,
            last_update: now,
            slot: 1005,  // 最新slot
        });
        
        // 只返回slot差异<=3的数据，应该只有pool2
        let aligned = cache.get_slot_aligned_snapshot(3);
        assert_eq!(aligned.len(), 1);
        assert_eq!(aligned[0].pool_id, "pool2");
        
        // 放宽到5，两个都应该返回
        let aligned = cache.get_slot_aligned_snapshot(5);
        assert_eq!(aligned.len(), 2);
    }
}



