@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 第一次執行，正在安裝套件…
  call npm install
)
start "冰壺對決 伺服器" cmd /k npm run server
timeout /t 2 >nul
echo.
echo 本機：http://localhost:5173
echo 同一個 Wi-Fi 的裝置請開下面的區域網路 IP（伺服器視窗也會顯示）：
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do for /f "tokens=*" %%b in ("%%a") do echo   http://%%b:5173
echo.
start "" http://localhost:5173
call npm run dev
