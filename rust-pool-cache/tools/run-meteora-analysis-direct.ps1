# Meteora DLMM On-chain Data Analysis Script (Direct Connection)
# No proxy - use direct internet connection

Write-Host "Meteora DLMM On-chain Data Analysis Tool (Direct Mode)" -ForegroundColor Cyan
Write-Host ""

# Clear proxy environment variables to ensure direct connection
$env:HTTPS_PROXY = $null
$env:HTTP_PROXY = $null
$env:http_proxy = $null
$env:https_proxy = $null

Write-Host "Network Configuration:" -ForegroundColor Green
Write-Host "   Mode: Direct Connection (No Proxy)" -ForegroundColor White
Write-Host ""

# Run analysis tool
Write-Host "Starting analysis..." -ForegroundColor Yellow
npx ts-node analyze-meteora-account.ts

# Check results
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Analysis completed successfully!" -ForegroundColor Green
    
    # Show result files
    if (Test-Path "analysis-results") {
        Write-Host ""
        Write-Host "Analysis result files:" -ForegroundColor Cyan
        Get-ChildItem "analysis-results" -File | ForEach-Object {
            Write-Host "   - $($_.Name)" -ForegroundColor White
        }
        
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "   1. Review analysis-results/*.json" -ForegroundColor White
        Write-Host "   2. Compare field offsets with Rust structure" -ForegroundColor White
        Write-Host "   3. Run: cargo test meteora_dlmm_improved::tests" -ForegroundColor White
    }
} else {
    Write-Host ""
    Write-Host "Analysis failed (Exit code: $LASTEXITCODE)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Run: .\diagnose-network.ps1" -ForegroundColor White
    Write-Host "   2. Check if internet connection is stable" -ForegroundColor White
    Write-Host "   3. Try a different RPC endpoint in analyze-meteora-account.ts" -ForegroundColor White
}
































































