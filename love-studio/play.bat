@echo off
setlocal enableextensions enabledelayedexpansion
rem ============================================================================
rem  SocialCoach . Love Studio - built (preview) start (Windows)
rem
rem  Same as start.bat but builds the frontend first and serves the built files
rem  with `vite preview` on :5180 (still proxies /api to the backend on :8000).
rem  Slower to start, closer to what a packaged build looks like.
rem
rem  Only one of dev / preview can hold :5180 at a time - do not run start.bat
rem  and play.bat together.
rem
rem  ASCII only, on purpose.
rem ============================================================================

cd /d "%~dp0"

if not defined STUDIO_PORT set "STUDIO_PORT=5180"
if not defined BACKEND_PORT set "BACKEND_PORT=8000"
set "VENV_PY=%~dp0.venv\Scripts\python.exe"

where python >nul 2>nul
if errorlevel 1 (
  echo [studio] ERROR: python not found on PATH. Install Python 3.11+ first.
  goto :fail
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [studio] ERROR: npm not found on PATH. Install Node.js first.
  goto :fail
)

if not exist "%VENV_PY%" (
  echo [studio] creating python venv at .venv ...
  python -m venv .venv
  if errorlevel 1 goto :fail
)
echo [studio] installing backend dependencies ^(pip^) ...
"%VENV_PY%" -m pip install --upgrade pip >nul
"%VENV_PY%" -m pip install -e AnimaBackend
if errorlevel 1 goto :fail

echo [studio] installing frontend dependencies ^(npm^) ...
pushd frontend
if not exist "node_modules" (
  call npm install
  if errorlevel 1 ( popd & goto :fail )
)
echo [studio] building frontend ...
call npm run build
if errorlevel 1 ( popd & goto :fail )
popd

echo [studio] starting backend on :%BACKEND_PORT% ...
start "Love Studio backend" /D "%~dp0AnimaBackend" "%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port %BACKEND_PORT%

echo [studio] starting frontend ^(preview^) on :%STUDIO_PORT% ...
start "Love Studio frontend" /D "%~dp0frontend" cmd /k "npm run preview"

echo [studio] waiting for http://127.0.0.1:%STUDIO_PORT%/api/health ...
powershell -NoProfile -Command "$u='http://127.0.0.1:%STUDIO_PORT%/api/health'; for($i=0;$i -lt 120;$i++){ try { Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
  echo [studio] ERROR: health did not answer in time. Check the two new windows for errors.
  goto :fail
)

echo.
echo [studio] Love Studio is up: http://127.0.0.1:%STUDIO_PORT%/
echo [studio] (health: http://127.0.0.1:%STUDIO_PORT%/api/health)
start "" "http://127.0.0.1:%STUDIO_PORT%/"
goto :eof

:fail
echo [studio] startup failed. See the messages above.
exit /b 1