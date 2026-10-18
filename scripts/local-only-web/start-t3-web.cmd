@echo off
rem Starts the T3 Code web app from this checkout with T3 Code's own outbound
rem requests turned off: no telemetry, no update checks, no pricing download,
rem and a browser policy that only loads from this server. Provider CLIs such
rem as Codex and Claude still reach their own services.
rem
rem One-time setup from the repository root:
rem   pnpm install
rem   pnpm exec vp run --filter t3 build
rem Double-click this file afterwards. Close the window to stop the server.
setlocal
cd /d "%~dp0..\.."

where node >nul 2>nul
if errorlevel 1 goto missing_node
if not exist "apps\server\dist\bin.mjs" goto missing_build

set "T3CODE_NO_EXTERNAL_REQUESTS=true"
set "T3CODE_TELEMETRY_ENABLED=false"

node apps\server\dist\bin.mjs %*
pause
exit /b

:missing_node
echo Node.js 24 or newer is required and was not found on PATH.
pause
exit /b 1

:missing_build
echo T3 Code is not built yet. In the repository root run:
echo   pnpm install
echo   pnpm exec vp run --filter t3 build
pause
exit /b 1
