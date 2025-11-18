/// ========================================================================
/// 状态层工厂 (State Layer Factory)
/// ========================================================================
///
/// 工厂模式：根据配置创建合适的状态层实例
/// 核心思想：业务逻辑不关心具体实现，只依赖 StateLayer trait
///
/// 这是配置驱动架构的最后一块拼图，所有参数由配置文件决定
/// ========================================================================

use crate::dashmap_state::DashMapStateLayer;
use crate::price_cache::PriceCache;
use crate::state_layer::StateLayer;
use std::sync::Arc;

/// 状态层类型枚举
///
/// 定义了所有支持的状态层实现，由配置文件选择
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateLayerType {
    /// RwLock<HashMap> - 读写锁
    ///
    /// 适用场景：
    /// - 更新频率 < 100次/秒
    /// - 更新频率 < 500次/秒
    /// - 内存占用敏感（比DashMap少~15%）
    ///
    /// 性能特点：
    /// - 写操作串行化（全局锁）
    /// - 读操作可以并行
    /// - 实现简单，易于调试
    RwLock,

    /// 使用 DashMap 提供分片锁
    ///
    /// 适用场景：
    /// - 更新频率 > 100次/秒
    /// - 更新频率 > 500次/秒
    /// - CPU核心数 > 4（能发挥并行优势）
    ///
    /// 性能特点：
    /// - 写操作并行（不同key）
    /// - 读操作高度并行（无锁）
    /// - 内存占用稍高（分片开销）
    DashMap,
}

impl StateLayerType {
    /// 从字符串解析状态层类型
    ///
    /// # 参数
    /// * `s` - 类型字符串，可以是 "rwlock" 或 "dashmap"（大小写不敏感）
    ///
    /// # 返回
    /// 如果解析成功，返回 StateLayerType
    ///
    /// # 示例
    /// ```
    /// let state_type = StateLayerType::from_str("dashmap").unwrap();
    /// assert_eq!(state_type, StateLayerType::DashMap);
    /// ```
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "rwlock" => Some(StateLayerType::RwLock),
            "dashmap" => Some(StateLayerType::DashMap),
            _ => None,
        }
    }

    /// 获取状态层类型的描述
    pub fn description(&self) -> &'static str {
        match self {
            StateLayerType::RwLock => "RwLock<HashMap> - 读写锁，适合低频更新（<100次/秒）",
            StateLayerType::DashMap => "DashMap - 分片锁，适合高频更新（>100次/秒）",
        }
    }

    /// 获取推荐的使用场景
    pub fn recommendation(&self) -> &'static str {
        match self {
            StateLayerType::RwLock => {
                "推荐：开发环境、低频更新、内存敏感场景"
            }
            StateLayerType::DashMap => {
                "推荐：生产环境、高频更新（>100次/秒）、多核CPU"
            }
        }
    }
}

/// 状态层工厂
///
/// 创建状态层实例的统一入口，隐藏具体实现细节
pub struct StateLayerFactory;

impl StateLayerFactory {
    /// 根据配置创建状态层实例
    ///
    /// # 参数
    /// * `state_type` - 状态层类型
    ///
    /// # 返回
    /// Arc<dyn StateLayer> - 可以在多线程间共享的状态层实例
    ///
    /// # 示例
    /// ```
    /// use std::sync::Arc;
    /// use crate::state_layer_factory::{StateLayerFactory, StateLayerType};
    /// use crate::state_layer::StateLayer;
    ///
    /// let state_layer: Arc<dyn StateLayer> = StateLayerFactory::create(StateLayerType::DashMap);
    /// ```
    pub fn create(state_type: StateLayerType) -> Arc<dyn StateLayer> {
        match state_type {
            StateLayerType::RwLock => {
                println!("🔧 状态层: RwLock<HashMap> (读写锁模式)");
                println!("   └─ 适用场景: 更新频率 < 100次/秒");
                println!("   └─ 优势: 内存占用低，实现简单");
                let cache = PriceCache::new();
                Arc::new(cache)
            }
            StateLayerType::DashMap => {
                println!("🔧 状态层: DashMap (分片锁模式)");
                println!("   └─ 适用场景: 更新频率 > 100次/秒");
                println!("   └─ 优势: 并行更新，高吞吐量");
                let state_layer = DashMapStateLayer::new();
                Arc::new(state_layer)
            }
        }
    }

    /// 根据字符串配置创建状态层
    ///
    /// # 参数
    /// * `config_str` - 配置字符串，可以是 "rwlock" 或 "dashmap"
    ///
    /// # 返回
    /// 如果配置有效，返回 Ok(Arc<dyn StateLayer>)
    /// 如果配置无效，返回 Err(String)
    ///
    /// # 示例
    /// ```
    /// let result = StateLayerFactory::create_from_config("dashmap");
    /// assert!(result.is_ok());
    /// ```
    pub fn create_from_config(config_str: &str) -> Result<Arc<dyn StateLayer>, String> {
        match StateLayerType::from_str(config_str) {
            Some(state_type) => Ok(Self::create(state_type)),
            None => Err(format!(
                "无效的状态层配置: '{}'，请使用 'rwlock' 或 'dashmap'",
                config_str
            )),
        }
    }

    /// 自动选择最优的状态层类型
    ///
    /// 根据系统资源和预期负载自动选择合适的状态层
    ///
    /// # 参数
    /// * `expected_update_rate` - 预期的更新频率（次/秒）
    /// * `pool_count` - 池子数量
    ///
    /// # 返回
    /// 推荐的状态层类型
    ///
    /// # 算法逻辑
    /// - 更新频率 > 100次/秒：推荐使用 DashMap
    /// - 池子数量 > 50：推荐使用 DashMap
    /// - CPU 核心数 > 4：推荐使用 DashMap
    /// - 其他情况：使用 RwLock
    ///
    /// # 示例
    /// ```
    /// let state_type = StateLayerFactory::auto_select(200.0, 20);
    /// assert_eq!(state_type, StateLayerType::DashMap);
    /// ```
    pub fn auto_select(expected_update_rate: f64, pool_count: usize) -> StateLayerType {
        let cpu_cores = num_cpus::get();

        println!("🤖 自动选择状态层类型:");
        println!("   └─ 预期更新频率: {:.0}次/秒", expected_update_rate);
        println!("   └─ 池子数量: {}", pool_count);
        println!("   └─ CPU核心数: {}", cpu_cores);

        let recommended_type = if expected_update_rate > 100.0 {
            println!("   └─ ✅ 推荐使用: DashMap (高频更新)");
            StateLayerType::DashMap
        } else if pool_count > 50 {
            println!("   └─ ✅ 推荐使用: DashMap (大量池子)");
            StateLayerType::DashMap
        } else if cpu_cores > 4 {
            println!("   └─ ✅ 推荐使用: DashMap (多核并行)");
            StateLayerType::DashMap
        } else {
            println!("   └─ ✅ 推荐使用: RwLock (低频/单核)");
            StateLayerType::RwLock
        };

        recommended_type
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_layer_type_from_str() {
        assert_eq!(
            StateLayerType::from_str("rwlock"),
            Some(StateLayerType::RwLock)
        );
        assert_eq!(
            StateLayerType::from_str("RwLock"),
            Some(StateLayerType::RwLock)
        );
        assert_eq!(
            StateLayerType::from_str("RWLOCK"),
            Some(StateLayerType::RwLock)
        );

        assert_eq!(
            StateLayerType::from_str("dashmap"),
            Some(StateLayerType::DashMap)
        );
        assert_eq!(
            StateLayerType::from_str("DashMap"),
            Some(StateLayerType::DashMap)
        );
        assert_eq!(
            StateLayerType::from_str("DASHMAP"),
            Some(StateLayerType::DashMap)
        );

        assert_eq!(StateLayerType::from_str("invalid"), None);
        assert_eq!(StateLayerType::from_str(""), None);
    }

    #[test]
    fn test_state_layer_factory_create() {
        let rwlock_layer = StateLayerFactory::create(StateLayerType::RwLock);
        assert_eq!(rwlock_layer.get_all_prices().len(), 0);

        let dashmap_layer = StateLayerFactory::create(StateLayerType::DashMap);
        assert_eq!(dashmap_layer.get_all_prices().len(), 0);
    }

    #[test]
    fn test_state_layer_factory_create_from_config() {
        let result = StateLayerFactory::create_from_config("rwlock");
        assert!(result.is_ok());

        let result = StateLayerFactory::create_from_config("dashmap");
        assert!(result.is_ok());

        let result = StateLayerFactory::create_from_config("invalid");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("无效的状态层配置"));
    }

    #[test]
    fn test_state_layer_factory_auto_select() {
        // 高频更新应该推荐 DashMap
        let state_type = StateLayerFactory::auto_select(200.0, 10);
        assert_eq!(state_type, StateLayerType::DashMap);

        // 大量池子应该推荐 DashMap
        let state_type = StateLayerFactory::auto_select(50.0, 60);
        assert_eq!(state_type, StateLayerType::DashMap);

        // 低频且池子少应该推荐 RwLock
        let state_type = StateLayerFactory::auto_select(50.0, 10);
        assert_eq!(state_type, StateLayerType::RwLock);
    }

    #[test]
    fn test_state_layer_type_description() {
        let desc = StateLayerType::RwLock.description();
        assert!(desc.contains("RwLock"));
        assert!(desc.contains("读写锁"));

        let desc = StateLayerType::DashMap.description();
        assert!(desc.contains("DashMap"));
        assert!(desc.contains("分片锁"));
    }
}
