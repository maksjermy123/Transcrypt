# ════════════════════════════════════════════════════════════════════
# Transcrypt Web Engine — Удаление для Windows (PowerShell)
# ════════════════════════════════════════════════════════════════════
#
# Этот скрипт ПОЛНОСТЬЮ удаляет локальный движок Transcrypt:
#   1. Удаляет запись в реестре (автозапуск с системой)
#   2. Останавливает запущенные процессы pythonw
#   3. Удаляет директорию %USERPROFILE%\.transcrypt-engine
#
# Запуск (одной командой из PowerShell):
#   iwr -useb https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-win.ps1 | iex
# ════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

$InstallDir = Join-Path $env:USERPROFILE ".transcrypt-engine"
$AutorunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$AutorunValue = "TranscryptEngine"

function Write-Step { param([string]$msg) Write-Host "▸ $msg" -ForegroundColor Blue }
function Write-Ok   { param([string]$msg) Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$msg) Write-Host "✗ $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════"
Write-Host "   Transcrypt Web Engine — Удаление для Windows"
Write-Host "═══════════════════════════════════════════════════════"
Write-Host ""
Write-Host "Это действие НЕЛЬЗЯ отменить. Будет удалено:" -ForegroundColor Yellow
Write-Host "  • $InstallDir\ (venv + Whisper ~800 МБ + src/)"
Write-Host "  • Запись в реестре (автозапуск)"
Write-Host "  • Запущенные процессы pythonw.exe"
Write-Host ""
$confirm = Read-Host "Продолжить удаление? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Отменено пользователем." -ForegroundColor Yellow
    exit 0
}
Write-Host ""

# ─── 1. Удаление записи в реестре (автозапуск) ────────────────────
Write-Step "Удаляем запись автозапуска из реестра…"
try {
    $existing = Get-ItemProperty -Path $AutorunKey -Name $AutorunValue -ErrorAction SilentlyContinue
    if ($existing) {
        Remove-ItemProperty -Path $AutorunKey -Name $AutorunValue -Force
        Write-Ok "Запись в реестре удалена"
    } else {
        Write-Ok "Запись в реестре не найдена"
    }
} catch {
    Write-Warn "Не удалось удалить запись из реестра: $_"
}

# ─── 2. Остановка запущенных процессов ────────────────────────────
Write-Step "Останавливаем запущенные процессы движка…"
$pythonProcesses = Get-Process pythonw -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*$InstallDir*" -or $_.CommandLine -like "*engine_server*"
}
if ($pythonProcesses) {
    $pythonProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Ok "Процессы движка остановлены"
} else {
    # Fallback — убиваем все pythonw, если не можем прочитать Path
    $allPythonw = Get-Process pythonw -ErrorAction SilentlyContinue
    if ($allPythonw) {
        Write-Warn "Найдены процессы pythonw.exe, но не ясно, какие из них Transcrypt."
        Write-Host "  Если уверены — остановите все pythonw.exe:"
        Write-Host "    Get-Process pythonw | Stop-Process -Force"
    } else {
        Write-Ok "Активных процессов движка не найдено"
    }
}

# ─── 3. Удаление директории ───────────────────────────────────────
Write-Step "Удаляем директорию: $InstallDir"
if (Test-Path $InstallDir) {
    try {
        Remove-Item -Recurse -Force $InstallDir
        Write-Ok "Директория удалена (~800 МБ освобождено)"
    } catch {
        Write-Warn "Не удалось удалить директорию: $_"
        Write-Host "  Возможно, какие-то файлы заблокированы. Перезагрузите Windows"
        Write-Host "  и повторите, или удалите вручную:"
        Write-Host "    Remove-Item -Recurse -Force $InstallDir"
    }
} else {
    Write-Ok "Директория не найдена"
}

# ─── 4. Проверка ──────────────────────────────────────────────────
Write-Step "Проверяем что движок остановлен…"
Start-Sleep -Seconds 1
$healthOk = $false
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8765/api/health" -TimeoutSec 2 -UseBasicParsing
    if ($resp.StatusCode -eq 200) { $healthOk = $true }
} catch {}
if ($healthOk) {
    Write-Warn "Движок всё ещё отвечает на 127.0.0.1:8765"
    Write-Host "  Найдите и остановите процесс:"
    Write-Host "    Get-Process pythonw | Where-Object { `$_.CommandLine -like '*engine_server*' } | Stop-Process -Force"
} else {
    Write-Ok "Движок полностью остановлен"
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════"
Write-Ok "Удаление завершено!"
Write-Host "═══════════════════════════════════════════════════════"
Write-Host ""
Write-Host "Что осталось:"
Write-Host "  • Python (ставился через python.org — не трогаем)"
Write-Host "  • ffmpeg (если был установлен через winget — не трогаем)"
Write-Host "  • Браузерный Whisper в кеше браузера"
Write-Host "  • Настройки сайта в localStorage браузера"
Write-Host ""
Write-Host "Чтобы снова использовать Transcrypt: https://maksjermy123.github.io/Transcrypt/"
Write-Host "Браузерный Whisper работает без установки."
Write-Host ""
