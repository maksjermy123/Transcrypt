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
$RepoTarball = "https://github.com/maksjermy123/Transcrypt/archive/refs/heads/main.tar.gz"
$InstallDir = Join-Path $env:USERPROFILE ".transcrypt-engine"
$VenvDir = Join-Path $InstallDir "venv"
$EngineFile = Join-Path $InstallDir "engine_server.py"
$RequirementsFile = Join-Path $InstallDir "requirements-engine.txt"
$SrcDir = Join-Path $InstallDir "src"
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
            # Предупреждение для Python 3.14+
            if ($minor -ge 14) {
                Write-Warn "Python $($matches[1]).$($matches[2]) — очень новая версия"
                Write-Host "    openai-whisper требует pkg_resources (удалён в setuptools 81+)." -ForegroundColor DarkGray
                Write-Host "    Мы принудительно установим setuptools<81, но если установка" -ForegroundColor DarkGray
                Write-Host "    всё равно упадёт — установите Python 3.12 с https://www.python.org/downloads/" -ForegroundColor DarkGray
                Write-Host "    Продолжаем установку..." -ForegroundColor DarkGray
            }
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

# ─── 5. Скачивание engine_server.py, src/ и requirements ─────────
Write-Step "Скачивание engine_server.py, src/ и requirements-engine.txt..."
# Скачиваем tarball всего репо, распаковываем во временную папку
$tmpTarball = Join-Path $InstallDir "repo.tar.gz"
$tmpExtract = Join-Path $InstallDir "_extract"

try {
    Invoke-WebRequest -Uri $RepoTarball -OutFile $tmpTarball -UseBasicParsing
} catch {
    Write-Err "Не удалось скачать tarball репозитория. Проверьте интернет."
    exit 1
}

if (-not (Test-Path $tmpExtract)) {
    New-Item -ItemType Directory -Path $tmpExtract -Force | Out-Null
}

# Распаковываем tarball (Windows 10+ имеет встроенный tar)
$extractedDir = Join-Path $tmpExtract "Transcrypt-main"
tar -xzf $tmpTarball -C $tmpExtract 2>&1 | Out-Null

if (-not (Test-Path $extractedDir)) {
    Write-Err "Не удалось распаковать репозиторий"
    exit 1
}

# Копируем нужные файлы
Copy-Item -Path (Join-Path $extractedDir "engine_server.py") -Destination $EngineFile -Force
Copy-Item -Path (Join-Path $extractedDir "engine-install/requirements-engine.txt") -Destination $RequirementsFile -Force
# Копируем весь каталог src/ — engine_server.py импортирует из него
if (Test-Path $SrcDir) {
    Remove-Item -Recurse -Force $SrcDir
}
Copy-Item -Path (Join-Path $extractedDir "src") -Destination $SrcDir -Recurse -Force

# Чистим временные файлы
Remove-Item -Force $tmpTarball
Remove-Item -Recurse -Force $tmpExtract
Write-Ok "Файлы скачаны (engine_server.py + src/ + requirements)"

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
# ВАЖНО: сначала отдельно setuptools<81, потом остальные пакеты.
# openai-whisper требует pkg_resources (удалён в setuptools 81+).
& $venvPip install "setuptools<81" --quiet
& $venvPip install -r $RequirementsFile --quiet --no-cache-dir
if ($LASTEXITCODE -ne 0) {
    Write-Err "Ошибка установки зависимостей"
    Write-Host ""
    Write-Host "Если у вас Python 3.14+ — openai-whisper может не собраться." -ForegroundColor DarkGray
    Write-Host "Установите Python 3.12 с https://www.python.org/downloads/:" -ForegroundColor DarkGray
    Write-Host "  1. Скачайте Python 3.12 и установите (отметьте 'Add Python to PATH')"
    Write-Host "  2. Удалите текущий venv:"
    Write-Host "       Remove-Item -Recurse -Force $VenvDir"
    Write-Host "  3. Пересоздайте venv с Python 3.12:"
    Write-Host "       python3.12 -m venv $VenvDir"
    Write-Host "  4. Установите зависимости вручную:"
    Write-Host "       $venvPip install 'setuptools<81'"
    Write-Host "       $venvPip install -r $RequirementsFile"
    Write-Host "  5. Запустите движок:"
    Write-Host "       $venvPythonw $EngineFile"
    exit 1
}
Write-Ok "Зависимости установлены"

# ─── 8. Запуск движка ────────────────────────────────────────────
Write-Step "Запуск engine_server.py на http://127.0.0.1:8765..."

# python.exe (не pythonw) с -u — чтобы логи реально писались в файл
$venvPython = Join-Path $VenvDir "Scripts\python.exe"
$LogFileErr = "$LogFile.err"
$proc = Start-Process -FilePath $venvPython -ArgumentList "-u", $EngineFile -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $LogFileErr -PassThru

# ─── 9. Проверка /api/health ─────────────────────────────────────
# Ждём до 3 минут: первый импорт torch/whisper идёт долго, порт
# начинает отвечать только после всех импортов.
Write-Step "Ожидаем ответа /api/health (первый запуск может занять 1–3 минуты)..."
$healthOk = $false
for ($i = 1; $i -le 60; $i++) {
    if ($proc.HasExited) {
        Write-Err "Движок завершился с ошибкой. Логи:"
        Get-Content $LogFile -ErrorAction SilentlyContinue | Select-Object -Last 40
        Get-Content $LogFileErr -ErrorAction SilentlyContinue | Select-Object -Last 40
        exit 1
    }
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8765/api/health" -TimeoutSec 2 -UseBasicParsing
        if ($resp.StatusCode -eq 200) {
            $healthOk = $true
            break
        }
    } catch {}
    if ($i % 5 -eq 0) {
        Write-Warn "Движок ещё импортирует библиотеки... ($($i * 3) сек)"
    }
    Start-Sleep -Seconds 3
}

if ($healthOk) {
    Write-Ok "Движок запущен на http://127.0.0.1:8765"
} else {
    # Процесс жив, но долго не отвечает — не роняем установку:
    # движок поднимется чуть позже и индикатор на сайте позеленеет сам.
    Write-Warn "Движок пока не отвечает, но процесс работает. Он автоматически станет доступен через пару минут."
    Write-Host "  Логи: $LogFile" -ForegroundColor Gray
}

# ─── 10. Автозапуск с системой (реестр) ──────────────────────────
Write-Step "Настраиваем автозапуск с системой (Windows Registry)..."
$venvPythonw = Join-Path $VenvDir "Scripts\pythonw.exe"
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
