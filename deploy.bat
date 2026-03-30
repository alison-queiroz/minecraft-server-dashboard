@echo off
title Oracle Cloud Full Deployment Pipeline
color 0B

:: -------------------------------------------------------------------
:: Bootstrap Node.js into PATH when launched by double-click.
:: Covers nvm-windows, the official Node.js installer, and Volta.
:: -------------------------------------------------------------------
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  for %%P in (
    "%APPDATA%\nvm"
    "%ProgramFiles%\nodejs"
    "%ProgramFiles(x86)%\nodejs"
    "%LOCALAPPDATA%\Volta\bin"
  ) do (
    if exist "%%~P\node.exe" (
      set "PATH=%%~P;%PATH%"
      goto :node_found
    )
  )
  color 0C
  echo [ERROR] Node.js not found. Install it or run this script from a terminal.
  pause
  exit /b 1
)
:node_found

:: -------------------------------------------------------------------
:: ENVIRONMENT CONFIGURATION
:: -------------------------------------------------------------------
set SERVER_IP=163.176.228.223
set SERVER_USER=opc
set KEY_PATH="C:\Users\alison.soares\Desktop\Alison\cloud\ssh-key-2025-12-18.key"

:: Using %cd% to get the current directory where the .bat is running
set PROJECT_DIR=%cd%
:: Removed trailing slash to prevent Windows quote escaping issues
set BUILD_DIR=%PROJECT_DIR%\dist\minecraft-server-dashboard

set REMOTE_WWW_DIR=/var/www/dashboard
set REMOTE_API_DIR=/home/opc/minecraft
set TAR_FILE=deploy_build.tar.gz

echo ==========================================================
echo   1. RUNNING ANGULAR UNIT TESTS
echo ==========================================================
call npx ng test --watch=false --browsers=ChromeHeadless
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Angular unit tests failed. Deployment aborted.
    pause
    exit /b
)

echo.
echo ==========================================================
echo   2. RUNNING PYTHON API TESTS
echo ==========================================================
call python -m pytest tests/
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Python API tests failed. Deployment aborted.
    pause
    exit /b
)

echo.
echo ==========================================================
echo   3. BUILDING ANGULAR PROJECT
echo ==========================================================
:: Using 'call' ensures the batch script doesn't exit after ng build finishes
call npx ng build --configuration production
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Angular build failed. Please check the code for errors.
    pause
    exit /b
)

echo.
echo ==========================================================
echo   4. COMPRESSING BUILD FILES
echo ==========================================================
tar -czf "%TAR_FILE%" -C "%BUILD_DIR%" .
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Compression failed. Check if the build directory exists.
    pause
    exit /b
)

echo.
echo ==========================================================
echo   5. CLEANING REMOTE WEB DIRECTORY
echo ==========================================================
:: Removes all files inside the dashboard folder without deleting the folder itself
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sudo rm -rf %REMOTE_WWW_DIR%/*"

echo.
echo ==========================================================
echo   6. UPLOADING FRONT-END AND EXTRACTING
echo ==========================================================
scp -i %KEY_PATH% "%TAR_FILE%" %SERVER_USER%@%SERVER_IP%:"/tmp/%TAR_FILE%"
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sudo tar -xzf /tmp/%TAR_FILE% -C %REMOTE_WWW_DIR% && rm /tmp/%TAR_FILE%"

:: Cleanup local archive
del "%TAR_FILE%"

echo.
echo ==========================================================
echo   7. UPLOADING PYTHON API AND RESTARTING SERVICE
echo ==========================================================
scp -r -i %KEY_PATH% "%PROJECT_DIR%\api" %SERVER_USER%@%SERVER_IP%:"%REMOTE_API_DIR%/"
scp -i %KEY_PATH% "%PROJECT_DIR%\run.py" %SERVER_USER%@%SERVER_IP%:"%REMOTE_API_DIR%/run.py"
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "pip install -q -r %REMOTE_API_DIR%/api/requirements.txt && sudo systemctl restart minecraft-api.service"

echo.
echo ==========================================================
echo   8. CONFIGURING NGINX MAP PROXY (idempotent)
echo ==========================================================
scp -i %KEY_PATH% "%PROJECT_DIR%\config\setup-nginx-map.sh" %SERVER_USER%@%SERVER_IP%:"/tmp/setup-nginx-map.sh"
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "chmod +x /tmp/setup-nginx-map.sh && /tmp/setup-nginx-map.sh && rm /tmp/setup-nginx-map.sh"

echo.
color 0A
echo ==========================================================
echo   [SUCCESS] Full deployment completed perfectly!
echo ==========================================================
pause
