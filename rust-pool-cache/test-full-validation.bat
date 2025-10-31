@echo off
chcp 65001 > nul
echo ========================================
echo   完整验证功能测试
echo ========================================
echo.

echo 等待10秒让系统收集数据...
timeout /t 10 /nobreak > nul
echo.

echo ========================================
echo [1/4] 数据质量统计
echo ========================================
curl -s http://localhost:3001/data-quality | jq
echo.
echo.

echo ========================================
echo [2/4] 传统扫描（无验证）
echo ========================================
curl -s -X POST http://localhost:3001/scan-arbitrage ^
  -H "Content-Type: application/json" ^
  -d "{\"threshold_pct\": 0.3}" | jq ".count"
echo.
echo.

echo ========================================
echo [3/4] 轻量级验证扫描
echo ========================================
echo 使用slot对齐 + 新鲜度过滤...
curl -s -X POST http://localhost:3001/scan-validated ^
  -H "Content-Type: application/json" ^
  -d "{\"min_profit_bps\": 30, \"amount\": 1000}" | jq
echo.
echo.

echo ========================================
echo [4/4] 统计对比
echo ========================================
echo 获取验证通过率...
curl -s -X POST http://localhost:3001/scan-validated ^
  -H "Content-Type: application/json" ^
  -d "{\"min_profit_bps\": 30, \"amount\": 1000}" | jq ".validation_stats"
echo.
echo.

echo ========================================
echo   测试完成
echo ========================================
echo.
echo 说明：
echo - pass_rate: 验证通过率
echo - average_confidence: 平均置信度
echo - 置信度 ^> 85分: 可以安全执行
echo.
pause





