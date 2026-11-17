@echo off
setlocal
rem Prefer the isolated toolchain when present; PATH changes stay in this process.
set "VRM_NODE_HOME=%LOCALAPPDATA%\VeloRoute-Toolchain\node-v22.22.3-win-x64"
if exist "%VRM_NODE_HOME%\node.exe" set "PATH=%VRM_NODE_HOME%;%PATH%"
rem Resolve the project from this file, so double-click and terminal launches agree.
pushd "%~dp0"
call npm run dev
set "VRM_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %VRM_EXIT_CODE%
