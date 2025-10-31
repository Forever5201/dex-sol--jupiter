@echo off
echo ========================================
echo 实时监控套利机会
echo ========================================
echo.
echo 说明：
echo - 此脚本会持续监控 Rust 系统输出
echo - 只显示包含套利相关关键字的行
echo - 按 Ctrl+C 停止监控
echo.
echo ========================================
echo.

REM 假设 Rust 程序输出到日志文件
REM 如果没有日志文件，需要重定向输出到文件

REM 查找最新的日志文件
FOR /F "delims=" %%F IN ('dir /B /O-D logs\rust-pool-cache*.log 2^>nul') DO (
    SET LATEST_LOG=logs\%%F
    GOTO :FOUND
)

:FOUND
IF DEFINED LATEST_LOG (
    echo 监控日志文件: %LATEST_LOG%
    echo.
    powershell -Command "Get-Content '%LATEST_LOG%' -Wait | Where-Object { $_ -match 'arbitrage|Found.*opportunities|Router initialized|套利|机会' }"
) ELSE (
    echo 未找到日志文件！
    echo.
    echo 请确认 Rust 程序正在运行，或检查日志配置。
    echo 日志配置位置: rust-pool-cache/config.toml [logging] section
    pause
)






