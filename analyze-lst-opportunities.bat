@echo off
echo.
echo ========================================
echo LST套利机会统计工具
echo ========================================
echo.

echo [1/2] 确保Node版本正确...
call nvm use 20

echo.
echo [2/2] 运行LST统计分析...
cd /d E:\6666666666666666666666666666\dex-cex\dex-sol
npx tsx tools/analyze-lst-opportunities.ts

echo.
echo ========================================
echo 按任意键退出...
pause >nul























































