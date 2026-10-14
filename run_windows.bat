@echo off
chcp 65001 >nul
title VoxPaperAi Pro — Local Engine

echo ==================================================
echo   🎙 VoxPaperAi Pro — Запуск локального движка
echo ==================================================

where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        echo ❌ Python не найден. Пожалуйста, установите Python с python.org (поставьте галочку Add to PATH).
        pause
        exit /b 1
    )
    set PY_CMD=py
) else (
    set PY_CMD=python
)

if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
)

start "" "https://maksjermy123.github.io/Transcrypt/"
%PY_CMD% engine_server.py
pause
