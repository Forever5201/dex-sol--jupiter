/*
 * -----------------------------------------------------------------------------
 * 警告：这是一个核心逻辑示例，并非一个完整的、可生产的程序。
 * - Pubkey 被简化为 String。
 * - RPC 和 WebSocket 连接被模拟。
 * - 错误处理被简化。
 *
 * 你需要添加的依赖 (Cargo.toml):
 * tokio = { version = "1", features = ["full"] }
 * dashmap = "5"
 * petgraph = "0.6"
 * log = "0.4"
 * env_logger = "0.11"
 * rand = "0.8"
 * -----------------------------------------------------------------------------
 */

use dashmap::DashMap;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex};
use tokio::time::interval;

// ---
// 为了示例独立运行，我们简化 Pubkey
// 在实际项目中, 你应该使用 `solana_program::pubkey::Pubkey`
// ---
type Pubkey = String;

// =============================================================================
// [组件一] The Worldview (状态层)
// =============================================================================

#[derive(Debug, Clone)]
struct PoolInfo {
    token_a_reserves: u64,
    token_b_reserves: u64,
    token_a_mint: Pubkey,
    token_b_mint: Pubkey,
    fee_rate: f64, // 例如 0.0025 (0.25%)
    last_updated: Instant,
}

impl PoolInfo {
    // 计算从A到B的输出率 (包含费用，但不含滑点)
    // 实际应用中，你需要一个更复杂的函数，该函数基于输入金额来计算滑点
    fn get_rate(&self, from_mint: &Pubkey) -> f64 {
        if *from_mint == self.token_a_mint {
            // A -> B
            (self.token_b_reserves as f64) / (self.token_a_reserves as f64) * (1.0 - self.fee_rate)
        } else {
            // B -> A
            (self.token_a_reserves as f64) / (self.token_b_reserves as f64) * (1.0 - self.fee_rate)
        }
    }
}

/// Worldview 是一个高并发、线程安全的哈希图
/// Key: 池子的地址 (Pubkey), Value: 池子的信息 (PoolInfo)
type Worldview = Arc<DashMap<Pubkey, PoolInfo>>;

// =============================================================================
// [组件四] The Calculator (计算层)
// =============================================================================

/// TokenGraph 是一个有向图
/// Node: 代币的 Mint 地址 (Pubkey)
/// Edge: 权重 (f64), 代表 -log(Rate)
type TokenGraph = DiGraph<Pubkey, f64>;

/// 套利路径的表示
type ArbitragePath = Vec<Pubkey>;

/// [核心算法] Bellman-Ford (用于寻找负循环)
///
/// @param graph - 包含 -log(Rate) 权重的代币图
/// @param start_node_idx - 我们开始搜索的节点 (例如 SOL 的 NodeIndex)
/// @return Option<ArbitragePath> - 如果找到负循环，返回路径
///
fn find_negative_cycle(
    graph: &TokenGraph,
    start_node_idx: NodeIndex,
) -> Option<ArbitragePath> {
    let node_count = graph.node_count();
    if node_count == 0 {
        return None;
    }

    let mut distances: Vec<f64> = vec![f64::INFINITY; node_count];
    let mut predecessors: Vec<Option<NodeIndex>> = vec![None; node_count];
    
    distances[start_node_idx.index()] = 0.0;

    // 1. 迭代 V-1 次
    for _ in 1..node_count {
        let mut relaxed = false;
        for edge in graph.edge_references() {
            let source_idx = edge.source();
            let target_idx = edge.target();
            let weight = *edge.weight();
            
            let source_dist = distances[source_idx.index()];
            if source_dist.is_infinite() { continue; }

            let new_dist = source_dist + weight;
            if new_dist < distances[target_idx.index()] {
                distances[target_idx.index()] = new_dist;
                predecessors[target_idx.index()] = Some(source_idx);
                relaxed = true;
            }
        }
        if !relaxed {
            // 如果某次迭代没有发生松弛，说明没有负循环（或者已收敛）
            // 注意：对于寻找负循环，我们通常需要完整的 V-1 次迭代
            // break;
        }
    }

    // 2. 第 V 次迭代，用于检测负循环
    for edge in graph.edge_references() {
        let source_idx = edge.source();
        let target_idx = edge.target();
        let weight = *edge.weight();

        let source_dist = distances[source_idx.index()];
        if source_dist.is_infinite() { continue; }

        if source_dist + weight < distances[target_idx.index()] {
            // 找到了负循环！
            // 从 target_idx 开始回溯以构建循环路径
            
            let mut cycle = VecDeque::new();
            let mut current = target_idx;
            
            // 回溯 N 次（N=节点数）以确保进入循环
            for _ in 0..node_count {
                current = predecessors[current.index()].unwrap();
            }

            // 现在 `current` 肯定在循环中，回溯直到再次遇到它
            let cycle_start_node = current;
            cycle.push_front(graph[cycle_start_node].clone()); // 添加 Pubkey

            current = predecessors[current.index()].unwrap();
            while current != cycle_start_node {
                cycle.push_front(graph[current].clone()); // 添加 Pubkey
                current = predecessors[current.index()].unwrap();
            }
            cycle.push_front(graph[cycle_start_node].clone()); // 闭合循环

            log::info!("发现套利机会: {:?}", cycle);
            return Some(cycle.into_iter().collect());
        }
    }

    // 没有找到负循环
    None
}

/// [辅助函数] 将 Worldview 快照构建为图
fn build_graph(worldview: &DashMap<Pubkey, PoolInfo>) -> (TokenGraph, HashMap<Pubkey, NodeIndex>) {
    let mut graph = TokenGraph::new();
    let mut node_map = HashMap::new();

    for entry in worldview.iter() {
        let pool = entry.value();

        // 为A和B代币创建节点 (如果它们还不存在)
        let a_idx = *node_map
            .entry(pool.token_a_mint.clone())
            .or_insert_with(|| graph.add_node(pool.token_a_mint.clone()));
            
        let b_idx = *node_map
            .entry(pool.token_b_mint.clone())
            .or_insert_with(|| graph.add_node(pool.token_b_mint.clone()));

        // 添加两条边: A -> B 和 B -> A
        // 权重 = -log(Rate)
        let rate_a_to_b = pool.get_rate(&pool.token_a_mint);
        let rate_b_to_a = pool.get_rate(&pool.token_b_mint);

        if rate_a_to_b > 0.0 {
            graph.add_edge(a_idx, b_idx, -rate_a_to_b.log(std::f64::consts::E));
        }
        if rate_b_to_a > 0.0 {
            graph.add_edge(b_idx, a_idx, -rate_b_to_a.log(std::f64::consts::E));
        }
    }
    (graph, node_map)
}

/// [组件四] 计算层的主循环
///
/// 监听来自协调器的“计算”信号
async fn run_calculator(
    worldview: Worldview,
    mut calc_rx: mpsc::Receiver<()>, // 接收“开始计算”信号
    // tx_executor: mpsc::Sender<ArbitragePath> // [组件五] 发送到执行器
) {
    while let Some(_) = calc_rx.recv().await {
        log::debug!("(Calculator) 收到计算任务");

        // 克隆状态，准备计算。这必须非常快。
        let worldview_snapshot = worldview.clone();

        // 将 CPU 密集型工作 (图构建, Bellman-Ford) 
        // 移出异步运行时，防止阻塞
        let calculation_task = tokio::task::spawn_blocking(move || {
            let (graph, node_map) = build_graph(&worldview_snapshot);
            
            // 假设我们从 "SOL" 开始
            if let Some(start_node_idx) = node_map.get("SOL_MINT_ADDRESS") {
                if let Some(path) = find_negative_cycle(&graph, *start_node_idx) {
                    return Some(path);
                }
            }
            None
        });

        match calculation_task.await {
            Ok(Some(path)) => {
                log::warn!("(Calculator) 发现套利路径: {:?}", path);
                // [组件五] 在这里发送到执行器
                // tx_executor.send(path).await.unwrap();
            }
            Ok(None) => {
                log::info!("(Calculator) 本轮计算未发现机会");
            }
            Err(e) => {
                log::error!("(Calculator) 计算任务失败: {:?}", e);
            }
        }
    }
}


// =============================================================================
// [组件三] The Coordinator (决策层)
// =============================================================================

/// 协调器的主循环
///
/// 监听“时钟”和“事件”，并向“计算器”发送信号
async fn run_coordinator(
    mut event_rx: mpsc::Receiver<f64>, // 接收价格变动
    calc_tx: mpsc::Sender<()>,       // 发送“开始计算”信号
) {
    // --- 混合触发器参数 ---
    const HIGH_THRESHOLD: f64 = 0.002; // 0.2%
    const COOLDOWN: Duration = Duration::from_millis(20);
    const TICK_INTERVAL: Duration = Duration::from_millis(100);
    // ---

    let mut tick = interval(TICK_INTERVAL);
    
    // 用于“去抖动”的状态
    let last_event_trigger = Arc::new(Mutex::new(Instant::now() - COOLDOWN));

    loop {
        tokio::select! {
            // [触发源 A]: 时钟驱动 (兜底扫描)
            _ = tick.tick() => {
                log::info!("(Coordinator) 时钟触发 'Sweep'");
                // 我们不关心是否能发送成功，如果计算器很忙，就跳过这次时钟
                let _ = calc_tx.try_send(());
            },

            // [触发源 B]: 事件驱动 (机会狙击)
            Some(price_change_pct) = event_rx.recv() => {
                if price_change_pct > HIGH_THRESHOLD {
                    log::warn!("(Coordinator) 事件触发 'Snipe' (变动: {:.4}%)", price_change_pct * 100.0);
                    
                    let mut last_trigger = last_event_trigger.lock().await;
                    if last_trigger.elapsed() >= COOLDOWN {
                        // 冷却已过，允许触发
                        log::info!("(Coordinator) 'Snipe' 触发计算");
                        if calc_tx.try_send(()).is_ok() {
                            // 只有在发送成功时才更新时间戳
                            *last_trigger = Instant::now();
                        } else {
                            log::warn!("(Coordinator) 计算器繁忙，'Snipe' 被跳过");
                        }
                    } else {
                        log::debug!("(Coordinator) 'Snipe' 触发，但处于冷却期，被忽略");
                    }
                }
            }
        }
    }
}


// =============================================================================
// [组件二] The Subscribers (输入层) - 模拟
// =============================================================================

/// 模拟一个 WebSocket 订阅器
///
/// 在真实应用中，这将是一个 (或多个) 
/// 真正的 `tokio-tungstenite` WebSocket 客户端
async fn run_mock_subscriber(worldview: Worldview, event_tx: mpsc::Sender<f64>) {
    let pool_id = "SOL_USDC_POOL_ADDRESS".to_string();
    
    // 模拟池子的初始状态
    let initial_pool = PoolInfo {
        token_a_reserves: 1_000_000,
        token_b_reserves: 100_000_000,
        token_a_mint: "SOL_MINT_ADDRESS".to_string(),
        token_b_mint: "USDC_MINT_ADDRESS".to_string(),
        fee_rate: 0.0025,
        last_updated: Instant::now(),
    };
    worldview.insert(pool_id.clone(), initial_pool.clone());

    // 模拟价格更新
    let mut interval = interval(Duration::from_millis(10)); // 模拟高频更新
    loop {
        interval.tick().await;

        // 模拟一个随机的价格变动
        let price_change = rand::random::<f64>() * 0.005; // 0% 到 0.5% 变动
        let mut old_pool = worldview.get_mut(&pool_id).unwrap();
        let old_price = old_pool.get_rate(&"SOL_MINT_ADDRESS".to_string());
        
        // 更新池子
        old_pool.token_a_reserves += (price_change * 1000.0) as u64;
        let new_price = old_pool.get_rate(&"SOL_MINT_ADDRESS".to_string());
        
        let price_change_pct = (new_price - old_price).abs() / old_price;
        
        // 发送“事件”到协调器
        if event_tx.send(price_change_pct).await.is_err() {
            log::error!("(Subscriber) 协调器已关闭");
            break;
        }
    }
}


// =============================================================================
// 主函数 - 组装所有组件
// =============================================================================

#[tokio::main]
async fn main() {
    // 设置日志
    std::env::set_var("RUST_LOG", "info"); // 设置日志级别 info, warn, error
    env_logger::init();

    // 1. 初始化 [组件一] Worldview
    let worldview: Worldview = Arc::new(DashMap::new());

    // 2. 初始化 [组件三] Coordinator 的通道
    // event_tx: Subscriber -> Coordinator
    // event_rx: Coordinator 接收
    let (event_tx, event_rx) = mpsc::channel(1024);

    // 3. 初始化 [组件四] Calculator 的通道
    // calc_tx: Coordinator -> Calculator
    // calc_rx: Calculator 接收
    let (calc_tx, calc_rx) = mpsc::channel(1); // 容量为1，确保计算任务不会堆积

    // 4. 初始化 [组件五] Executor 的通道 (暂时不用)
    // let (exec_tx, exec_rx) = mpsc::channel(64);

    // --- 启动所有异步任务 ---

    // 启动 [组件三] Coordinator
    let coordinator_handle = tokio::spawn(run_coordinator(event_rx, calc_tx));
    log::info!("(Main) Coordinator 已启动");

    // 启动 [组件四] Calculator
    let calculator_handle = tokio::spawn(run_calculator(worldview.clone(), calc_rx));
    log::info!("(Main) Calculator 已启动");

    // 启动 [组件二] Mock Subscriber
    let subscriber_handle = tokio::spawn(run_mock_subscriber(worldview.clone(), event_tx));
    log::info!("(Main) Mock Subscriber 已启动");

    // 等待所有任务完成 (在这个例子中它们是无限循环的)
    let _ = tokio::try_join!(
        coordinator_handle,
        calculator_handle,
        subscriber_handle
    );
}