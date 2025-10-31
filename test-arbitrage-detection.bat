@echo off
echo ========================================
echo 测试套利检测系统
echo ========================================
echo.

echo 此脚本将：
echo 1. 调用 Rust API 获取当前价格快照
echo 2. 请求套利路径扫描
echo 3. 显示发现的套利机会
echo.
echo ========================================
echo.

REM 检查 Rust API 是否运行
echo [1/3] 检查 Rust API 状态...
curl -s http://localhost:8080/health >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo ❌ Rust API 未运行！请先启动 Rust 池子缓存系统。
    echo.
    pause
    exit /b 1
)
echo ✅ Rust API 运行中
echo.

REM 获取当前价格快照
echo [2/3] 获取价格快照...
curl -s http://localhost:8080/prices | jq -r "length" > nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo ⚠️  未安装 jq，使用原始输出
    curl -s http://localhost:8080/prices
) ELSE (
    SET /p PRICE_COUNT= < nul
    echo ✅ 获取到价格数据
)
echo.

REM 请求套利扫描
echo [3/3] 请求套利扫描（初始金额: 1000 USDC）...
echo.
echo ========================================
echo 套利机会：
echo ========================================
curl -s "http://localhost:8080/arbitrage?amount=1000&min_roi=0.05"
echo.
echo ========================================

echo.
echo 说明：
echo - 如果显示空数组 [] 表示当前没有发现套利机会
echo - 这是正常的，因为 Solana 市场效率很高
echo - ROI 阈值设为 0.05%% （非常低）
echo.
pause






