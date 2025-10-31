# Complete Fix and Test Script
# Fix 13 pools never updated issue

$header = @"

====================================================
  Vault Data Update Chain - Complete Fix
====================================================

Fix includes:
  1. WebSocket vault subscription routing
  2. Support 82-byte vault data
  3. Price change logic optimization

====================================================

"@

Write-Host $header -ForegroundColor Cyan

# Step 1: Stop old process
Write-Host "=== Step 1/5: Stop Old Process ===" -ForegroundColor Yellow
$process = Get-Process -Name "solana-pool-cache" -ErrorAction SilentlyContinue
if ($process) {
    Write-Host "   Found running process (PID: $($process.Id))" -ForegroundColor Gray
    Stop-Process -Name "solana-pool-cache" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "   Process stopped" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "   No running process" -ForegroundColor Gray
    Write-Host ""
}

# Step 2: Clean build cache
Write-Host "=== Step 2/5: Clean Build Cache ===" -ForegroundColor Yellow
Write-Host "   Cleaning..." -ForegroundColor Gray
$cleanOutput = cargo clean 2>&1 | Out-String
if ($cleanOutput -match "Removed (\d+) files, ([0-9.]+\s*[A-Z]+)") {
    Write-Host "   Cleaned $($matches[1]) files, $($matches[2])" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "   Clean completed" -ForegroundColor Green
    Write-Host ""
}

# Step 3: Full rebuild
Write-Host "=== Step 3/5: Full Rebuild ===" -ForegroundColor Yellow
Write-Host "   Building (this may take 5-8 minutes)..." -ForegroundColor Gray
$buildStart = Get-Date
$buildOutput = cargo build --release --bin solana-pool-cache 2>&1 | Out-String

if ($LASTEXITCODE -eq 0) {
    $buildTime = (Get-Date) - $buildStart
    $buildTimeStr = "$($buildTime.Minutes)m $($buildTime.Seconds)s"
    Write-Host "   Build successful! Time: $buildTimeStr" -ForegroundColor Green
    Write-Host ""
    
    # Show binary info
    $exeInfo = Get-Item target/release/solana-pool-cache.exe
    $sizeInMB = [math]::Round($exeInfo.Length / 1MB, 2)
    Write-Host "   Binary info:" -ForegroundColor Cyan
    Write-Host "      Path: $($exeInfo.FullName)" -ForegroundColor Gray
    Write-Host "      Size: $sizeInMB MB" -ForegroundColor Gray
    Write-Host "      Modified: $($exeInfo.LastWriteTime)" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "   Build failed!" -ForegroundColor Red
    Write-Host $buildOutput
    exit 1
}

# Step 4: Start in background
Write-Host "=== Step 4/5: Start System ===" -ForegroundColor Yellow
Write-Host "   Starting in background..." -ForegroundColor Gray

# Create log file with timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = "vault_fix_test_$timestamp.log"

# Start in background
$job = Start-Job -ScriptBlock {
    param($workDir, $logPath)
    Set-Location $workDir
    cargo run --release --bin solana-pool-cache 2>&1 | Tee-Object -FilePath $logPath
} -ArgumentList (Get-Location).Path, $logFile

Write-Host "   System started (Job ID: $($job.Id))" -ForegroundColor Green
Write-Host "   Log file: $logFile" -ForegroundColor Cyan
Write-Host ""

# Step 5: Monitor startup
Write-Host "=== Step 5/5: Monitor Startup (60 seconds) ===" -ForegroundColor Yellow

$checkpoints = @(10, 20, 30, 45, 60)
foreach ($checkpoint in $checkpoints) {
    Write-Host "   Waiting $checkpoint seconds..." -ForegroundColor Gray -NoNewline
    Start-Sleep -Seconds ($checkpoint - ($checkpoints | Where-Object {$_ -lt $checkpoint} | Measure-Object -Maximum).Maximum)
    
    # Check if process is running
    $process = Get-Process -Name "solana-pool-cache" -ErrorAction SilentlyContinue
    if ($process) {
        $cpuTime = [math]::Round($process.CPU, 2)
        $memMB = [math]::Round($process.WorkingSet / 1MB, 2)
        Write-Host " Process running (PID: $($process.Id), CPU: ${cpuTime}s, Memory: ${memMB}MB)" -ForegroundColor Green
    } else {
        Write-Host " Process not running" -ForegroundColor Yellow
    }
    
    # Check log at 30 seconds
    if ($checkpoint -eq 30 -and (Test-Path $logFile)) {
        Write-Host ""
        Write-Host "   Log snippet (last 10 lines):" -ForegroundColor Cyan
        Get-Content $logFile -Tail 10 | ForEach-Object {
            Write-Host "      $_" -ForegroundColor Gray
        }
        Write-Host ""
    }
}

# Final verification
$separator = @"

====================================================
           Verify Fix Effect
====================================================

"@

Write-Host $separator -ForegroundColor Cyan

Write-Host "=== Data Quality Check ===" -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/data-quality" -UseBasicParsing -TimeoutSec 5
    $data = $response.Content | ConvertFrom-Json
    
    Write-Host "   Pool Statistics:" -ForegroundColor Cyan
    Write-Host "      Total pools: $($data.total_pools)" -ForegroundColor Gray
    
    $freshPercent = [math]::Round($data.fresh_pools / $data.total_pools * 100, 1)
    $freshColor = if ($data.fresh_pools -ge 25) { "Green" } elseif ($data.fresh_pools -ge 15) { "Yellow" } else { "Red" }
    Write-Host "      Fresh pools: $($data.fresh_pools) - ${freshPercent}%" -ForegroundColor $freshColor
    
    Write-Host "      Slot aligned: $($data.slot_aligned_pools)" -ForegroundColor Gray
    
    $avgAgeSec = [math]::Round($data.average_age_ms / 1000, 1)
    Write-Host "      Average age: ${avgAgeSec}s" -ForegroundColor Gray
    
    $consistencyPercent = [math]::Round($data.consistency_score, 1)
    $consistencyColor = if ($data.consistency_score -ge 80) { "Green" } elseif ($data.consistency_score -ge 50) { "Yellow" } else { "Red" }
    Write-Host "      Consistency score: ${consistencyPercent}%" -ForegroundColor $consistencyColor
    
    # Slot distribution
    $slot0Count = if ($data.slot_distribution."0") { $data.slot_distribution."0" } else { 0 }
    $slot0Percent = [math]::Round($slot0Count / $data.total_pools * 100, 1)
    $slot0Color = if ($slot0Count -le 2) { "Green" } elseif ($slot0Count -le 5) { "Yellow" } else { "Red" }
    Write-Host "      Slot=0 pools: $slot0Count - ${slot0Percent}%" -ForegroundColor $slot0Color
    
    Write-Host ""
    Write-Host "   Fix Effect Assessment:" -ForegroundColor Cyan
    if ($data.fresh_pools -ge 25 -and $data.consistency_score -ge 80 -and $slot0Count -le 2) {
        Write-Host "      Fix successful! Data quality excellent" -ForegroundColor Green
    } elseif ($data.fresh_pools -ge 15 -and $data.consistency_score -ge 50) {
        Write-Host "      Partial fix, needs more observation" -ForegroundColor Yellow
    } else {
        Write-Host "      Fix effect poor, needs deep diagnosis" -ForegroundColor Red
    }
    
} catch {
    Write-Host "   API not responding yet (system may still be initializing)" -ForegroundColor Yellow
    Write-Host "      Error: $($_.Exception.Message)" -ForegroundColor Gray
}

# Analyze log
Write-Host ""
Write-Host "=== Log Analysis ===" -ForegroundColor Yellow

if (Test-Path $logFile) {
    $logContent = Get-Content $logFile -Raw
    
    # Check vault updates
    $vaultUpdates = ($logContent | Select-String "Received vault update" -AllMatches).Matches.Count
    Write-Host "   Vault updates: $vaultUpdates" -ForegroundColor $(if ($vaultUpdates -gt 0) { "Green" } else { "Yellow" })
    
    # Check 82-byte warnings
    $vault82Warnings = ($logContent | Select-String "received 82-byte data" -AllMatches).Matches.Count
    Write-Host "   82byte vault data: $vault82Warnings" -ForegroundColor $(if ($vault82Warnings -gt 0) { "Cyan" } else { "Gray" })
    
    # Check unknown subscription warnings
    $unknownSubs = ($logContent | Select-String "unknown subscription ID.*data_len=82" -AllMatches).Matches.Count
    Write-Host "   Unknown subscription 82byte: $unknownSubs" -ForegroundColor $(if ($unknownSubs -eq 0) { "Green" } else { "Red" })
    
    # Check arbitrage scans
    $scans = ($logContent | Select-String "Triggering arbitrage scan" -AllMatches).Matches.Count
    Write-Host "   Arbitrage scans: $scans" -ForegroundColor $(if ($scans -gt 0) { "Green" } else { "Yellow" })
    
    # Check opportunities found
    $opportunities = ($logContent | Select-String "opportunities found" -AllMatches).Matches.Count
    Write-Host "   Opportunities found: $opportunities" -ForegroundColor $(if ($opportunities -gt 0) { "Green" } else { "Gray" })
    
    Write-Host ""
    Write-Host "   Recent log (last 20 lines):" -ForegroundColor Cyan
    Get-Content $logFile -Tail 20 | ForEach-Object {
        $line = $_
        if ($line -match "vault update") {
            Write-Host "      $line" -ForegroundColor Green
        } elseif ($line -match "82.byte") {
            Write-Host "      $line" -ForegroundColor Cyan
        } elseif ($line -match "unknown subscription.*82") {
            Write-Host "      $line" -ForegroundColor Red
        } elseif ($line -match "arbitrage") {
            Write-Host "      $line" -ForegroundColor Yellow
        } else {
            Write-Host "      $line" -ForegroundColor Gray
        }
    }
}

# Final summary
$footer = @"

====================================================
                   Complete
====================================================

"@

Write-Host $footer -ForegroundColor Cyan

Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "   1. Monitor log: Get-Content $logFile -Wait" -ForegroundColor Gray
Write-Host "   2. Check data quality: curl http://localhost:3001/data-quality" -ForegroundColor Gray
Write-Host "   3. Trigger scan: curl -X POST http://localhost:3001/scan-validated" -ForegroundColor Gray
Write-Host "   4. Stop system: Get-Process -Name 'solana-pool-cache' | Stop-Process -Force" -ForegroundColor Gray
Write-Host ""

Write-Host "Related docs:" -ForegroundColor Yellow
Write-Host "   BUG_ANALYSIS_REPORT.md - Initialization race bug analysis" -ForegroundColor Gray
Write-Host "   LOG_ANALYSIS_REPORT.md - Complete log breakdown" -ForegroundColor Gray
Write-Host "   VAULT_FIX_SUMMARY.md - Vault fix details" -ForegroundColor Gray
Write-Host "   FINAL_SUMMARY.md - Summary report" -ForegroundColor Gray
Write-Host ""

Write-Host "Fix complete! System is running..." -ForegroundColor Green
