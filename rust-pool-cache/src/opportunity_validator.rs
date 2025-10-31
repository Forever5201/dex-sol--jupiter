/*!
 * 套利机会验证器
 * 
 * 不依赖链上模拟的轻量级验证，通过数据质量检查提升准确性
 * 
 * 验证维度：
 * 1. 数据新鲜度 - 路径上所有池子的数据必须足够新
 * 2. Slot一致性 - 路径上所有池子的slot必须接近
 * 3. 价格稳定性 - 池子价格不能剧烈波动
 * 4. 流动性充足性 - 储备量必须足够执行交易
 */

use std::sync::Arc;
use std::time::Instant;
use crate::price_cache::PriceCache;
use crate::arbitrage::ArbitrageOpportunity;

/// 验证结果
#[derive(Debug, Clone)]
pub enum ValidationResult {
    /// 通过验证，可以执行
    Valid {
        confidence_score: f64,  // 0-100，置信度评分
        data_quality: DataQuality,
    },
    /// 数据过期
    Stale {
        oldest_pool: String,
        age_ms: u64,
    },
    /// Slot不对齐
    SlotMismatch {
        slot_spread: u64,
        pools_count: usize,
    },
    /// 流动性不足
    InsufficientLiquidity {
        pool_id: String,
        required: f64,
        available: f64,
    },
    /// 价格已变化
    PriceChanged {
        pool_id: String,
        expected: f64,
        current: f64,
        deviation_pct: f64,
    },
    /// 池子不存在于缓存
    PoolNotFound {
        pool_id: String,
    },
}

/// 数据质量详情
#[derive(Debug, Clone)]
pub struct DataQuality {
    pub average_age_ms: u64,
    pub max_age_ms: u64,
    pub slot_spread: u64,
    pub freshness_score: f64,   // 0-100
    pub alignment_score: f64,   // 0-100
}

/// 验证器配置
#[derive(Debug, Clone)]
pub struct ValidatorConfig {
    /// 最大数据年龄（毫秒）
    pub max_age_ms: u64,
    /// 最大slot差异
    pub max_slot_spread: u64,
    /// 最大价格偏差（百分比）
    pub max_price_deviation_pct: f64,
    /// 最小流动性倍数（相对于交易金额）
    pub min_liquidity_multiplier: f64,
}

impl Default for ValidatorConfig {
    fn default() -> Self {
        Self {
            max_age_ms: 2000,           // 2秒
            max_slot_spread: 5,         // 5个slot (约2秒)
            max_price_deviation_pct: 5.0,  // 5%价格变化
            min_liquidity_multiplier: 10.0,  // 储备量至少是交易额的10倍
        }
    }
}

/// 套利机会验证器
pub struct OpportunityValidator {
    price_cache: Arc<PriceCache>,
    config: ValidatorConfig,
}

impl OpportunityValidator {
    /// 创建新的验证器
    pub fn new(price_cache: Arc<PriceCache>, config: ValidatorConfig) -> Self {
        Self {
            price_cache,
            config,
        }
    }
    
    /// 使用默认配置创建验证器
    pub fn with_defaults(price_cache: Arc<PriceCache>) -> Self {
        Self::new(price_cache, ValidatorConfig::default())
    }
    
    /// 验证套利机会
    /// 
    /// # Arguments
    /// * `opportunity` - 待验证的套利机会
    /// * `amount` - 计划交易金额（USDC）
    /// 
    /// # Returns
    /// 验证结果
    pub fn validate(&self, opportunity: &ArbitrageOpportunity, amount: f64) -> ValidationResult {
        // 获取路径涉及的所有池子的当前状态
        let pool_a = self.price_cache.get_price(&opportunity.pool_a_id);
        let pool_b = self.price_cache.get_price(&opportunity.pool_b_id);
        
        // 检查池子是否存在
        let pool_a = match pool_a {
            Some(p) => p,
            None => return ValidationResult::PoolNotFound {
                pool_id: opportunity.pool_a_id.clone(),
            },
        };
        
        let pool_b = match pool_b {
            Some(p) => p,
            None => return ValidationResult::PoolNotFound {
                pool_id: opportunity.pool_b_id.clone(),
            },
        };
        
        // 1. 检查数据新鲜度
        let now = Instant::now();
        let age_a = now.duration_since(pool_a.last_update).as_millis() as u64;
        let age_b = now.duration_since(pool_b.last_update).as_millis() as u64;
        let max_age = age_a.max(age_b);
        
        if max_age > self.config.max_age_ms {
            return ValidationResult::Stale {
                oldest_pool: if age_a > age_b {
                    opportunity.pool_a_id.clone()
                } else {
                    opportunity.pool_b_id.clone()
                },
                age_ms: max_age,
            };
        }
        
        // 2. 检查Slot一致性
        let slot_spread = pool_a.slot.abs_diff(pool_b.slot);
        if slot_spread > self.config.max_slot_spread {
            return ValidationResult::SlotMismatch {
                slot_spread,
                pools_count: 2,
            };
        }
        
        // 3. 检查价格变化（如果机会记录了预期价格）
        let price_deviation_a = ((pool_a.price - opportunity.pool_a_price).abs() / opportunity.pool_a_price) * 100.0;
        let price_deviation_b = ((pool_b.price - opportunity.pool_b_price).abs() / opportunity.pool_b_price) * 100.0;
        
        if price_deviation_a > self.config.max_price_deviation_pct {
            return ValidationResult::PriceChanged {
                pool_id: opportunity.pool_a_id.clone(),
                expected: opportunity.pool_a_price,
                current: pool_a.price,
                deviation_pct: price_deviation_a,
            };
        }
        
        if price_deviation_b > self.config.max_price_deviation_pct {
            return ValidationResult::PriceChanged {
                pool_id: opportunity.pool_b_id.clone(),
                expected: opportunity.pool_b_price,
                current: pool_b.price,
                deviation_pct: price_deviation_b,
            };
        }
        
        // 4. 检查流动性充足性
        let required_liquidity = amount * self.config.min_liquidity_multiplier;
        
        // 检查池子A的流动性（使用较小的储备量）
        let pool_a_liquidity = pool_a.base_reserve.min(pool_a.quote_reserve) as f64 
            / 10f64.powi(pool_a.base_decimals as i32);
        
        if pool_a_liquidity < required_liquidity {
            return ValidationResult::InsufficientLiquidity {
                pool_id: opportunity.pool_a_id.clone(),
                required: required_liquidity,
                available: pool_a_liquidity,
            };
        }
        
        let pool_b_liquidity = pool_b.base_reserve.min(pool_b.quote_reserve) as f64 
            / 10f64.powi(pool_b.base_decimals as i32);
        
        if pool_b_liquidity < required_liquidity {
            return ValidationResult::InsufficientLiquidity {
                pool_id: opportunity.pool_b_id.clone(),
                required: required_liquidity,
                available: pool_b_liquidity,
            };
        }
        
        // 计算数据质量指标
        let avg_age = (age_a + age_b) / 2;
        
        // 新鲜度评分：0ms=100, max_age_ms=0
        let freshness_score = 100.0 * (1.0 - (max_age as f64 / self.config.max_age_ms as f64));
        
        // 对齐度评分：0 spread=100, max_spread=0
        let alignment_score = 100.0 * (1.0 - (slot_spread as f64 / self.config.max_slot_spread as f64));
        
        // 综合置信度：两个评分的平均值
        let confidence_score = (freshness_score + alignment_score) / 2.0;
        
        ValidationResult::Valid {
            confidence_score,
            data_quality: DataQuality {
                average_age_ms: avg_age,
                max_age_ms: max_age,
                slot_spread,
                freshness_score,
                alignment_score,
            },
        }
    }
    
    /// 批量验证多个机会
    /// 
    /// # Returns
    /// (有效机会, 无效机会, 统计信息)
    pub fn validate_batch(
        &self,
        opportunities: Vec<ArbitrageOpportunity>,
        amount: f64,
    ) -> (Vec<(ArbitrageOpportunity, f64)>, Vec<(ArbitrageOpportunity, ValidationResult)>, ValidationStats) {
        let mut valid = Vec::new();
        let mut invalid = Vec::new();
        let mut stats = ValidationStats::default();
        
        for opp in opportunities {
            let result = self.validate(&opp, amount);
            stats.total += 1;
            
            match result {
                ValidationResult::Valid { confidence_score, .. } => {
                    stats.valid += 1;
                    stats.total_confidence += confidence_score;
                    valid.push((opp, confidence_score));
                }
                ValidationResult::Stale { .. } => {
                    stats.stale += 1;
                    invalid.push((opp, result));
                }
                ValidationResult::SlotMismatch { .. } => {
                    stats.slot_mismatch += 1;
                    invalid.push((opp, result));
                }
                ValidationResult::InsufficientLiquidity { .. } => {
                    stats.insufficient_liquidity += 1;
                    invalid.push((opp, result));
                }
                ValidationResult::PriceChanged { .. } => {
                    stats.price_changed += 1;
                    invalid.push((opp, result));
                }
                ValidationResult::PoolNotFound { .. } => {
                    stats.pool_not_found += 1;
                    invalid.push((opp, result));
                }
            }
        }
        
        // 按置信度排序（高到低）
        valid.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        (valid, invalid, stats)
    }
}

/// 验证统计
#[derive(Debug, Default, Clone)]
pub struct ValidationStats {
    pub total: usize,
    pub valid: usize,
    pub stale: usize,
    pub slot_mismatch: usize,
    pub insufficient_liquidity: usize,
    pub price_changed: usize,
    pub pool_not_found: usize,
    pub total_confidence: f64,
}

impl ValidationStats {
    /// 获取平均置信度
    pub fn average_confidence(&self) -> f64 {
        if self.valid > 0 {
            self.total_confidence / self.valid as f64
        } else {
            0.0
        }
    }
    
    /// 获取通过率
    pub fn pass_rate(&self) -> f64 {
        if self.total > 0 {
            (self.valid as f64 / self.total as f64) * 100.0
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_validator_config() {
        let config = ValidatorConfig::default();
        assert_eq!(config.max_age_ms, 2000);
        assert_eq!(config.max_slot_spread, 5);
    }
}

