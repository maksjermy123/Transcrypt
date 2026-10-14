@echo off
REM ════════════════════════════════════════════════════════════════
REM Transcrypt Web Engine — Установщик для Windows
REM ════════════════════════════════════════════════════════════════
REM
REM Этот скрипт:
REM   1. Проверяет наличие Python 3
REM   2. Создаёт изолированное окружение в %USERPROFILE%\.transcrypt-engine
REM   3. Скачивает engine_server.py и requirements-engine.txt из GitHub
REM   4. Устанавливает зависимости в venv (whisper, yt-dlp, ffmpeg-python, curl-cffi)
REM   5. Запускает engine_server.py на http://127.0.0.1:8765
REM   6. Открывает браузер с https://maksjermy123.github.io/Transcrypt/
REM
REM Запуск: двойной клик по этому файлу в проводнике
REM Удаление: rmdir /s /q %USERPROFILE%\.transcrypt-engine
REM ════════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion

set REPO_RAW=https://raw.githubusercontent.com/maksjermy123/Transcrypt/main
set INSTALL_DIR=%USERPROFILE%\.transcrypt-engine
set VENV_DIR=%INSTALL_DIR%\venv
set ENGINE_FILE=%INSTALL_DIR%\engine_server.py
set REQUIREMENTS_FILE=%INSTALL_DIR%\requirements-engine.txt
set PID_FILE=%INSTALL_DIR%\engine.pid
set LOG_FILE=%INSTALL_DIR%\engine.log

echo.
echo =======================================================
echo    Transcrypt Web Engine - Установка для Windows
echo =======================================================
echo.

REM ─── 1. Проверка Python 3 ──────────────────────────────────────
echo [1/8] Проверка Python 3...
python --version >nul 2>&1
if errorlevel 1 (
    python3 --version >nul 2>&1
    if errorlevel 1 (
        echo [X] Python не найден. Установите Python 3.10+ с https://www.python.org/downloads/
        echo     Обязательно отметьте "Add Python to PATH" при установке.
        pause
        exit /b 1
    )
    set PY_CMD=python3
) else (
    set PY_CMD=python
)
for /f "tokens=*" %%v in ('!PY_CMD! -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"' 2^>nul) do set PY_VERSION=%%v
echo [OK] Python !PY_VERSION! найден

REM ─── 2. Проверка ffmpeg (опционально) ──────────────────────────
echo [2/8] Проверка ffmpeg...
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo [!] ffmpeg не найден — некоторые медиа-операции не будут работать
    echo     Установите через winget: winget install ffmpeg
) else (
    echo [OK] ffmpeg найден
)

REM ─── 3. Создание директории ────────────────────────────────────
echo [3/8] Создание директории: %INSTALL_DIR%
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

REM ─── 4. Остановка старого движка ───────────────────────────────
if exist "%PID_FILE%" (
    for /f "tokens=*" %%p in (%PID_FILE%) do set OLD_PID=%%p
    taskkill /PID !OLD_PID! /F >nul 2>&1
    del /f /q "%PID_FILE%" 2>nul
)

REM ─── 5. Скачивание файлов ──────────────────────────────────────
echo [5/8] Скачивание engine_server.py и requirements...
powershell -Command "Invoke-WebRequest -Uri '%REPO_RAW%/engine_server.py' -OutFile '%ENGINE_FILE%' -UseBasicParsing" 2>nul
powershell -Command "Invoke-WebRequest -Uri '%REPO_RAW%/engine-install/requirements-engine.txt' -OutFile '%REQUIREMENTS_FILE%' -UseBasicParsing" 2>nul
if not exist "%ENGINE_FILE%" (
    echo [X] Не удалось скачать engine_server.py. Проверьте интернет.
    pause
    exit /b 1
)
echo [OK] Файлы скачаны

REM ─── 6. Создание venv ──────────────────────────────────────────
echo [6/8] Создание виртуального окружения Python...
if not exist "%VENV_DIR%" (
    !PY_CMD! -m venv "%VENV_DIR%"
    echo [OK] venv создан
) else (
    echo [OK] venv уже существует
)

REM ─── 7. Установка зависимостей ────────────────────────────────
echo [7/8] Установка зависимостей (это займёт несколько минут при первом запуске)...
"%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip --quiet
"%VENV_DIR%\Scripts\pip.exe" install -r "%REQUIREMENTS_FILE%" --quiet
if errorlevel 1 (
    echo [X] Ошибка установки зависимостей. Повторите с --verbose:
    echo     "%VENV_DIR%\Scripts\pip.exe" install -r "%REQUIREMENTS_FILE%"
    pause
    exit /b 1
)
echo [OK] Зависимости установлены

REM ─── 8. Запуск движка ──────────────────────────────────────────
echo [8/8] Запуск engine_server.py на http://127.0.0.1:8765...

start /b "" "%VENV_DIR%\Scripts\pythonw.exe" "%ENGINE_FILE%" > "%LOG_FILE%" 2>&1

REM Получаем PID процесса pythonw
for /f "tokens=2" %%p in ('tasklist /v /fi "imagename eq pythonw.exe" /fo list 2^>nul ^| findstr "PID:"') do set ENGINE_PID=%%p
if defined ENGINE_PID echo %ENGINE_PID% > "%PID_FILE%"

REM Ждём пока поднимется
timeout /t 3 /nobreak >nul

REM Проверяем health
set HEALTH_OK=0
for /l %%i in (1,1,10) do (
    if !HEALTH_OK!==0 (
        powershell -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:8765/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" >nul 2>&1 && set HEALTH_OK=1
        if !HEALTH_OK!==0 timeout /t 1 /nobreak >nul
    )
)

if !HEALTH_OK!==1 (
    echo [OK] Движок запущен на http://127.0.0.1:8765
) else (
    echo [X] Движок не отвечает. Логи в %LOG_FILE%
    type "%LOG_FILE%"
    pause
    exit /b 1
)

REM ─── 9. Открытие браузера ──────────────────────────────────────
echo [9/9] Открываем веб-интерфейс...
start "" "https://maksjermy123.github.io/Transcrypt/"

echo.
echo =======================================================
echo ✓ Установка завершена!
echo =======================================================
echo.
echo Локальный движок запущен на http://127.0.0.1:8765
echo Веб-интерфейс открыт в браузере.
echo.
echo На веб-странице:
echo   1. Пройдите онбординг (если ещё не пройден)
echo   2. Индикатор в шапке должен быть зелёным - "Движок online"
echo   3. Теперь доступны URL-задачи (YouTube, TikTok, Instagram)
echo.
echo Управление движком:
echo   • Лог:    type %LOG_FILE%
echo   • Стоп:   taskkill /PID %ENGINE_PID% /F
echo   • Старт:  %VENV_DIR%\Scripts\pythonw.exe %ENGINE_FILE%
echo   • Удалить: rmdir /s /q %INSTALL_DIR%
echo.
echo Это окно можно закрыть. Движок продолжит работать в фоне.
echo.
pause
