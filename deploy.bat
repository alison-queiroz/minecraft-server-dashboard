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
echo   1 AND 2. RUNNING UI AND API TESTS IN PARALLEL
echo ==========================================================
:: Runs Angular and Python tests concurrently, aborts if any fails
call npx concurrently --kill-others-on-fail --prefix "[{name}]" --names "UI,API" -c "cyan,green" "npx ng test --watch=false --browsers=ChromeHeadless" "python -m pytest tests/"

if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] One or more tests failed. Deployment aborted.
    pause
    exit /b 1
)

echo ==========================================================
echo   3. BUILDING ANGULAR ^& DEPLOYING BACKEND IN PARALLEL
echo ==========================================================
echo [INFO] Starting Angular Build in the background...

start /b cmd /c "npx ng build --configuration production > build_log.txt 2>&1"

echo [INFO] Uploading Python API and NGINX config while UI builds...
scp -q -r -i %KEY_PATH% "%PROJECT_DIR%\api" %SERVER_USER%@%SERVER_IP%:"%REMOTE_API_DIR%/"
scp -q -i %KEY_PATH% "%PROJECT_DIR%\run.py" %SERVER_USER%@%SERVER_IP%:"%REMOTE_API_DIR%/run.py"
scp -q -i %KEY_PATH% "%PROJECT_DIR%\config\setup-nginx-map.sh" %SERVER_USER%@%SERVER_IP%:"/tmp/setup-nginx-map.sh"

echo [INFO] Executing remote backend updates and cleaning WWW folder...
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sudo rm -rf %REMOTE_WWW_DIR%/* && pip install -q -r %REMOTE_API_DIR%/api/requirements.txt && sudo systemctl restart minecraft-api.service && chmod +x /tmp/setup-nginx-map.sh && /tmp/setup-nginx-map.sh && rm /tmp/setup-nginx-map.sh"

echo [INFO] Backend deployment finished. Waiting for Angular build to complete...

:wait_build
tasklist /fi "imagename eq node.exe" | find /i "node.exe" > nul
if not errorlevel 1 (
    timeout /t 2 /nobreak > nul
    goto :wait_build
)

findstr /C:"Error:" build_log.txt > nul
if %ERRORLEVEL% EQU 0 (
    color 0C
    echo [ERROR] Angular build failed. Check build_log.txt.
    pause
    exit /b 1
)
del build_log.txt

echo.
echo ==========================================================
echo   4. COMPRESSING ^& UPLOADING FRONT-END
echo ==========================================================
tar -czf "%TAR_FILE%" -C "%BUILD_DIR%" .
scp -q -i %KEY_PATH% "%TAR_FILE%" %SERVER_USER%@%SERVER_IP%:"/tmp/%TAR_FILE%"

ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sudo tar -xzf /tmp/%TAR_FILE% -C %REMOTE_WWW_DIR% && rm /tmp/%TAR_FILE%"
del "%TAR_FILE%"

echo.
color 0A
echo ==========================================================
echo   [SUCCESS] Full deployment completed perfectly and much faster!
echo ==========================================================
pause
