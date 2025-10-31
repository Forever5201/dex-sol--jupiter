@echo off
echo ========================================
echo   数据一致性验证测试
echo ========================================
echo.

echo [1/3] 检查数据质量...
echo ========================================
curl -s http://localhost:3001/data-quality
echo.
echo.

echo [2/3] 测试传统扫描（无验证）...
echo ========================================
curl -s -X POST http://localhost:3001/scan-arbitrage -H "Content-Type: application/json" -d "{\"threshold_pct\": 0.3}"
echo.
echo.

echo [3/3] 测试验证增强扫描...
echo ========================================
curl -s -X POST http://localhost:3001/scan-validated -H "Content-Type: application/json" -d "{\"min_profit_bps\": 30, \"amount\": 1000}"
echo.
echo.

echo ========================================
echo   测试完成
echo ========================================
pause





