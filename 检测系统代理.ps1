# 检测系统代理配置
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   系统代理配置检测" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查环境变量
Write-Host "[1] 环境变量中的代理设置:" -ForegroundColor Yellow
Write-Host "   HTTP_PROXY  = $env:HTTP_PROXY"
Write-Host "   HTTPS_PROXY = $env:HTTPS_PROXY"
Write-Host "   http_proxy  = $env:http_proxy"
Write-Host "   https_proxy = $env:https_proxy"
Write-Host ""

# 2. 检查 Windows 系统代理设置
Write-Host "[2] Windows 系统代理设置:" -ForegroundColor Yellow
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$proxyEnable = (Get-ItemProperty -Path $regPath).ProxyEnable
$proxyServer = (Get-ItemProperty -Path $regPath).ProxyServer

if ($proxyEnable -eq 1) {
    Write-Host "   ✅ 系统代理已启用" -ForegroundColor Green
    Write-Host "   代理服务器: $proxyServer"
    
    # 解析代理地址
    if ($proxyServer -match "^([^:]+):(\d+)$") {
        $proxyHost = $matches[1]
        $proxyPort = $matches[2]
        $proxyUrl = "http://$proxyHost`:$proxyPort"
        
        Write-Host ""
        Write-Host "[3] 建议的环境变量设置:" -ForegroundColor Yellow
        Write-Host "   set HTTP_PROXY=$proxyUrl"
        Write-Host "   set HTTPS_PROXY=$proxyUrl"
        Write-Host ""
        
        # 生成启动脚本
        Write-Host "[4] 正在生成自动配置的启动脚本..." -ForegroundColor Yellow
        
        $batContent = @"
@echo off
chcp 65001 >nul
REM ========================================
REM 自动从系统代理配置生成
REM ========================================

echo 使用系统代理: $proxyUrl
set HTTP_PROXY=$proxyUrl
set HTTPS_PROXY=$proxyUrl

echo.
echo [1/2] 编译测试脚本...
call pnpm exec tsc test-jupiter-quote-api.ts --outDir . --skipLibCheck --esModuleInterop --resolveJsonModule --module commonjs
if %ERRORLEVEL% NEQ 0 (
    echo 编译失败！
    pause
    exit /b 1
)

echo.
echo [2/2] 运行测试...
node test-jupiter-quote-api.js

pause
"@
        
        $batContent | Out-File -FilePath "启动测试-自动检测代理.bat" -Encoding ASCII
        
        Write-Host "   ✅ 已生成: 启动测试-自动检测代理.bat" -ForegroundColor Green
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "   下一步操作" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "方式1 (推荐): 直接运行生成的脚本" -ForegroundColor Green
        Write-Host "   启动测试-自动检测代理.bat" -ForegroundColor White
        Write-Host ""
        Write-Host "方式2: 设置用户级环境变量 (永久生效)" -ForegroundColor Yellow
        Write-Host "   [System.Environment]::SetEnvironmentVariable('HTTP_PROXY', '$proxyUrl', 'User')"
        Write-Host "   [System.Environment]::SetEnvironmentVariable('HTTPS_PROXY', '$proxyUrl', 'User')"
        Write-Host ""
        
    } else {
        Write-Host "   ⚠️ 无法解析代理地址: $proxyServer" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ 系统代理未启用" -ForegroundColor Red
    Write-Host ""
    Write-Host "   请检查:" -ForegroundColor Yellow
    Write-Host "   1. 您的代理软件 (Clash/V2Ray/SS) 是否正在运行？"
    Write-Host "   2. 是否已经设置了系统代理？"
    Write-Host "      Windows设置 → 网络和Internet → 代理"
    Write-Host ""
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "按任意键退出..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")





