# ════════════════════════════════════════════════════════════════════
# Transcrypt Web Engine — Установщик для Windows (PowerShell)
# ════════════════════════════════════════════════════════════════════
#
# Этот скрипт:
#   1. Проверяет наличие Python 3
#   2. Создаёт изолированное окружение в %USERPROFILE%\.transcrypt-engine
#   3. Скачивает engine_server.py и requirements-engine.txt из GitHub
#   4. Устанавливает зависимости в venv (whisper, yt-dlp, ffmpeg-python, curl-cffi)
#   5. Запускает engine_server.py на http://127.0.0.1:8765
#   6. Открывает браузер с https://maksjermy123.github.io/Transcrypt/
#   7. Настраивает автозапуск с системой (запись в реестре)
#
# Запуск (одной командой из PowerShell):
#   iwr -useb https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/install-win.ps1 | iex
#
# Удаление:
#   rmdir /s /q %USERPROFILE%\.transcrypt-engine
#   reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v TranscryptEngine /f
# ════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

$RepoRaw = "https://raw.githubusercontent.com/maksjermy123/Transcrypt/main"
$InstallDir = Join-Path $env:USERPROFILE ".transcrypt-engine"
$VenvDir = Join-Path $InstallDir "venv"
$EngineFile = Join-Path $InstallDir "engine_server.py"
$RequirementsFile = Join-Path $InstallDir "requirements-engine.txt"
$LogFile = Join-Path $InstallDir "engine.log"

function Write-Step { param([string]$msg) Write-Host "▸ $msg" -ForegroundColor Blue }
function Write-Ok   { param([string]$msg) Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$msg) Write-Host "✗ $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════"
Write-Host "   Transcrypt Web Engine — Установка для Windows"
Write-Host "═══════════════════════════════════════════════════════"
Write-Host ""

# ─── 1. Проверка Python 3 ────────────────────────────────────────
Write-Step "Проверка Python 3..."
$pyCmd = $null
try {
    $pyVer = & python --version 2>&1
    if ($pyVer -match "Python (\d+)\.(\d+)") {
        $major = [int]$matches[1]
        $minor = [int]$matches[2]
        if ($major -ge 3 -and $minor -ge 10) {
            $pyCmd = "python"
            Write-Ok "Python $($matches[1]).$($matches[2]) найден: python"
        } else {
            Write-Err "Требуется Python 3.10+. Найдена версия $($matches[1]).$($matches[2])"
            Write-Host "    Установите с https://www.python.org/downloads/"
            Write-Host "    Обязательно отметьте 'Add Python to PATH' при установке."
            exit 1
        }
    } else {
        throw "Not found"
    }
} catch {
    Write-Err "Python не найден. Установите Python 3.10+ с https://www.python.org/downloads/"
    Write-Host "    Обязательно отметьте 'Add Python to PATH' при установке."
    exit 1
}

# ─── 2. Проверка ffmpeg (опционально) ────────────────────────────
Write-Step "Проверка ffmpeg..."
$ffmpegFound = $false
try {
    $ffver = & ffmpeg -version 2>&1 | Select-Object -First 1
    if ($ffver -match "ffmpeg version") {
        Write-Ok "ffmpeg найден"
        $ffmpegFound = $true
    }
} catch {}
if (-not $ffmpegFound) {
    Write-Warn "ffmpeg не найден — медиа-операции (конвертация, hardsub) не будут работать"
    Write-Host "    Установите: winget install ffmpeg"
}

# ─── 3. Создание директории ──────────────────────────────────────
Write-Step "Создание директории: $InstallDir"
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Write-Ok "Директория готова"

# ─── 4. Остановка старого движка ────────────────────────────────
Get-Process pythonw -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*engine_server*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# ─── 5. Скачивание файлов ────────────────────────────────────────
Write-Step "Скачивание engine_server.py и requirements-engine.txt..."
try {
    Invoke-WebRequest -Uri "$RepoRaw/engine_server.py" -OutFile $EngineFile -UseBasicParsing
    Invoke-WebRequest -Uri "$RepoRaw/engine-install/requirements-engine.txt" -OutFile $RequirementsFile -UseBasicParsing
    Write-Ok "Файлы скачаны"
} catch {
    Write-Err "Не удалось скачать файлы. Проверьте интернет."
    exit 1
}

# ─── 6. Создание venv ────────────────────────────────────────────
if (-not (Test-Path $VenvDir)) {
    Write-Step "Создание виртуального окружения Python..."
    & $pyCmd -m venv $VenvDir
    Write-Ok "venv создан"
} else {
    Write-Ok "venv уже существует"
}

$venvPython = Join-Path $VenvDir "Scripts\python.exe"
$venvPip = Join-Path $VenvDir "Scripts\pip.exe"

# ─── 7. Установка зависимостей ──────────────────────────────────
Write-Step "Установка зависимостей (это займёт несколько минут при первом запуске)..."
& $venvPip install --upgrade pip --quiet
& $venvPip install -r $RequirementsFile --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Err "Ошибка установки зависимостей"
    Write-Host "    Попробуйте вручную: $venvPip install -r $RequirementsFile"
    exit 1
}
Write-Ok "Зависимости установлены"

# ─── 8. Запуск движка ────────────────────────────────────────────
Write-Step "Запуск engine_server.py на http://127.0.0.1:8765..."

$venvPythonw = Join-Path $VenvDir "Scripts\pythonw.exe"
Start-Process -FilePath $venvPythonw -ArgumentList $EngineFile -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $LogFile

Start-Sleep -Seconds 3

# ─── 9. Проверка /api/health ─────────────────────────────────────
$healthOk = $false
for ($i = 1; $i -le 10; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8765/api/health" -TimeoutSec 2 -UseBasicParsing
        if ($resp.StatusCode -eq 200) {
            $healthOk = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 1
}

if ($healthOk) {
    Write-Ok "Движок запущен на http://127.0.0.1:8765"
} else {
    Write-Err "Движок не отвечает. Логи в $LogFile"
    Get-Content $LogFile -ErrorAction SilentlyContinue
    exit 1
}

# ─── 10. Автозапуск с системой (реестр) ──────────────────────────
Write-Step "Настраиваем автозапуск с системой (Windows Registry)..."
$autorunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$autorunValue = "TranscryptEngine"
$autorunData = "`"$venvPythonw`" `"$EngineFile`""
try {
    New-ItemProperty -Path $autorunKey -Name $autorunValue -Value $autorunData -PropertyType String -Force | Out-Null
    Write-Ok "Автозапуск настроен — движок будет стартовать при входе в систему"
} catch {
    Write-Warn "Не удалось настроить автозапуск через реестр"
    Write-Host "    Ручная настройка: Win+R → shell:startup → создать ярлык на:"
    Write-Host "    $venvPythonw $EngineFile"
}

# ─── 11. Открытие браузера ──────────────────────────────────────
Write-Step "Открываем веб-интерфейс в браузере..."
Start-Process "https://maksjermy123.github.io/Transcrypt/"

# ─── 12. Финальное сообщение ────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════"
Write-Ok "Установка завершена!"
Write-Host "═══════════════════════════════════════════════════════"
Write-Host ""
Write-Host "Локальный движок запущен на http://127.0.0.1:8765"
Write-Host "Веб-интерфейс открыт в браузере."
Write-Host ""
Write-Host "На веб-странице:"
Write-Host "  1. Пройдите онбординг (если ещё не пройден)"
Write-Host "  2. Индикатор в шапке должен быть зелёным — «Движок online»"
Write-Host "  3. Теперь доступны URL-задачи (YouTube, TikTok, Instagram)"
Write-Host ""
Write-Host "Управление движком:"
Write-Host "  • Лог:    type $LogFile"
Write-Host "  • Стоп:   Get-Process pythonw | Stop-Process -Force"
Write-Host "  • Старт:  $venvPythonw $EngineFile"
Write-Host "  • Удалить автозапуск:"
Write-Host "    Remove-ItemProperty -Path $autorunKey -Name $autorunValue"
Write-Host "  • Полное удаление:"
Write-Host "    Remove-Item -Recurse -Force $InstallDir"
Write-Host "    Remove-ItemProperty -Path $autorunKey -Name $autorunValue"
Write-Host ""
Write-Host "Это окно можно закрыть. Движок продолжит работать в фоне."
Write-Host ""
