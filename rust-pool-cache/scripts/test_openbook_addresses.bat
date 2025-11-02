@echo off
echo Testing potential OpenBook V2 market addresses...
echo.

REM Known OpenBook V2 markets from community sources
set ADDRESSES=^
8BnEgHoWFysVcuFFX7QztDmzuH8r5ZFvyP3sYwn1XTh6 ^
CFSMrBssNG8Ud1edW59jNLnq2cwrQ9uY5cM3wXmqRJj3 ^
5xWpt56U1NCuHoAEtpLeUrQcxDkEpNfScjfLFaRzLPgR

cd /d "%~dp0.."

for %%a in (%ADDRESSES%) do (
    echo ========================================
    echo Testing: %%a
    echo ========================================
    cargo run --release --example verify_openbook_address %%a
    echo.
)

echo.
echo All tests complete!
pause
























































