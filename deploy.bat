@echo off
setlocal enabledelayedexpansion
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
:: OPTIONAL FLAGS
::   --skip-tests / --skip-checks / --deploy-only
:: -------------------------------------------------------------------
set SKIP_CHECKS=0
for %%A in (%*) do (
  if /I "%%~A"=="--skip-tests" set SKIP_CHECKS=1
  if /I "%%~A"=="--skip-checks" set SKIP_CHECKS=1
  if /I "%%~A"=="--deploy-only" set SKIP_CHECKS=1
)

:: -------------------------------------------------------------------
:: ENVIRONMENT CONFIGURATION
:: -------------------------------------------------------------------
set SERVER_IP=163.176.228.223
set SERVER_USER=opc
set KEY_PATH="C:\Users\alison.soares\Desktop\Alison\cloud\ssh-key-2025-12-18.key"

:: Using %cd% to get the current directory where the .bat is running
set PROJECT_DIR=%cd%
:: Removed trailing slash to prevent Windows quote escaping issues
set BUILD_DIR=%PROJECT_DIR%\dist\minecraft-server-dashboard\browser

set REMOTE_WWW_DIR=/var/www/dashboard
set REMOTE_API_DIR=/home/opc/minecraft
set TAR_FILE=deploy_build.tar.gz

if "%SKIP_CHECKS%"=="1" (
  echo ==========================================================
  echo   0, 1, 2 AND 3. SKIPPING QUALITY + TESTS BY FLAG
  echo ==========================================================
  echo [WARNING] Running deploy-only mode. Checks were skipped.
) else (
  echo ==========================================================
  echo   0, 1, 2 AND 3. RUNNING QUALITY + TESTS IN PARALLEL
  echo ==========================================================
  rem Runs quality gate (lint + strict typecheck), Angular unit tests,
  rem Python unit tests, and Playwright e2e concurrently.
  rem CI=1 is NOT set here - playwright uses reuseExistingServer:true so
  rem it will reuse a running dev server (VS Code task) or start a new one.
  call npx concurrently --kill-others-on-fail --prefix "[{name}]" --names "QUALITY,UI,API,E2E" -c "yellow,cyan,green,magenta" "npm run ci:quality" "npm run test" "npm run test:api" "npm run e2e:playwright"
  set CHECKS_EXIT=!ERRORLEVEL!

  if !CHECKS_EXIT! NEQ 0 (
      color 0C
      echo [ERROR] One or more checks failed. Deployment aborted.
      pause
      exit /b !CHECKS_EXIT!
  )
)

echo ==========================================================
echo   4. BUILDING ANGULAR ^& DEPLOYING BACKEND IN PARALLEL
echo ==========================================================
echo [INFO] Starting Angular Build in the background...

:: Clean up any stale artefacts from a previous run
if exist build_log.txt del /q build_log.txt
if exist build_ok.sentinel del /q build_ok.sentinel
if exist build_fail.sentinel del /q build_fail.sentinel

:: Run the build; write a SEPARATE sentinel file for success vs failure.
:: Do NOT use "echo 0>file" — cmd.exe parses 0> as an fd-0 (stdin) redirect,
:: which silently creates an empty file instead of writing "0" to it.
start /b cmd /c "npx ng build --configuration production > build_log.txt 2>&1 && type nul > build_ok.sentinel || type nul > build_fail.sentinel"

echo [INFO] Uploading Python API and NGINX config while UI builds...
scp -q -r -i %KEY_PATH% "%PROJECT_DIR%\api" %SERVER_USER%@%SERVER_IP%:"%REMOTE_API_DIR%/"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to upload API folder.
  pause
  exit /b 1
)

scp -q -i %KEY_PATH% "%PROJECT_DIR%\run.py" %SERVER_USER%@%SERVER_IP%:"%REMOTE_API_DIR%/run.py"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to upload run.py.
  pause
  exit /b 1
)

scp -q -i %KEY_PATH% "%PROJECT_DIR%\config\setup-nginx-map.sh" %SERVER_USER%@%SERVER_IP%:"/tmp/setup-nginx-map.sh"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to upload setup-nginx-map.sh.
  pause
  exit /b 1
)

echo [INFO] Executing remote backend updates and cleaning WWW folder...
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sudo rm -rf %REMOTE_WWW_DIR%/* && python3 -m pip install -q -r %REMOTE_API_DIR%/api/requirements.txt && find %REMOTE_API_DIR%/api -name '*.pyc' -delete && find %REMOTE_API_DIR%/api -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null && sudo systemctl restart minecraft-api.service && sed -i '1s/^\xEF\xBB\xBF//;s/\r$//' /tmp/setup-nginx-map.sh && sudo bash /tmp/setup-nginx-map.sh && rm /tmp/setup-nginx-map.sh"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Remote backend/nginx update failed. Deployment aborted.
  pause
  exit /b 1
)

echo [INFO] Waiting for API to come up, then forcing Firestore resync...
ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sleep 5 && curl -sf -X POST http://127.0.0.1:5000/api/internal/force-resync && sleep 3 && echo '[INFO] Firestore resync triggered successfully.' ^|^| echo '[WARN] force-resync call failed - check API logs.'"

echo [INFO] Backend deployment finished. Waiting for Angular build to complete...

:wait_build
if not exist build_ok.sentinel if not exist build_fail.sentinel (
    timeout /t 2 /nobreak > nul
    goto :wait_build
)

if exist build_fail.sentinel (
    del /q build_fail.sentinel
    color 0C
    echo [ERROR] Angular build failed. Check build_log.txt.
    pause
    exit /b 1
)
del /q build_ok.sentinel

findstr /C:"Error:" build_log.txt > nul
if %ERRORLEVEL% EQU 0 (
    color 0C
    echo [ERROR] Angular build reported errors. Check build_log.txt.
    pause
    exit /b 1
)
del build_log.txt

echo.
echo ==========================================================
echo   5. COMPRESSING ^& UPLOADING FRONT-END
echo ==========================================================
tar -czf "%TAR_FILE%" -C "%BUILD_DIR%" .
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to create frontend archive.
  pause
  exit /b 1
)

scp -q -i %KEY_PATH% "%TAR_FILE%" %SERVER_USER%@%SERVER_IP%:"/tmp/%TAR_FILE%"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to upload frontend archive.
  pause
  exit /b 1
)

ssh -i %KEY_PATH% %SERVER_USER%@%SERVER_IP% "sudo tar -xzf /tmp/%TAR_FILE% -C %REMOTE_WWW_DIR% && rm /tmp/%TAR_FILE%"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to extract frontend archive on server.
  pause
  exit /b 1
)

del "%TAR_FILE%"

echo.
color 0A
echo ==========================================================
echo   [SUCCESS] Full deployment completed perfectly and much faster!
echo ==========================================================
pause
