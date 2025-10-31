# Quick Start - No Compilation Check
# Directly runs the compiled binary without any checks

$binaryPath = "target\release\solana-pool-cache.exe"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   Quick Start (No Compilation Check)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $binaryPath)) {
    Write-Host "ERROR: Binary not found at $binaryPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run one of these first:" -ForegroundColor Yellow
    Write-Host "  .\START.ps1" -ForegroundColor Gray
    Write-Host "  cargo build --release --bin solana-pool-cache" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

Write-Host "Starting Solana Pool Cache..." -ForegroundColor Green
Write-Host ""

# Run directly
& $binaryPath

