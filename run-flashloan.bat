@echo off
cd /d E:\6666666666666666666666666666\dex-cex\dex-sol
echo 🔥 啟動閃電貸套利機器人
echo 📊 配置: configs/flashloan-serverchan.toml
echo 🚀 已啟用: Ultra API + Lite API 完全並行模式 (L2/L3 分離)
pnpm start:flashloan --config=configs/flashloan-serverchan.toml
pause
