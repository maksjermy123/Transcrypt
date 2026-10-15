# ═══════════════════════════════════════════════════════════════
#  Transcrypt — ПОЛНОЕ удаление с компьютера (Windows)
#
#  Запуск (PowerShell):
#    powershell -c "irm https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-win.ps1 | iex"
#
#  Что удаляет:
#    1. Автозапуск: ключ реестра HKCU\...\Run\TranscryptEngine
#    2. Папку движка: %LOCALAPPDATA%\TranscryptEngine (venv, код, логи)
#    3. Данные программы: %LOCALAPPDATA%\VoxPaperAi
#       (модели Whisper, скачанный ffmpeg, результаты, журнал задач)
#    4. Останавливает работающие процессы движка
#
#  Кеш браузерного Whisper очищается кнопкой в Настройках сайта.
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = "SilentlyContinue"

$InstallDir = Join-Path $env:USERPROFILE ".transcrypt-engine"
$AppSupport = Join-Path $env:LOCALAPPDATA "VoxPaperAi"
$AutorunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$AutorunValue = "TranscryptEngine"

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Transcrypt — полное удаление с компьютера (Windows)" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

$freedMB = 0
function Get-DirSizeMB($path) {
    if (Test-Path $path) {
        $size = (Get-ChildItem $path -Recurse -Force | Measure-Object Length -Sum).Sum
        return [math]::Round($size / 1MB)
    }
    return 0
}

# ─── 1. Остановка процессов ─────────────────────────────────────
Write-Host "[1/4] Останавливаем движок..." -ForegroundColor Cyan
$engineProcs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*engine_server.py*" }
if ($engineProcs) {
    $engineProcs | ForEach-Object {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
    Write-Host "  OK Процессы движка остановлены" -ForegroundColor Green
} else {
    Write-Host "  OK Процессы движка не запущены" -ForegroundColor Green
}
Start-Sleep -Seconds 1

# ─── 2. Автозапуск ──────────────────────────────────────────────
Write-Host "[2/4] Удаляем автозапуск (реестр)..." -ForegroundColor Cyan
$prop = Get-ItemProperty -Path $AutorunKey -Name $AutorunValue -ErrorAction SilentlyContinue
if ($prop) {
    Remove-ItemProperty -Path $AutorunKey -Name $AutorunValue -Force
    Write-Host "  OK Удалён ключ: HKCU\...\Run\$AutorunValue" -ForegroundColor Green
} else {
    Write-Host "  OK Ключ автозапуска не найден" -ForegroundColor Green
}

# ─── 3. Папка движка ────────────────────────────────────────────
Write-Host "[3/4] Удаляем папку движка..." -ForegroundColor Cyan
$size = Get-DirSizeMB $InstallDir
if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
    $freedMB += $size
    Write-Host "  OK Удалена: $InstallDir (освобождено $size МБ)" -ForegroundColor Green
} else {
    Write-Host "  OK Папка не найдена: $InstallDir" -ForegroundColor Green
}

# ─── 4. Данные программы ────────────────────────────────────────
Write-Host "[4/4] Удаляем данные программы (модели Whisper, ffmpeg, результаты)..." -ForegroundColor Cyan
$size = Get-DirSizeMB $AppSupport
if (Test-Path $AppSupport) {
    Remove-Item $AppSupport -Recurse -Force
    $freedMB += $size
    Write-Host "  OK Удалена: $AppSupport (освобождено $size МБ)" -ForegroundColor Green
} else {
    Write-Host "  OK Папка данных не найдена: $AppSupport" -ForegroundColor Green
}

Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host "  Transcrypt полностью удалён с этого компьютера" -ForegroundColor Green
Write-Host "  Освобождено: $freedMB МБ" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Остался только кеш браузера — очистите его кнопкой"
Write-Host "«Очистить данные в браузере» в Настройках сайта."
Write-Host ""
