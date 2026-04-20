@echo off
REM FORGE MCP server launcher — seed version with node discovery.
REM The SessionStart hook (hooks/mcp-deps-install.js) overwrites this file
REM with an absolute node path for faster startup. This seed ensures the MCP
REM server works on first boot before the hook fires.

REM Try PATH first (fastest, covers most installs)
where node >nul 2>&1 && (
  node "%~dp0..\mcp\server.js" %*
  exit /b %ERRORLEVEL%
)

REM Common Windows install locations
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" "%~dp0..\mcp\server.js" %*
  exit /b %ERRORLEVEL%
)

REM nvm-windows default location
if exist "%APPDATA%\nvm\current\node.exe" (
  "%APPDATA%\nvm\current\node.exe" "%~dp0..\mcp\server.js" %*
  exit /b %ERRORLEVEL%
)

echo [forge] ERROR: node.exe not found. Install Node.js from https://nodejs.org >&2
exit /b 1
