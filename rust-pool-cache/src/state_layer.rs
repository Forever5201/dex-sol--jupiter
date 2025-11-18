/// ================================================================
/// 通用状态层接口 (Generic State Layer Interface)
/// ================================================================
///
/// 这是一个抽象层，允许在 RwLock<HashMap> 和 DashMap 之间切换
/// 所有状态层实现都必须满足这个接口
///
/// 这是配置驱动架构的核心：状态层类型由配置文件决定
/// 而不是硬编码在业务逻辑中
///
/// ================================================================

use crate::price_cache::{PriceUpdateEvent, PoolPrice};
use anyhow::Result;
use tokio::sync::broadcast;

/// 通用状态层接口
///
/// 所有状态层实现都必须实现这个trait
pub trait StateLayer: Send + Sync {
    /// 更新池子价格
    ///
    /// # 参数
    /// * `pool_price` - 池子价格信息
    fn update_price(&self, pool_price: PoolPrice);

    /// 获取指定池子的价格
    ///
    /// # 参数
    /// * `pool_id` - 池子地址
    ///
    /// # 返回
    /// 如果找到，返回PoolPrice的克隆
    fn get_price(&self, pool_id: &str) -> Option<PoolPrice>;

    /// 获取指定交易对的所有池子
    ///
    /// # 参数
    /// * `pair` - 交易对，格式如 "SOL/USDC"
    ///
    /// # 返回
    /// 该交易对的所有池子价格列表
    fn get_pools_by_pair(&self, pair: &str) -> Vec<PoolPrice>;

    /// 订阅价格更新事件
    ///
    /// # 返回
    /// broadcast频道接收器，用于接收PriceUpdateEvent
    fn subscribe_updates(&self) -> broadcast::Receiver<PriceUpdateEvent>;

    /// 获取所有缓存的价格
    ///
    /// # 返回
    /// 所有池子价格的副本
    fn get_all_prices(&self) -> Vec<PoolPrice>;

    /// 获取新鲜数据 - 只返回在指定时间内更新的数据
    ///
    /// # 参数
    /// * `max_age_ms` - 最大数据年龄（毫秒）
    ///
    /// # 返回
    /// 新鲜的池子价格列表
    fn get_fresh_prices(&self, max_age_ms: u64) -> Vec<PoolPrice>;

    /// 获取slot对齐的一致性快照
    ///
    /// 只返回与最新slot时间差在阈值内的数据，确保所有数据来自相近的区块
    ///
    /// # 参数
    /// * `max_slot_spread` - 允许的最大slot差异
    ///
    /// # 返回
    /// Slot对齐的价格快照
    fn get_slot_aligned_snapshot(&self, max_slot_spread: u64) -> Vec<PoolPrice>;

    /// 组合方法：获取新鲜且slot对齐的数据 - 最强一致性保证
    ///
    /// # 参数
    /// * `max_age_ms` - 最大数据年龄（毫秒）
    /// * `max_slot_spread` - 允许的最大slot差异
    ///
    /// # 返回
    /// 同时满足时间新鲜度和slot一致性的数据
    fn get_consistent_snapshot(&self, max_age_ms: u64, max_slot_spread: u64) -> Vec<PoolPrice>;

    /// 获取当前最新的slot号
    ///
    /// # 返回
    /// 缓存中最大的slot号
    fn get_latest_slot(&self) -> u64;

    /// 判断池子价格是否过期
    ///
    /// # 参数
    /// * `pool_id` - 池子地址
    /// * `max_age_ms` - 最大允许年龄（毫秒）
    ///
    /// # 返回
    /// 如果价格不存在或超过最大年龄，返回true
    fn is_price_stale(&self, pool_id: &str, max_age_ms: u64) -> bool;

    /// 获取价格更新后的时间（毫秒）
    ///
    /// # 参数
    /// * `pool_id` - 池子地址
    ///
    /// # 返回
    /// 如果找到，返回上次更新后的毫秒数
    fn get_price_age_ms(&self, pool_id: &str) -> Option<u128>;

    /// 获取统计信息
    ///
    /// # 返回
    /// (池子总数, 可套利交易对列表)
    fn get_stats(&self) -> (usize, Vec<String>);
}
