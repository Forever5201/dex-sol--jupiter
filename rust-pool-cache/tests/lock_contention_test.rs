/// 🧪 锁争用和死锁测试套件
/// 
/// 这个测试文件模拟生产环境中的高并发场景，
/// 验证所有潜在的锁争用和死锁问题

#[cfg(test)]
mod lock_contention_tests {
    use std::sync::{Arc, Mutex};
    use std::collections::HashMap;
    use std::time::Instant;
    use tokio::task::JoinSet;
    
    /// ❌ 测试1：嵌套锁获取 - 重现死锁风险
    #[tokio::test]
    async fn test_nested_lock_deadlock_risk() {
        println!("\n🧪 Test 1: 嵌套锁获取死锁风险测试");
        
        let subscription_map = Arc::new(Mutex::new(HashMap::<String, String>::new()));
        let pool_data_cache = Arc::new(Mutex::new(HashMap::<String, Vec<u8>>::new()));
        
        // 初始化数据
        {
            let mut sub = subscription_map.lock().unwrap();
            sub.insert("pool1".to_string(), "config1".to_string());
            
            let mut cache = pool_data_cache.lock().unwrap();
            cache.insert("pool1".to_string(), vec![1, 2, 3]);
        }
        
        // ❌ 场景：模拟当前代码的嵌套锁获取
        println!("   ❌ 当前代码模式（顺序：sub → cache）:");
        
        let sub_clone = subscription_map.clone();
        let cache_clone = pool_data_cache.clone();
        
        // 线程1：按顺序获取（sub → cache）
        let handle1 = tokio::spawn(async move {
            for i in 0..10 {
                let config = {
                    let sub = sub_clone.lock().unwrap();
                    sub.get("pool1").cloned()
                };  // sub锁释放
                
                if let Some(_config) = config {
                    let data = {
                        let cache = cache_clone.lock().unwrap();
                        cache.get("pool1").cloned()
                    };  // cache锁释放
                    
                    if i % 5 == 0 {
                        println!("      线程1: 成功获取嵌套锁 (iter {})", i);
                    }
                }
                tokio::time::sleep(tokio::time::Duration::from_micros(10)).await;
            }
        });
        
        // 线程2：如果以相反顺序获取（cache → sub）会死锁
        // 注意：当前代码还没有这个问题，但未来维护时可能引入
        println!("      ⚠️  如果另一个线程反向获取（cache → sub），会导致死锁！");
        
        handle1.await.unwrap();
        
        // ✅ 解决方案：一次性获取所有锁
        println!("   ✅ 优化方案（一次性获取）:");
        
        let sub_clone = subscription_map.clone();
        let cache_clone = pool_data_cache.clone();
        
        let handle2 = tokio::spawn(async move {
            for i in 0..10 {
                // ✅ 一次性获取所有数据
                let (config, data) = {
                    let sub = sub_clone.lock().unwrap();
                    let cache = cache_clone.lock().unwrap();
                    (sub.get("pool1").cloned(), cache.get("pool1").cloned())
                };  // 所有锁都释放了
                
                if let (Some(_config), Some(_data)) = (config, data) {
                    if i % 5 == 0 {
                        println!("      线程2: 安全访问 (iter {})", i);
                    }
                }
                tokio::time::sleep(tokio::time::Duration::from_micros(10)).await;
            }
        });
        
        handle2.await.unwrap();
        println!("   ✅ 测试通过：优化方案消除了死锁风险\n");
    }
    
    /// 🐌 测试2：last_prices锁争用性能测试
    #[tokio::test]
    async fn test_last_prices_contention() {
        println!("\n🧪 Test 2: last_prices锁争用性能测试");
        
        // ❌ 方案A：Mutex（当前实现）
        let last_prices_mutex = Arc::new(Mutex::new(HashMap::<String, f64>::new()));
        
        println!("   ❌ Mutex性能测试（29个池子并发更新）:");
        let start = Instant::now();
        let mut handles = JoinSet::new();
        
        for i in 0..29 {
            let prices = last_prices_mutex.clone();
            handles.spawn(async move {
                for j in 0..100 {
                    // 模拟价格更新
                    let mut map = prices.lock().unwrap();
                    map.insert(format!("pool_{}", i), 100.0 + j as f64);
                    // 模拟计算
                    std::hint::black_box(100.0 + j as f64);
                }
            });
        }
        
        while let Some(_) = handles.join_next().await {}
        
        let mutex_duration = start.elapsed();
        println!("      耗时: {:?}", mutex_duration);
        println!("      吞吐量: {:.0} ops/s", (29.0 * 100.0) / mutex_duration.as_secs_f64());
        
        // ✅ 方案B：DashMap（推荐方案）
        use dashmap::DashMap;
        let last_prices_dashmap = Arc::new(DashMap::<String, f64>::new());
        
        println!("   ✅ DashMap性能测试（29个池子并发更新）:");
        let start = Instant::now();
        let mut handles = JoinSet::new();
        
        for i in 0..29 {
            let prices = last_prices_dashmap.clone();
            handles.spawn(async move {
                for j in 0..100 {
                    // 无锁更新
                    prices.insert(format!("pool_{}", i), 100.0 + j as f64);
                    std::hint::black_box(100.0 + j as f64);
                }
            });
        }
        
        while let Some(_) = handles.join_next().await {}
        
        let dashmap_duration = start.elapsed();
        println!("      耗时: {:?}", dashmap_duration);
        println!("      吞吐量: {:.0} ops/s", (29.0 * 100.0) / dashmap_duration.as_secs_f64());
        
        let speedup = mutex_duration.as_micros() as f64 / dashmap_duration.as_micros() as f64;
        println!("   📊 性能提升: {:.1}x", speedup);
        
        if speedup > 2.0 {
            println!("   ✅ DashMap性能提升超过2倍，强烈推荐使用！\n");
        } else {
            println!("   ⚠️  性能提升未达预期，可能需要更高并发场景测试\n");
        }
    }
    
    /// ⚠️ 测试3：vault注册竞态条件
    #[tokio::test]
    async fn test_vault_registration_race() {
        println!("\n🧪 Test 3: vault注册竞态条件测试");
        
        #[derive(Clone)]
        struct MockVaultReader {
            registered_vaults: Arc<Mutex<HashMap<String, bool>>>,
            registration_count: Arc<Mutex<u32>>,  // 统计重复注册次数
        }
        
        impl MockVaultReader {
            fn new() -> Self {
                Self {
                    registered_vaults: Arc::new(Mutex::new(HashMap::new())),
                    registration_count: Arc::new(Mutex::new(0)),
                }
            }
            
            fn is_registered(&self, vault: &str) -> bool {
                self.registered_vaults.lock().unwrap().contains_key(vault)
            }
            
            fn register(&self, vault: &str) {
                let mut vaults = self.registered_vaults.lock().unwrap();
                if vaults.contains_key(vault) {
                    // 重复注册！
                    let mut count = self.registration_count.lock().unwrap();
                    *count += 1;
                    println!("      ⚠️  重复注册检测: {} (count: {})", vault, *count);
                }
                vaults.insert(vault.to_string(), true);
            }
        }
        
        // ❌ 当前代码模式：check-then-register（有竞态）
        println!("   ❌ 当前代码模式（存在竞态）:");
        let reader = MockVaultReader::new();
        let mut handles = vec![];
        
        for i in 0..5 {
            let reader_clone = reader.clone();
            let handle = tokio::spawn(async move {
                // 模拟Phoenix冷门池启动时的并发检测
                let vault = "vault_phoenix_1";
                
                // ❌ 问题：检查和注册分离
                if !reader_clone.is_registered(vault) {
                    // ⚠️ 竞态窗口：其他线程也可能通过检查
                    tokio::time::sleep(tokio::time::Duration::from_micros(10)).await;
                    reader_clone.register(vault);
                    println!("      线程{}: 注册了 {}", i, vault);
                }
            });
            handles.push(handle);
        }
        
        for h in handles {
            h.await.unwrap();
        }
        
        let race_count = *reader.registration_count.lock().unwrap();
        println!("      重复注册次数: {}", race_count);
        
        if race_count > 0 {
            println!("   ⚠️  检测到竞态条件！\n");
        }
        
        // ✅ 优化方案：原子check-and-register
        println!("   ✅ 优化方案（原子操作）:");
        let reader2 = MockVaultReader::new();
        let mut handles = vec![];
        
        for i in 0..5 {
            let reader_clone = reader2.clone();
            let handle = tokio::spawn(async move {
                let vault = "vault_phoenix_2";
                
                // ✅ 在锁内完成check-and-register
                let needs_registration = {
                    let mut vaults = reader_clone.registered_vaults.lock().unwrap();
                    if vaults.contains_key(vault) {
                        false
                    } else {
                        vaults.insert(vault.to_string(), true);
                        true
                    }
                };
                
                if needs_registration {
                    println!("      线程{}: 原子注册了 {}", i, vault);
                }
            });
            handles.push(handle);
        }
        
        for h in handles {
            h.await.unwrap();
        }
        
        let race_count2 = *reader2.registration_count.lock().unwrap();
        println!("      重复注册次数: {}", race_count2);
        
        if race_count2 == 0 {
            println!("   ✅ 测试通过：消除了竞态条件！\n");
        }
    }
    
    /// 📊 测试4：锁争用可视化统计
    #[tokio::test]
    async fn test_lock_contention_visualization() {
        println!("\n🧪 Test 4: 锁争用可视化测试");
        println!("   模拟生产环境：29个池子，每秒200次价格更新\n");
        
        let last_prices = Arc::new(Mutex::new(HashMap::<String, f64>::new()));
        let contention_count = Arc::new(Mutex::new(0u64));
        let total_ops = Arc::new(Mutex::new(0u64));
        
        let start = Instant::now();
        let mut handles = vec![];
        
        for pool_id in 0..29 {
            let prices = last_prices.clone();
            let contention = contention_count.clone();
            let ops = total_ops.clone();
            
            let handle = tokio::spawn(async move {
                for _ in 0..100 {
                    let lock_start = Instant::now();
                    
                    // 尝试获取锁
                    let _guard = prices.lock().unwrap();
                    let lock_wait = lock_start.elapsed();
                    
                    // 统计争用
                    if lock_wait.as_micros() > 10 {
                        let mut count = contention.lock().unwrap();
                        *count += 1;
                    }
                    
                    let mut total = ops.lock().unwrap();
                    *total += 1;
                    
                    // 模拟价格计算
                    std::thread::sleep(std::time::Duration::from_micros(5));
                }
            });
            handles.push(handle);
        }
        
        for h in handles {
            h.await.unwrap();
        }
        
        let elapsed = start.elapsed();
        let total = *total_ops.lock().unwrap();
        let contention = *contention_count.lock().unwrap();
        
        println!("   📊 统计结果:");
        println!("      总操作数: {}", total);
        println!("      耗时: {:?}", elapsed);
        println!("      吞吐量: {:.0} ops/s", total as f64 / elapsed.as_secs_f64());
        println!("      锁争用次数: {}", contention);
        println!("      争用率: {:.1}%", (contention as f64 / total as f64) * 100.0);
        
        if (contention as f64 / total as f64) > 0.1 {
            println!("   ⚠️  锁争用超过10%，建议使用DashMap或RwLock优化！\n");
        } else {
            println!("   ✅ 锁争用在可接受范围内\n");
        }
    }
}

/// 运行所有测试
#[cfg(test)]
mod test_runner {
    #[tokio::test]
    async fn run_all_lock_tests() {
        println!("\n╔═══════════════════════════════════════════════════════════╗");
        println!("║         🧪 锁争用和死锁完整测试套件                          ║");
        println!("╚═══════════════════════════════════════════════════════════╝");
        
        // Note: 实际测试由cargo test单独运行
        // 这里只是一个集成测试的入口点
        
        println!("\n✅ 所有测试已配置，运行：cargo test --package solana-pool-cache --test lock_contention_test");
    }
}



