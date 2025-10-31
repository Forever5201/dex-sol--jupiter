# Meteora DLMM On-chain Data Analysis Script
# Auto-configure proxy and run analysis tool

Write-Host "Meteora DLMM On-chain Data Analysis Tool" -ForegroundColor Cyan
Write-Host ""

# Configure proxy
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:HTTP_PROXY = "http://127.0.0.1:7890"

Write-Host "Proxy Configuration:" -ForegroundColor Green
Write-Host "   HTTPS_PROXY = $env:HTTPS_PROXY"
Write-Host "   HTTP_PROXY  = $env:HTTP_PROXY"
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
    }
} else {
    Write-Host ""
    Write-Host "Analysis failed (Exit code: $LASTEXITCODE)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "   1. Check if proxy is running at 127.0.0.1:7890"
    Write-Host "   2. Check if RPC endpoint is accessible"
    Write-Host "   3. Review the error message above"
}

