@echo off
echo 🔧 修復 monorepo workspace 依賴問題
echo ====================================
echo 問題原因：tsconfig.tsbuildinfo 快取文件已損壞/過期，導致 tsc 跳過編譯
echo 解決方案：刪除所有快取文件並重新編譯

set start_time=%time%

REM 進入 monorepo 根目錄
cd /d E:\6666666666666666666666666666\dex-cex\dex-sol

echo.
echo 📦 正在清理所有 workspace 包的快取...
echo.

REM 清理 core
echo 🔹 清理 @solana-arb-bot/core...
cd packages\core
if exist tsconfig.tsbuildinfo del tsconfig.tsbuildinfo
if exist dist rmdir /s /q dist
cd ..\..
echo    ✓ Core 已清理

REM 清理 jupiter-server
echo 🔹 清理 @solana-arb-bot/jupiter-server...
cd packages\jupiter-server
if exist tsconfig.tsbuildinfo del tsconfig.tsbuildinfo
if exist dist rmdir /s /q dist
cd ..\..
echo    ✓ Jupiter Server 已清理

REM 清理 onchain-bot
echo 🔹 清理 @solana-arb-bot/onchain-bot...
cd packages\onchain-bot
if exist tsconfig.tsbuildinfo del tsconfig.tsbuildinfo
if exist dist rmdir /s /q dist
cd ..\..
echo    ✓ Onchain Bot 已清理

REM 清理 jupiter-bot (可選，因為它不需要編譯 output)
echo 🔹 清理 @solana-arb-bot/jupiter-bot (可選)...
cd packages\jupiter-bot
if exist tsconfig.tsbuildinfo del tsconfig.tsbuildinfo
if exist dist rmdir /s /q dist 2>nul
cd ..\..
echo    ✓ Jupiter Bot 已清理

echo.
echo 🛠️  正在重新編譯所有包 (這可能需要 30 秒)...
echo.

REM 編譯 core
echo 🔨 編譯 Core...
cd packages\core
npx tsc --listEmittedFiles >nul 2>&1
cd ..\..
if exist packages\core\dist\index.js (
    echo    ✓ Core 編譯成功
) else (
    echo    ❌ Core 編譯失敗
)

REM 編譯 jupiter-server
echo 🔨 編譯 Jupiter Server...
cd packages\jupiter-server
npx tsc --listEmittedFiles >nul 2>&1
cd ..\..
if exist packages\jupiter-server\dist\index.js (
    echo    ✓ Jupiter Server 編譯成功
) else (
    echo    ❌ Jupiter Server 編譯失敗
)

REM 編譯 onchain-bot
echo 🔨 編譯 Onchain Bot...
cd packages\onchain-bot
npx tsc --listEmittedFiles >nul 2>&1
cd ..\..
if exist packages\onchain-bot\dist\index.js (
    echo    ✓ Onchain Bot 編譯成功
) else (
    echo    ❌ Onchain Bot 編譯失敗
)

echo.
echo ====================================
echo ✅ 修復完成！所有 workspace 包已重新編譯

set end_time=%time%
set /a duration=(%end_time%-%start_time%)/10000
echo ⏱️  總耗時: %duration% 秒

echo.
echo 🚀 現在可以運行了:
echo pnpm start:flashloan --config=configs/flashloan-serverchan.toml
pause
