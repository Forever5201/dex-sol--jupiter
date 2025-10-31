# 测试API和套利功能

Write-Host "🧪 Testing Rust Pool Cache API..." -ForegroundColor Cyan

# 1. Health check
Write-Host "`n1️⃣ Testing /health endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/health" -Method GET
    Write-Host "✅ System Status: $($health.status)" -ForegroundColor Green
    Write-Host "   Cached pools: $($health.cached_pools)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Health check failed: $_" -ForegroundColor Red
}

# 2. Get prices
Write-Host "`n2️⃣ Testing /prices endpoint..." -ForegroundColor Yellow
try {
    $prices = Invoke-RestMethod -Uri "http://localhost:3001/prices" -Method GET
    Write-Host "✅ Total pools with prices: $($prices.Length)" -ForegroundColor Green
    if ($prices.Length -gt 0) {
        $sample = $prices[0]
        Write-Host "   Sample: $($sample.pair) @ $($sample.dex_name)" -ForegroundColor Gray
        Write-Host "   Price: $($sample.price), Age: $($sample.age_ms)ms" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ Prices check failed: $_" -ForegroundColor Red
}

# 3. Data quality
Write-Host "`n3️⃣ Testing /data-quality endpoint..." -ForegroundColor Yellow
try {
    $quality = Invoke-RestMethod -Uri "http://localhost:3001/data-quality" -Method GET
    Write-Host "✅ Data Quality:" -ForegroundColor Green
    Write-Host "   Total pools: $($quality.total_pools)" -ForegroundColor Gray
    Write-Host "   Fresh pools: $($quality.fresh_pools)" -ForegroundColor Gray
    Write-Host "   Consistency score: $([math]::Round($quality.consistency_score, 2))%" -ForegroundColor Gray
    Write-Host "   Average age: $($quality.average_age_ms)ms" -ForegroundColor Gray
} catch {
    Write-Host "❌ Data quality check failed: $_" -ForegroundColor Red
}

# 4. Trigger arbitrage scan (validated)
Write-Host "`n4️⃣ Testing /scan-validated endpoint (ACTIVE SCAN)..." -ForegroundColor Yellow
try {
    $body = @{
        min_profit_bps = 10  # 0.1% minimum profit
        amount = 1000        # $1000 test amount
    } | ConvertTo-Json
    
    $scan = Invoke-RestMethod -Uri "http://localhost:3001/scan-validated" `
                              -Method POST `
                              -ContentType "application/json" `
                              -Body $body
    
    Write-Host "✅ Arbitrage Scan Complete:" -ForegroundColor Green
    Write-Host "   Valid opportunities: $($scan.valid_opportunities.Length)" -ForegroundColor Cyan
    Write-Host "   Invalid count: $($scan.invalid_count)" -ForegroundColor Gray
    Write-Host "   Pass rate: $([math]::Round($scan.validation_stats.pass_rate, 2))%" -ForegroundColor Gray
    
    if ($scan.valid_opportunities.Length -gt 0) {
        Write-Host "`n   🔥 Top Opportunity:" -ForegroundColor Yellow
        $top = $scan.valid_opportunities[0]
        Write-Host "      Pair: $($top.opportunity.pair)" -ForegroundColor White
        Write-Host "      Profit: $([math]::Round($top.opportunity.estimated_profit_pct, 3))%" -ForegroundColor Green
        Write-Host "      Confidence: $([math]::Round($top.confidence_score, 1))%" -ForegroundColor Cyan
        Write-Host "      Age: $($top.average_age_ms)ms" -ForegroundColor Gray
    } else {
        Write-Host "   ℹ️  No profitable opportunities found (market is efficient)" -ForegroundColor DarkGray
    }
} catch {
    Write-Host "❌ Scan validation failed: $_" -ForegroundColor Red
}

Write-Host "`n✅ API Test Complete!" -ForegroundColor Green
Write-Host "💡 Tip: If you see opportunities above, your system is working!" -ForegroundColor Cyan

