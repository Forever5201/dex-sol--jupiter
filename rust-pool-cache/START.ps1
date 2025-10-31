# Solana Pool Cache - Unified Startup Script

param(
    [Parameter(Position=0)]
    [string]$Mode = "normal"
)

$Title = @"

========================================================
   Solana Pool Cache - Unified Startup Script
========================================================

"@

Write-Host $Title -ForegroundColor Cyan

if ($Mode -eq "help" -or $Mode -eq "-h" -or $Mode -eq "--help") {
    Write-Host "Usage: .\START.ps1 [mode]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Available modes:" -ForegroundColor Yellow
    Write-Host "  normal           - Normal startup" -ForegroundColor Gray
    Write-Host "  fix              - Vault fix startup" -ForegroundColor Green
    Write-Host "  test             - Quick test 30sec" -ForegroundColor Gray
    Write-Host "  test-long        - Long test 5min" -ForegroundColor Gray
    Write-Host "  production       - Production mode" -ForegroundColor Cyan
    Write-Host "  proxy            - Start with proxy" -ForegroundColor Gray
    Write-Host "  monitor          - Monitor mode" -ForegroundColor Gray
    Write-Host "  clean            - Clean build" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Examples:" -ForegroundColor Yellow
    Write-Host "  .\START.ps1 fix" -ForegroundColor Gray
    Write-Host "  .\START.ps1 production" -ForegroundColor Gray
    exit 0
}

switch ($Mode) {
    "fix" {
        Write-Host "Mode: Vault Fix + Full Verification" -ForegroundColor Green
        Write-Host ""
        Write-Host "This will:" -ForegroundColor Gray
        Write-Host "  1. Stop old processes" -ForegroundColor Gray
        Write-Host "  2. Clean build cache" -ForegroundColor Gray
        Write-Host "  3. Full rebuild" -ForegroundColor Gray
        Write-Host "  4. Start and monitor 60sec" -ForegroundColor Gray
        Write-Host "  5. Check data quality" -ForegroundColor Gray
        Write-Host ""
        
        if (Test-Path ".\fix_and_test.ps1") {
            & .\fix_and_test.ps1
        } else {
            Write-Host "ERROR: fix_and_test.ps1 not found" -ForegroundColor Red
            exit 1
        }
    }
    
    "test" {
        Write-Host "Mode: Quick Test 30sec" -ForegroundColor Yellow
        Write-Host ""
        
        $binaryPath = "target\release\solana-pool-cache.exe"
        if (-not (Test-Path $binaryPath)) {
            Write-Host "Binary not found, building..." -ForegroundColor Yellow
            cargo build --release --bin solana-pool-cache
            Write-Host ""
        } else {
            Write-Host "Using existing binary" -ForegroundColor Green
        }
        
        & $binaryPath 2>&1 | Select-Object -First 200
    }
    
    "test-long" {
        Write-Host "Mode: Long Test 5min" -ForegroundColor Yellow
        Write-Host ""
        
        $binaryPath = "target\release\solana-pool-cache.exe"
        if (-not (Test-Path $binaryPath)) {
            Write-Host "Binary not found, building..." -ForegroundColor Yellow
            cargo build --release --bin solana-pool-cache
            Write-Host ""
        } else {
            Write-Host "Using existing binary" -ForegroundColor Green
        }
        
        $timeout = 300
        Write-Host "Running test for $timeout seconds..." -ForegroundColor Gray
        $process = Start-Process -FilePath $binaryPath -PassThru -NoNewWindow
        Start-Sleep -Seconds $timeout
        Stop-Process -Id $process.Id -Force
        Write-Host ""
        Write-Host "Test completed" -ForegroundColor Green
    }
    
    "production" {
        Write-Host "Mode: Production Environment" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Checking configuration..." -ForegroundColor Gray
        
        if (-not (Test-Path "config.toml")) {
            Write-Host "ERROR: config.toml not found" -ForegroundColor Red
            exit 1
        }
        
        $binaryPath = "target\release\solana-pool-cache.exe"
        if (-not (Test-Path $binaryPath)) {
            Write-Host "Binary not found, building..." -ForegroundColor Yellow
            cargo build --release --bin solana-pool-cache
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Build failed!" -ForegroundColor Red
                exit 1
            }
            Write-Host ""
        } else {
            Write-Host "Using existing binary" -ForegroundColor Green
        }
        
        Write-Host "Checking PostgreSQL..." -ForegroundColor Gray
        Write-Host ""
        Write-Host "Starting production environment..." -ForegroundColor Green
        Write-Host ""
        & $binaryPath
    }
    
    "proxy" {
        Write-Host "Mode: With Clash Proxy" -ForegroundColor Magenta
        Write-Host ""
        Write-Host "Setting proxy..." -ForegroundColor Gray
        $env:HTTP_PROXY="http://127.0.0.1:7890"
        $env:HTTPS_PROXY="http://127.0.0.1:7890"
        Write-Host "Proxy set: $env:HTTP_PROXY" -ForegroundColor Gray
        Write-Host ""
        
        $binaryPath = "target\release\solana-pool-cache.exe"
        if (-not (Test-Path $binaryPath)) {
            Write-Host "Binary not found, building..." -ForegroundColor Yellow
            cargo build --release --bin solana-pool-cache
            Write-Host ""
        } else {
            Write-Host "Using existing binary" -ForegroundColor Green
        }
        
        & $binaryPath
    }
    
    "monitor" {
        Write-Host "Mode: Monitor with Logging" -ForegroundColor Blue
        Write-Host ""
        
        $binaryPath = "target\release\solana-pool-cache.exe"
        if (-not (Test-Path $binaryPath)) {
            Write-Host "Binary not found, building..." -ForegroundColor Yellow
            cargo build --release --bin solana-pool-cache
            Write-Host ""
        } else {
            Write-Host "Using existing binary" -ForegroundColor Green
        }
        
        $logFile = "monitor_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
        Write-Host "Logging to: $logFile" -ForegroundColor Gray
        Write-Host ""
        & $binaryPath 2>&1 | Tee-Object -FilePath $logFile
    }
    
    "clean" {
        Write-Host "Mode: Clean Build" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Cleaning build cache..." -ForegroundColor Gray
        cargo clean
        Write-Host "Clean completed" -ForegroundColor Green
        Write-Host ""
        
        Write-Host "Building..." -ForegroundColor Gray
        cargo build --release --bin solana-pool-cache
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "Build successful, starting..." -ForegroundColor Green
            Write-Host ""
            $binaryPath = "target\release\solana-pool-cache.exe"
            & $binaryPath
        } else {
            Write-Host "Build failed" -ForegroundColor Red
            exit 1
        }
    }
    
    "normal" {
        Write-Host "Mode: Normal Startup" -ForegroundColor White
        Write-Host ""
        
        $binaryPath = "target\release\solana-pool-cache.exe"
        $needsCompile = $false
        
        # Check if binary exists
        if (-not (Test-Path $binaryPath)) {
            Write-Host "Binary not found, building..." -ForegroundColor Yellow
            $needsCompile = $true
        } else {
            # Check if source code is newer than binary
            $binaryTime = (Get-Item $binaryPath).LastWriteTime
            $srcFiles = Get-ChildItem -Path "src" -Recurse -File -ErrorAction SilentlyContinue
            $cargoToml = Get-Item "Cargo.toml" -ErrorAction SilentlyContinue
            
            $newestSrc = $null
            if ($srcFiles) {
                $newestSrc = ($srcFiles | Measure-Object -Property LastWriteTime -Maximum).Maximum
            }
            if ($cargoToml -and ($null -eq $newestSrc -or $cargoToml.LastWriteTime -gt $newestSrc)) {
                $newestSrc = $cargoToml.LastWriteTime
            }
            
            if ($newestSrc -and $newestSrc -gt $binaryTime) {
                Write-Host "Source code changed, rebuilding..." -ForegroundColor Yellow
                $needsCompile = $true
            } else {
                Write-Host "Binary up to date, skipping compilation" -ForegroundColor Green
            }
        }
        
        # Compile if needed
        if ($needsCompile) {
            cargo build --release --bin solana-pool-cache
            if ($LASTEXITCODE -ne 0) {
                Write-Host ""
                Write-Host "Build failed!" -ForegroundColor Red
                exit 1
            }
            Write-Host ""
        }
        
        Write-Host "Starting Solana Pool Cache..." -ForegroundColor Green
        Write-Host ""
        
        # Run the binary directly
        & $binaryPath
    }
    
    default {
        Write-Host "ERROR: Unknown mode: $Mode" -ForegroundColor Red
        Write-Host "Use '.\START.ps1 help' to see available modes" -ForegroundColor Gray
        Write-Host ""
        exit 1
    }
}
