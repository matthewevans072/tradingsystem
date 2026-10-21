@echo off
setlocal
title Signal Desk
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Install the LTS version from https://nodejs.org
  echo then double-click Start-Signal-Desk.bat again.
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo Signal Desk needs Node.js 22.13 or newer. Your version:
  node -v
  echo Install the current LTS from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\@anthropic-ai\sdk" (
  echo Installing dependencies ^(first run only^)...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env from .env.example. Add your API keys there, then restart Signal Desk.
)

set "SD_PORT=4317"
for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"SIGNAL_DESK_PORT=" ".env" 2^>nul') do set "SD_PORT=%%b"

echo.
echo Signal Desk is starting at http://127.0.0.1:%SD_PORT%
echo Keep this window open. Closing it stops Signal Desk, its scheduled briefings and alerts.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:%SD_PORT%"
node --disable-warning=ExperimentalWarning server\index.js
echo.
echo Signal Desk has stopped.
pause
