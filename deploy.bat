@echo off
title Oracle Cloud Full Deployment Pipeline
color 0B

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
echo   1. RUNNING UNIT TESTS
echo ==========================================================
call ng test --watch=false --browsers=ChromeHeadless
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Unit tests failed. Deployment aborted.
    pause
    exit /b
)

echo.
echo ==========================================================
echo   2. BUILDING ANGULAR PROJECT
echo ==========================================================
:: Using 'call' ensures the batch script doesn't exit after ng build finishes
call ng build --configuration production
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Angular build failed. Please check the code for errors.
    pause
    exit /b
)

echo.
echo ==========================================================
echo   3. COMPRESSING BUILD FILES
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
echo   4. CLEANING REMOTE WEB DIRECTORY
echo ==========================================================
:: Removes all files inside the dashboard folder without deleting the folder itself
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sudo rm -rf %REMOTE_WWW_DIR%/*"

echo.
echo ==========================================================
echo   5. UPLOADING FRONT-END AND EXTRACTING
echo ==========================================================
scp -i %KEY_PATH% "%TAR_FILE%" %SERVER_USER%@%SERVER_IP%:"/tmp/%TAR_FILE%"
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sudo tar -xzf /tmp/%TAR_FILE% -C %REMOTE_WWW_DIR% && rm /tmp/%TAR_FILE%"

:: Cleanup local archive
del "%TAR_FILE%"

echo.
echo ==========================================================
echo   6. UPLOADING PYTHON API AND RESTARTING SERVICE
echo ==========================================================
scp -r -i %KEY_PATH% "%PROJECT_DIR%\api" %SERVER_USER%@%SERVER_IP%:"%REMOTE_API_DIR%/"
scp -i %KEY_PATH% "%PROJECT_DIR%\run.py" %SERVER_USER%@%SERVER_IP%:"%REMOTE_API_DIR%/run.py"
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "pip install -q -r %REMOTE_API_DIR%/api/requirements.txt && sudo systemctl restart minecraft-api.service"

echo.
color 0A
echo ==========================================================
echo   [SUCCESS] Full deployment completed perfectly!
echo ==========================================================
pause
