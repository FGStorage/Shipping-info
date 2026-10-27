@echo off
title Shipping Information - Launcher PC
echo Menghubungkan ke Shipping Information (Server: 172.18.17.163)...
set "APP_URL=http://172.18.17.163:3000"

start "" chrome.exe --app=%APP_URL% --window-size=1280,850
if %errorlevel% neq 0 (
    start "" msedge.exe --app=%APP_URL% --window-size=1280,850
)
if %errorlevel% neq 0 (
    start "" "%APP_URL%"
)
