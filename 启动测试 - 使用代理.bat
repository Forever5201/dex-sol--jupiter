@echo off
chcp 65001 >nul
echo ========================================
echo   Jupiter Quote API 修复测试（使用代理）
echo ========================================
echo.
echo 本脚本将设置代理环境变量并运行测试
echo.

REM ========================================
REM 配置部分 - 请修改为你的代理地址
REM ========================================

REM Clash 默认代理（常用）
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890

REM V2Ray 默认代理（如果使用 V2Ray，取消下面两行注释并注释上面两行）
REM set HTTP_PROXY=http://127.0.0.1:10808
REM set HTTPS_PROXY=http://127.0.0.1:10808

REM Shadowsocks 默认代理（如果使用 SS，取消下面两行注释并注释上面两行）
REM set HTTP_PROXY=http://127.0.0.1:1080
REM set HTTPS_PROXY=http://127.0.0.1:1080

echo 当前代理设置：
echo   HTTP_PROXY=%HTTP_PROXY%
echo   HTTPS_PROXY=%HTTPS_PROXY%
echo.

REM 测试代理连接
echo [1/3] 测试代理连接...
curl -x %HTTP_PROXY% -s -o nul -w "HTTP状态码: %%{http_code}\n" --connect-timeout 5 https://www.google.com
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ⚠️ 警告：代理可能未正常工作！
    echo.
    echo 请检查：
    echo   1. 代理软件是否正在运行？
    echo   2. 代理地址和端口是否正确？
    echo   3. 代理是否允许访问外网？
    echo.
    pause
    exit /b 1
)

echo ✅ 代理连接正常
echo.

REM 编译测试脚本
echo [2/3] 编译测试脚本...
call pnpm exec tsc test-jupiter-quote-api.ts --outDir . --skipLibCheck --esModuleInterop --resolveJsonModule --module commonjs
if %ERRORLEVEL% NEQ 0 (
    echo 编译失败！
    pause
    exit /b 1
)

echo.
echo [3/3] 运行 Jupiter API 测试...
echo.

REM 运行测试
node test-jupiter-quote-api.js

echo.
echo ========================================
echo   测试完成！
echo ========================================
echo.
echo 如果所有测试通过，可以启动闪电贷机器人：
echo   start-flashloan-dryrun.bat
echo.
pause





