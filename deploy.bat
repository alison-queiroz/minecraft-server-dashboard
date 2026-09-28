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
:: Defaults below; override them per shell instead of editing this file:
::   set DEPLOY_SERVER_IP=203.0.113.10
::   set DEPLOY_SERVER_USER=opc
::   set DEPLOY_KEY_PATH=C:\path\to\private_key
:: -------------------------------------------------------------------
set "SERVER_IP=163.176.228.223"
set "SERVER_USER=opc"
set "KEY_PATH=C:\Users\alison.soares\.ssh\oracle_ed25519_2026-05-20"
if defined DEPLOY_SERVER_IP set "SERVER_IP=%DEPLOY_SERVER_IP%"
if defined DEPLOY_SERVER_USER set "SERVER_USER=%DEPLOY_SERVER_USER%"
if defined DEPLOY_KEY_PATH set "KEY_PATH=%DEPLOY_KEY_PATH%"
:: Accept a quoted DEPLOY_KEY_PATH too; every use below adds its own quotes.
set "KEY_PATH=%KEY_PATH:"=%"
set "SSH_TARGET=%SERVER_USER%@%SERVER_IP%"

:: Using %cd% to get the current directory where the .bat is running
set PROJECT_DIR=%cd%
:: Removed trailing slash to prevent Windows quote escaping issues
set BUILD_DIR=%PROJECT_DIR%\dist\minecraft-server-dashboard\browser

:: Everything is uploaded into a private inbox in the SSH user's home and
:: handled there by config/remote-deploy.sh - the same script release.yml
:: runs, which also owns the server layout (/home/opc/minecraft,
:: /var/www/dashboard). See config/README.md.
set REMOTE_INBOX=.dashboard-deploy
set REMOTE_SCRIPT=%REMOTE_INBOX%/remote-deploy.sh
set API_TAR=deploy_api.tar.gz
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
  rem CI=1 only affects playwright.config.ts (retries:2, workers:1) - it does
  rem NOT disable reuseExistingServer, which is hardcoded true regardless of
  rem CI. Without it, a single known-flaky e2e test (0 local retries) aborts
  rem the whole deploy via --kill-others-on-fail even when every other check
  rem passes.
  set CI=1
  call npx concurrently --kill-others-on-fail --prefix "[{name}]" --names "QUALITY,UI,API,E2E" -c "yellow,cyan,green,magenta" "npm run ci:quality" "npm run test" "npm run test:api" "npm run e2e:playwright"
  set CI=
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

:: The API ships as one tarball (api\ + run.py + gunicorn.conf.py) so the
:: server can stage it next to the live copy and swap it in atomically.
:: Local __pycache__/*.pyc (e.g. from pytest runs) never leave this machine.
echo [INFO] Packing the Python API while UI builds...
if exist "%API_TAR%" del /q "%API_TAR%"
tar -czf "%API_TAR%" --exclude=__pycache__ --exclude=*.pyc -C "%PROJECT_DIR%" api run.py gunicorn.conf.py
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to pack the API.
  pause
  exit /b 1
)

echo [INFO] Uploading deploy scripts and API bundle to %SSH_TARGET%...
ssh -i "%KEY_PATH%" %SSH_TARGET% "mkdir -p %REMOTE_INBOX% && chmod 700 %REMOTE_INBOX%"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Cannot reach the server over SSH.
  pause
  exit /b 1
)

scp -q -i "%KEY_PATH%" "%PROJECT_DIR%\config\remote-deploy.sh" "%PROJECT_DIR%\config\setup-nginx-map.sh" "%PROJECT_DIR%\config\setup-nginx-compression.sh" "%API_TAR%" %SSH_TARGET%:%REMOTE_INBOX%/
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to upload the deploy bundle.
  pause
  exit /b 1
)

:: backend: stage + compile + pip + import check, then stop/swap/start and
::          poll /api/healthz - the script rolls the API back by itself if
::          the new release does not come up (and exits non-zero).
:: nginx:   setup-nginx-map.sh + setup-nginx-compression.sh.
:: resync:  Firestore force-resync with the secret read from the service's
::          own environment on the server (never passed on a command line).
:: The sed strips a BOM/CRLF the checkout may have added before bash parses it.
echo [INFO] Deploying backend, provisioning nginx, forcing Firestore resync...
ssh -i "%KEY_PATH%" %SSH_TARGET% "sed -i '1s/^\xEF\xBB\xBF//;s/\r$//' %REMOTE_SCRIPT% && bash %REMOTE_SCRIPT% backend nginx resync"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Remote backend/nginx deploy failed - see the output above. Deployment aborted.
  pause
  exit /b 1
)
del /q "%API_TAR%"

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
echo   5. PRE-COMPRESSING (brotli + gzip), COMPRESSING ^& UPLOADING FRONT-END
echo ==========================================================
:: Emit .br/.gz siblings so nginx serves them via brotli_static/gzip_static.
node scripts\precompress.mjs "%BUILD_DIR%"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Pre-compression step failed.
  pause
  exit /b 1
)

tar -czf "%TAR_FILE%" -C "%BUILD_DIR%" .
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to create frontend archive.
  pause
  exit /b 1
)

scp -q -i "%KEY_PATH%" "%TAR_FILE%" %SSH_TARGET%:%REMOTE_INBOX%/%TAR_FILE%
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Failed to upload frontend archive.
  pause
  exit /b 1
)

:: The live site is never wiped: the build is staged and verified against
:: ngsw.json, then published in place - hashed chunks and assets first,
:: index.html / ngsw.json last. Chunks of previous builds stay for 14 days so
:: open tabs and service-worker clients on the old version keep working.
echo [INFO] Publishing frontend on the server...
ssh -i "%KEY_PATH%" %SSH_TARGET% "bash %REMOTE_SCRIPT% frontend"
if %ERRORLEVEL% NEQ 0 (
  color 0C
  echo [ERROR] Frontend publish failed - see the output above.
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
