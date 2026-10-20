@echo off
setlocal enableextensions enabledelayedexpansion
rem ============================================================================
rem  SocialCoach . Love Studio - one-command local start (Windows)
rem
rem    Backend  -> http://127.0.0.1:8000   (FastAPI + SQLite)
rem    Frontend -> http://127.0.0.1:5180   (Vite dev server; proxies /api to :8000)
rem    Health   -> http://127.0.0.1:5180/api/health  (through the frontend proxy)
rem
rem  Installs into repo-local folders only:
rem    python venv : .venv\           (never a global or %USERPROFILE% install)
rem    node modules: frontend\node_modules\
rem
rem  Only one of the dev server / preview server can hold :5180 at a time.
rem  Use play.bat for the built (preview) version; do not run both at once.
rem  Override the port with STUDIO_PORT (frontend) / BACKEND_PORT (backend).
rem
rem  This file is ASCII on purpose so it reads fine in a non-UTF8 codepage.
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

rem --- backend venv + deps ---
if not exist "%VENV_PY%" (
  echo [studio] creating python venv at .venv ...
  python -m venv .venv
  if errorlevel 1 goto :fail
)
echo [studio] installing backend dependencies ^(pip^) ...
"%VENV_PY%" -m pip install --upgrade pip >nul
"%VENV_PY%" -m pip install -e AnimaBackend
if errorlevel 1 goto :fail

rem --- frontend deps ---
if not exist "frontend\node_modules" (
  echo [studio] installing frontend dependencies ^(npm^) ...
  pushd frontend
  call npm install
  if errorlevel 1 ( popd & goto :fail )
  popd
)

rem --- start backend (:8000) in its own window ---
echo [studio] starting backend on :%BACKEND_PORT% ...
start "Love Studio backend" /D "%~dp0AnimaBackend" "%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port %BACKEND_PORT%

rem --- start frontend (:5180) in its own window ---
echo [studio] starting frontend on :%STUDIO_PORT% ...
start "Love Studio frontend" /D "%~dp0frontend" cmd /k "npm run dev"

rem --- wait for the health endpoint through the frontend proxy ---
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
echo [studio] Leave this window; close the two server windows to stop.
goto :eof

:fail
echo [studio] startup failed. See the messages above.
exit /b 1