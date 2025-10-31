@echo off
echo ========================================
echo 检查套利机会记录
echo ========================================
echo.

REM 使用 psql 执行查询
psql -U postgres -d postgres -f check-arbitrage-opportunities.sql

echo.
echo ========================================
echo 查询完成
echo ========================================
pause






