# Network Diagnostics Script
# Check proxy and RPC connectivity

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Network Diagnostics Tool" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check if proxy is running
Write-Host "[1/5] Checking proxy server (127.0.0.1:7890)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:7890" -Method GET -TimeoutSec 3 -ErrorAction Stop
    Write-Host "   OK - Proxy is responding" -ForegroundColor Green
    $proxyOK = $true
} catch {
    Write-Host "   FAILED - Proxy is NOT responding" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor DarkGray
    $proxyOK = $false
}
Write-Host ""

# Test 2: Direct connection to Solana RPC (without proxy)
Write-Host "[2/5] Testing direct connection to Solana RPC..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://api.mainnet-beta.solana.com" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' `
        -TimeoutSec 10 `
        -ErrorAction Stop
    Write-Host "   OK - Direct connection works" -ForegroundColor Green
    $directOK = $true
} catch {
    Write-Host "   FAILED - Cannot reach Solana RPC directly" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor DarkGray
    $directOK = $false
}
Write-Host ""

# Test 3: Connection through proxy
if ($proxyOK) {
    Write-Host "[3/5] Testing connection through proxy..." -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri "https://api.mainnet-beta.solana.com" `
            -Method POST `
            -ContentType "application/json" `
            -Body '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' `
            -Proxy "http://127.0.0.1:7890" `
            -TimeoutSec 10 `
            -ErrorAction Stop
        Write-Host "   OK - Proxy connection works" -ForegroundColor Green
        $proxyConnOK = $true
    } catch {
        Write-Host "   FAILED - Cannot reach Solana RPC through proxy" -ForegroundColor Red
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor DarkGray
        $proxyConnOK = $false
    }
} else {
    Write-Host "[3/5] Skipping proxy test (proxy not running)" -ForegroundColor DarkGray
    $proxyConnOK = $false
}
Write-Host ""

# Test 4: Check environment variables
Write-Host "[4/5] Checking environment variables..." -ForegroundColor Yellow
if ($env:HTTPS_PROXY) {
    Write-Host "   HTTPS_PROXY = $env:HTTPS_PROXY" -ForegroundColor Green
} else {
    Write-Host "   HTTPS_PROXY = (not set)" -ForegroundColor DarkGray
}

if ($env:HTTP_PROXY) {
    Write-Host "   HTTP_PROXY  = $env:HTTP_PROXY" -ForegroundColor Green
} else {
    Write-Host "   HTTP_PROXY  = (not set)" -ForegroundColor DarkGray
}
Write-Host ""

# Test 5: Check firewall
Write-Host "[5/5] Checking Windows Firewall status..." -ForegroundColor Yellow
try {
    $firewallProfile = Get-NetFirewallProfile -Profile Domain, Public, Private | 
        Where-Object { $_.Enabled -eq $true } | 
        Select-Object -First 1
    
    if ($firewallProfile) {
        Write-Host "   Windows Firewall is ENABLED" -ForegroundColor Yellow
        Write-Host "   Note: Firewall may be blocking connections" -ForegroundColor DarkGray
    } else {
        Write-Host "   Windows Firewall is DISABLED" -ForegroundColor Green
    }
} catch {
    Write-Host "   Could not check firewall status" -ForegroundColor DarkGray
}
Write-Host ""

# Summary
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Diagnostic Summary" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

if ($proxyOK -and $proxyConnOK) {
    Write-Host "RECOMMENDED ACTION:" -ForegroundColor Green
    Write-Host "   Your proxy is working correctly!" -ForegroundColor Green
    Write-Host "   Run: .\run-meteora-analysis.ps1" -ForegroundColor White
    Write-Host ""
} elseif ($directOK) {
    Write-Host "RECOMMENDED ACTION:" -ForegroundColor Yellow
    Write-Host "   Direct connection works, but proxy has issues" -ForegroundColor Yellow
    Write-Host "   Options:" -ForegroundColor White
    Write-Host "   1. Fix proxy (start Clash/V2Ray)" -ForegroundColor White
    Write-Host "   2. Use direct connection (remove proxy env vars)" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "RECOMMENDED ACTION:" -ForegroundColor Red
    Write-Host "   Network connectivity issue detected" -ForegroundColor Red
    Write-Host "   Suggestions:" -ForegroundColor White
    Write-Host "   1. Check internet connection" -ForegroundColor White
    Write-Host "   2. Check firewall settings" -ForegroundColor White
    Write-Host "   3. Try a different RPC endpoint" -ForegroundColor White
    Write-Host ""
}

# Detailed recommendations
Write-Host "Common Solutions:" -ForegroundColor Cyan
Write-Host ""

if (-not $proxyOK) {
    Write-Host "Problem: Proxy not responding" -ForegroundColor Yellow
    Write-Host "   - Start your proxy software (Clash/V2Ray/Shadowsocks)" -ForegroundColor White
    Write-Host "   - Check if port 7890 is correct" -ForegroundColor White
    Write-Host "   - Or disable proxy: Remove HTTPS_PROXY env var" -ForegroundColor White
    Write-Host ""
}

if ($proxyOK -and -not $proxyConnOK) {
    Write-Host "Problem: Proxy running but cannot reach RPC" -ForegroundColor Yellow
    Write-Host "   - Check proxy configuration" -ForegroundColor White
    Write-Host "   - Verify proxy rules allow Solana RPC" -ForegroundColor White
    Write-Host "   - Try different proxy mode (Global/Rule)" -ForegroundColor White
    Write-Host ""
}

if (-not $directOK -and -not $proxyOK) {
    Write-Host "Problem: No internet connectivity" -ForegroundColor Yellow
    Write-Host "   - Check network cable/WiFi" -ForegroundColor White
    Write-Host "   - Ping 8.8.8.8 to test basic connectivity" -ForegroundColor White
    Write-Host "   - Check Windows Firewall" -ForegroundColor White
    Write-Host ""
}

Write-Host "For offline testing:" -ForegroundColor Cyan
Write-Host "   - Use pre-saved account data from analysis-results/" -ForegroundColor White
Write-Host "   - Current Rust structure is already validated (896 bytes)" -ForegroundColor White
Write-Host ""
































































