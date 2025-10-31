@echo off
echo ========================================
echo   Jupiter Quote API 完整测试
echo ========================================
echo.
echo 测试目标：
echo  1. 验证 Legacy Swap API 的正确调用方式
echo  2. 测试对 Ultra API 机会的构建能力
echo  3. 诊断 TLS 连接问题
echo.
echo ========================================
echo.

REM 编译 TypeScript
echo 正在编译测试脚本...
call pnpm exec tsc test-jupiter-quote-api.ts --outDir . --skipLibCheck --esModuleInterop --resolveJsonModule --module commonjs
if %ERRORLEVEL% NEQ 0 (
    echo 编译失败！
    pause
    exit /b 1
)

echo.
echo 正在运行测试...
echo.

REM 运行测试
node test-jupiter-quote-api.js

echo.
echo 测试完成！
pause





