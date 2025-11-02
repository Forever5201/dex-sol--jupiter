use axum::{
    extract::State,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use crate::arbitrage::{scan_for_arbitrage, ArbitrageOpportunity};
use crate::error_tracker::ErrorTracker;
use crate::price_cache::PriceCache;
use crate::opportunity_validator::{OpportunityValidator, ValidationResult};
use crate::lst_arbitrage::{LstArbitrageDetector, LstDiscountOpportunity};  // 🔥 LST套利

use crate::onchain_simulator::OnChainSimulator;

/// API State shared across handlers
#[derive(Clone)]
pub struct ApiState {
    pub price_cache: Arc<PriceCache>,
    pub error_tracker: Arc<ErrorTracker>,
    pub simulator: Option<Arc<OnChainSimulator>>,  // 🎯 链上模拟器（可选）
}

/// Response for health check
#[derive(Serialize)]
pub struct HealthResponse {
    status: String,
    cached_pools: usize,
    cached_pairs: Vec<String>,
}

/// Response for price query
#[derive(Serialize)]
pub struct PriceResponse {
    pool_id: String,
    dex_name: String,
    pair: String,
    price: f64,
    base_reserve: u64,
    quote_reserve: u64,
    age_ms: u128,
}

/// Response for arbitrage scan
#[derive(Serialize)]
pub struct ArbitrageResponse {
    opportunities: Vec<ArbitrageOpportunityDto>,
    count: usize,
}

#[derive(Serialize)]
pub struct ArbitrageOpportunityDto {
    pool_a_id: String,
    pool_a_dex: String,
    pool_a_price: f64,
    pool_b_id: String,
    pool_b_dex: String,
    pool_b_price: f64,
    pair: String,
    price_diff_pct: f64,
    estimated_profit_pct: f64,
    age_ms: u128,
}

impl From<ArbitrageOpportunity> for ArbitrageOpportunityDto {
    fn from(opp: ArbitrageOpportunity) -> Self {
        Self {
            pool_a_id: opp.pool_a_id,
            pool_a_dex: opp.pool_a_dex,
            pool_a_price: opp.pool_a_price,
            pool_b_id: opp.pool_b_id,
            pool_b_dex: opp.pool_b_dex,
            pool_b_price: opp.pool_b_price,
            pair: opp.pair,
            price_diff_pct: opp.price_diff_pct,
            estimated_profit_pct: opp.estimated_profit_pct,
            age_ms: opp.detected_at.elapsed().as_millis(),
        }
    }
}

/// Request for arbitrage scan
#[derive(Deserialize)]
pub struct ScanRequest {
    #[serde(default = "default_threshold")]
    threshold_pct: f64,
}

fn default_threshold() -> f64 {
    0.5 // Default 0.5% threshold
}

/// GET /health - Health check endpoint
async fn health(State(state): State<ApiState>) -> Json<HealthResponse> {
    let (cached_pools, cached_pairs) = state.price_cache.get_stats();
    
    Json(HealthResponse {
        status: "ok".to_string(),
        cached_pools,
        cached_pairs,
    })
}

/// GET /prices - Get all cached prices
async fn get_all_prices(State(state): State<ApiState>) -> Json<Vec<PriceResponse>> {
    let prices = state.price_cache.get_all_prices();
    
    let response: Vec<PriceResponse> = prices
        .into_iter()
        .map(|p| PriceResponse {
            pool_id: p.pool_id.clone(),
            dex_name: p.dex_name.clone(),
            pair: p.pair.clone(),
            price: p.price,
            base_reserve: p.base_reserve,
            quote_reserve: p.quote_reserve,
            age_ms: p.last_update.elapsed().as_millis(),
        })
        .collect();
    
    Json(response)
}

/// GET /prices/:pair - Get prices for a specific pair
async fn get_pair_prices(
    axum::extract::Path(pair): axum::extract::Path<String>,
    State(state): State<ApiState>,
) -> Json<Vec<PriceResponse>> {
    let prices = state.price_cache.get_pools_by_pair(&pair);
    
    let response: Vec<PriceResponse> = prices
        .into_iter()
        .map(|p| PriceResponse {
            pool_id: p.pool_id.clone(),
            dex_name: p.dex_name.clone(),
            pair: p.pair.clone(),
            price: p.price,
            base_reserve: p.base_reserve,
            quote_reserve: p.quote_reserve,
            age_ms: p.last_update.elapsed().as_millis(),
        })
        .collect();
    
    Json(response)
}

/// POST /scan-arbitrage - Scan for arbitrage opportunities
async fn scan_arbitrage(
    State(state): State<ApiState>,
    Json(req): Json<ScanRequest>,
) -> Json<ArbitrageResponse> {
    let opportunities = scan_for_arbitrage(&state.price_cache, req.threshold_pct);
    
    let count = opportunities.len();
    let opportunities: Vec<ArbitrageOpportunityDto> = opportunities
        .into_iter()
        .map(|o| o.into())
        .collect();
    
    Json(ArbitrageResponse {
        opportunities,
        count,
    })
}

/// GET /errors - Get error statistics
async fn get_errors(State(state): State<ApiState>) -> Json<serde_json::Value> {
    let report = state.error_tracker.get_error_report().await;
    Json(serde_json::to_value(report).unwrap_or_default())
}

/// 🎯 数据质量统计端点 - 用于监控数据一致性
#[derive(Serialize)]
pub struct DataQualityResponse {
    total_pools: usize,
    fresh_pools: usize,          // <2秒的数据
    slot_aligned_pools: usize,    // 与最新slot差异<5
    average_age_ms: u64,
    latest_slot: u64,
    slot_distribution: std::collections::HashMap<u64, usize>,
    consistency_score: f64,       // 0-100，数据一致性评分
}

async fn get_data_quality(State(state): State<ApiState>) -> Json<DataQualityResponse> {
    let (total, fresh, aligned, avg_age, slot_dist) = state.price_cache.get_data_quality_stats();
    let latest_slot = state.price_cache.get_latest_slot();
    
    // 计算一致性评分
    let consistency_score = if total > 0 {
        let freshness_score = (fresh as f64 / total as f64) * 50.0;
        let alignment_score = (aligned as f64 / total as f64) * 50.0;
        freshness_score + alignment_score
    } else {
        0.0
    };
    
    Json(DataQualityResponse {
        total_pools: total,
        fresh_pools: fresh,
        slot_aligned_pools: aligned,
        average_age_ms: avg_age,
        latest_slot,
        slot_distribution: slot_dist,
        consistency_score,
    })
}

/// POST /scan-validated - 🎯 扫描并验证套利机会（推荐使用）
/// 
/// 增强版套利扫描，包含：
/// - Slot对齐数据
/// - 数据新鲜度验证
/// - 流动性检查
/// - 价格变化检测
#[derive(Deserialize)]
pub struct ScanValidatedRequest {
    pub min_profit_bps: Option<u64>,
    pub amount: Option<f64>,
}

#[derive(Serialize)]
pub struct ValidatedArbitrageResponse {
    valid_opportunities: Vec<ValidatedOpportunityDto>,
    invalid_count: usize,
    validation_stats: ValidationStatsDto,
}

#[derive(Serialize)]
pub struct ValidatedOpportunityDto {
    #[serde(flatten)]
    opportunity: ArbitrageOpportunityDto,
    confidence_score: f64,
    average_age_ms: u64,
    slot_spread: u64,
}

#[derive(Serialize)]
pub struct ValidationStatsDto {
    total: usize,
    valid: usize,
    invalid: usize,
    pass_rate: f64,
    average_confidence: f64,
}

async fn scan_validated(
    State(state): State<ApiState>,
    Json(payload): Json<ScanValidatedRequest>,
) -> Json<ValidatedArbitrageResponse> {
    let min_profit_bps = payload.min_profit_bps.unwrap_or(30);
    let amount = payload.amount.unwrap_or(1000.0);
    let threshold_pct = min_profit_bps as f64 / 100.0;
    
    // 🎯 阶段1：扫描机会（使用全部缓存）
    let opportunities = scan_for_arbitrage(&state.price_cache, threshold_pct);
    
    // 🎯 阶段2：轻量级验证（数据质量检查）
    let validator = OpportunityValidator::with_defaults(state.price_cache.clone());
    let (valid_opps, _invalid_opps, stats) = validator.validate_batch(opportunities, amount);
    
    // 🎯 阶段3：链上模拟验证（可选，仅高置信度机会）
    let (final_opps, simulated_count) = if let Some(simulator) = &state.simulator {
        // 并发验证所有高置信度机会
        let verified = simulator.verify_batch(valid_opps.clone()).await;
        let count = verified.len();
        
        // 转换回(opportunity, confidence)格式
        let converted: Vec<(ArbitrageOpportunity, f64)> = verified
            .into_iter()
            .map(|(opp, sim_result)| {
                // 使用模拟后的置信度（更高）
                let updated_confidence = if sim_result.still_profitable { 95.0 } else { 50.0 };
                (opp, updated_confidence)
            })
            .collect();
        
        (converted, count)
    } else {
        // 无模拟器，直接使用轻量级验证结果
        let count = valid_opps.len();
        (valid_opps, 0)  // simulated_count = 0
    };
    
    // 转换为DTO
    let valid_dto: Vec<ValidatedOpportunityDto> = final_opps
        .into_iter()
        .map(|(opp, confidence)| {
            // 获取数据质量详情
            let (age, slot_spread) = if let ValidationResult::Valid { data_quality, .. } = validator.validate(&opp, amount) {
                (data_quality.average_age_ms, data_quality.slot_spread)
            } else {
                (0, 0)
            };
            
            ValidatedOpportunityDto {
                opportunity: opp.into(),
                confidence_score: confidence,
                average_age_ms: age,
                slot_spread,
            }
        })
        .collect();
    
    Json(ValidatedArbitrageResponse {
        valid_opportunities: valid_dto,
        invalid_count: stats.total - stats.valid,
        validation_stats: ValidationStatsDto {
            total: stats.total,
            valid: stats.valid,
            invalid: stats.total - stats.valid,
            pass_rate: stats.pass_rate(),
            average_confidence: stats.average_confidence(),
        },
    })
}

/// 🔥 GET /lst-opportunities - 扫描LST折价套利机会
async fn scan_lst_opportunities(State(state): State<ApiState>) -> Json<LstOpportunitiesResponse> {
    // 获取所有当前价格
    let current_prices = state.price_cache.get_all_prices();
    let mut price_map = std::collections::HashMap::new();
    
    for pool_price in current_prices {
        price_map.insert(pool_price.pair, pool_price.price);
    }
    
    // 创建LST检测器并扫描
    let detector = LstArbitrageDetector::new(0.3); // 最小0.3%折价
    
    // 检测折价买入机会
    let mut all_opportunities = detector.detect_discount_opportunities(&price_map);
    
    // 检测跨DEX套利机会
    let cross_dex_opps = detector.detect_cross_dex_opportunities(&price_map);
    all_opportunities.extend(cross_dex_opps);
    
    // 转换为DTO
    let opportunities_dto: Vec<LstOpportunityDto> = all_opportunities
        .into_iter()
        .map(|opp| LstOpportunityDto {
            lst_name: opp.lst_name,
            market_price: opp.market_price,
            fair_value: opp.fair_value,
            discount_percent: opp.discount_percent,
            estimated_profit_percent: opp.estimated_profit_percent,
            pool_source: opp.pool_source,
            arbitrage_type: format!("{:?}", opp.arbitrage_type),
            recommended_amount_usd: opp.recommended_amount_usd,
        })
        .collect();
    
    let count = opportunities_dto.len();
    
    Json(LstOpportunitiesResponse {
        opportunities: opportunities_dto,
        count,
        scan_time: chrono::Utc::now().to_rfc3339(),
    })
}

#[derive(Serialize)]
struct LstOpportunitiesResponse {
    opportunities: Vec<LstOpportunityDto>,
    count: usize,
    scan_time: String,
}

#[derive(Serialize)]
struct LstOpportunityDto {
    lst_name: String,
    market_price: f64,
    fair_value: f64,
    discount_percent: f64,
    estimated_profit_percent: f64,
    pool_source: String,
    arbitrage_type: String,
    recommended_amount_usd: f64,
}

/// Create the API router
pub fn create_router(
    price_cache: Arc<PriceCache>, 
    error_tracker: Arc<ErrorTracker>,
    simulator: Option<Arc<OnChainSimulator>>,
) -> Router {
    let state = ApiState { 
        price_cache,
        error_tracker,
        simulator,
    };
    
    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);
    
    Router::new()
        .route("/health", get(health))
        .route("/prices", get(get_all_prices))
        .route("/prices/:pair", get(get_pair_prices))
        .route("/scan-arbitrage", post(scan_arbitrage))
        .route("/scan-validated", post(scan_validated))  // 🎯 验证增强版扫描
        .route("/lst-opportunities", get(scan_lst_opportunities))  // 🔥 LST折价机会
        .route("/errors", get(get_errors))
        .route("/data-quality", get(get_data_quality))
        .layer(cors)
        .with_state(state)
}

/// Start the API server
pub async fn start_api_server(
    price_cache: Arc<PriceCache>,
    error_tracker: Arc<ErrorTracker>,
    simulator: Option<Arc<OnChainSimulator>>,
    port: u16,
) -> anyhow::Result<()> {
    let app = create_router(price_cache, error_tracker, simulator);
    
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    println!("🌐 HTTP API server listening on http://0.0.0.0:{}", port);
    println!("   Endpoints:");
    println!("     GET  /health");
    println!("     GET  /prices");
    println!("     GET  /prices/:pair");
    println!("     POST /scan-arbitrage       (Legacy)");
    println!("     POST /scan-validated       🎯 Recommended: With validation");
    println!("     GET  /lst-opportunities    🔥 LST discount arbitrage");
    println!("     GET  /errors");
    println!("     GET  /data-quality         📊 Data consistency stats");
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    
    Ok(())
}


