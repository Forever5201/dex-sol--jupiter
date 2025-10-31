@echo off
chcp 65001 >nul
echo ========================================
echo   系统代理配置检测
echo ========================================
echo.

echo [1] 检查环境变量中的代理...
echo HTTP_PROXY=%HTTP_PROXY%
echo HTTPS_PROXY=%HTTPS_PROXY%
echo.

if defined HTTP_PROXY (
    echo ✅ 环境变量已配置代理
    echo.
    echo 您的系统已经正确配置，代码会自动使用代理！
    echo.
    goto :test
)

echo ❌ 环境变量中没有代理配置
echo.

echo [2] 检测 Windows 系统代理...
powershell -Command "$proxyEnable = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyEnable; $proxyServer = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyServer; if ($proxyEnable -eq 1) { Write-Host '✅ Windows 系统代理已启用' -ForegroundColor Green; Write-Host \"   代理服务器: $proxyServer\" -ForegroundColor Cyan; Write-Host ''; Write-Host '💡 建议设置环境变量 (选择一种方式):' -ForegroundColor Yellow; Write-Host ''; Write-Host '方式1: 临时设置 (仅当前会话有效)' -ForegroundColor White; Write-Host \"   set HTTP_PROXY=http://$proxyServer\" -ForegroundColor Gray; Write-Host \"   set HTTPS_PROXY=http://$proxyServer\" -ForegroundColor Gray; Write-Host ''; Write-Host '方式2: 永久设置 (推荐)' -ForegroundColor White; Write-Host \"   setx HTTP_PROXY http://$proxyServer\" -ForegroundColor Gray; Write-Host \"   setx HTTPS_PROXY http://$proxyServer\" -ForegroundColor Gray; Write-Host '   (需要重启终端后生效)' -ForegroundColor DarkGray } else { Write-Host '❌ Windows 系统代理未启用' -ForegroundColor Red; Write-Host ''; Write-Host '请检查:' -ForegroundColor Yellow; Write-Host '  1. 您的代理软件 (Clash/V2Ray/SS) 是否正在运行？' -ForegroundColor White; Write-Host '  2. 是否在 Windows 设置中启用了系统代理？' -ForegroundColor White; Write-Host '     Windows设置 → 网络和Internet → 代理 → 手动设置代理' -ForegroundColor DarkGray }"
echo.

echo ========================================
echo   常见代理软件的默认配置
echo ========================================
echo.
echo Clash:       127.0.0.1:7890
echo V2RayN:      127.0.0.1:10808
echo Shadowsocks: 127.0.0.1:1080
echo.
echo 如果您使用上述代理软件，可以手动设置：
echo   set HTTP_PROXY=http://127.0.0.1:7890
echo   set HTTPS_PROXY=http://127.0.0.1:7890
echo.

:test
echo ========================================
echo   是否要测试代理连接？
echo ========================================
echo.
set /p answer="输入 Y 测试，或按 Enter 跳过: "
if /i "%answer%"=="Y" (
    echo.
    echo 测试连接到 Google...
    if defined HTTP_PROXY (
        curl -x %HTTP_PROXY% -s -o nul -w "HTTP状态码: %%{http_code}\n" --connect-timeout 5 https://www.google.com
    ) else (
        echo 请先设置 HTTP_PROXY 环境变量
    )
)

echo.
pause





