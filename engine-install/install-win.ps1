# ════════════════════════════════════════════════════════════════════
# VoxPaperAi Web Engine — Установщик для Windows (PowerShell 5.1 и 7+)
# ════════════════════════════════════════════════════════════════════
#
# Этот скрипт:
#   1. Проверяет Python 3.10+ (обходит заглушку Microsoft Store; при
#      отсутствии Python сам ставит его: winget или python.org, без админа)
#   2. Создаёт изолированное окружение в %USERPROFILE%\.transcrypt-engine
#   3. Скачивает engine_server.py, src/ и requirements-engine.txt из GitHub
#   4. Устанавливает зависимости в venv (whisper, yt-dlp, документы и т.д.)
#   5. Запускает engine_server.py на http://127.0.0.1:8765
#   6. Открывает браузер с https://maksjermy123.github.io/Transcrypt/
#   7. Настраивает автозапуск с системой (запись в реестре)
#
# Рекомендуемый запуск (окно НЕ закроется даже при ошибке):
#   iwr -useb https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/install-win.ps1 -OutFile "$env:TEMP\vpai-install.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "$env:TEMP\vpai-install.ps1"
#
# Удаление:
#   Remove-Item -Recurse -Force "$env:USERPROFILE\.transcrypt-engine"
#   Remove-ItemProperty -Path HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -Name TranscryptEngine -ErrorAction SilentlyContinue
# ════════════════════════════════════════════════════════════════════

# Ошибки НЕ роняют весь скрипт молча — обрабатываем явно
$ErrorActionPreference = "Stop"

# ─── 0. Консоль и сеть ──────────────────────────────────────────────
# UTF-8 в консоли: кириллица вместо «???» (Windows PowerShell 5.1 по умолчанию
# рисует вопросики на не-ASCII выводе)
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    chcp 65001 | Out-Null
} catch {}
# GitHub требует TLS 1.2 — на старых .NET по умолчанию выключен
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}

$RepoRaw = "https://raw.githubusercontent.com/maksjermy123/Transcrypt/main"
$RepoTarball = "https://github.com/maksjermy123/Transcrypt/archive/refs/heads/main.tar.gz"
$InstallDir = Join-Path $env:USERPROFILE ".transcrypt-engine"
$VenvDir = Join-Path $InstallDir "venv"
$EngineFile = Join-Path $InstallDir "engine_server.py"
$RequirementsFile = Join-Path $InstallDir "requirements-engine.txt"
$SrcDir = Join-Path $InstallDir "src"
$LogFile = Join-Path $InstallDir "engine.log"

function Write-Step { param([string]$msg) Write-Host "[*] $msg" -ForegroundColor Blue }
function Write-Ok   { param([string]$msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn { param([string]$msg) Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err  { param([string]$msg) Write-Host "[X] $msg" -ForegroundColor Red }

# Окно больше не «схлопывается»: на любой ошибке и в конце ждём Enter.
# (При запуске через -NoExit это просто пауза, окно останется в любом случае.)
function Wait-Enter {
    param([string]$msg = "Нажмите Enter для выхода...")
    try { Read-Host $msg | Out-Null } catch {}
}
function Exit-WithPause {
    param([int]$code = 1)
    Wait-Enter
    exit $code
}

Write-Host ""
Write-Host "======================================================"
Write-Host "   VoxPaperAi Web Engine - установка для Windows"
Write-Host "======================================================"
Write-Host ""

# ─── 1. Поиск Python 3.10+ (или его установка) ─────────────────────
# ВАЖНО: на чистой Windows `python` — это ЗАГЛУШКА Microsoft Store
# (WindowsApps\python.exe): она не запускает Python, а открывает магазин.
# Раньше из-за неё установка падала сразу после пары строк «?» и окно
# закрывалось. Теперь обходим заглушку и ставим настоящий Python сами.
function Get-RealPython {
    # py-лаунчер (ставится с python.org) — самый надёжный
    foreach ($candidate in @(@("py", "-3"), @("python3", ""), @("python", ""), @("python3.12", ""))) {
        $exe = $candidate[0]
        $arg = $candidate[1]
        try {
            $src = (Get-Command $exe -ErrorAction Stop).Source
            if ($src -like "*WindowsApps*") { continue }  # Store-заглушка
            $ver = if ($arg -ne "") { & $exe $arg --version 2>&1 } else { & $exe --version 2>&1 }
            if ("$ver" -match "Python (\d+)\.(\d+)") {
                $major = [int]$matches[1]; $minor = [int]$matches[2]
                if ($major -ge 3 -and $minor -ge 10) {
                    return @{ exe = $exe; arg = $arg; ver = "$($matches[1]).$($matches[2])" }
                }
            }
        } catch { continue }
    }
    return $null
}

function Install-Python {
    Write-Step "Python 3 не найден — устанавливаем автоматически (без прав администратора)..."
    # Способ 1: winget (есть на Windows 10 1809+ и Windows 11)
    try {
        $winget = Get-Command winget -ErrorAction Stop
        Write-Host "    winget найден: $($winget.Source)" -ForegroundColor DarkGray
        & winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -eq 0) { return $true }
        Write-Warn "winget не справился (код $LASTEXITCODE) — пробуем python.org"
    } catch {
        Write-Warn "winget не найден — пробуем python.org"
    }
    # Способ 2: официальный установщик python.org (тихая установка, per-user)
    $pyVer = "3.12.10"
    $arch = "amd64"
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $arch = "arm64" }
    $url = "https://www.python.org/ftp/python/$pyVer/python-$pyVer-$arch.exe"
    $installer = Join-Path $env:TEMP "python-$pyVer-$arch.exe"
    Write-Host "    Скачиваем Python $pyVer ($arch)..." -ForegroundColor DarkGray
    try {
        Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing -TimeoutSec 600
        Write-Host "    Устанавливаем (1-2 минуты, тихо)..." -ForegroundColor DarkGray
        $p = Start-Process -FilePath $installer -ArgumentList "/quiet", "InstallAllUsers=0", "PrependPath=1", "Include_test=0", "Include_launcher=1" -Wait -PassThru
        if ($p.ExitCode -ne 0) {
            Write-Err "Установщик Python вернул код $($p.ExitCode)"
            return $false
        }
        return $true
    } catch {
        Write-Err "Не удалось скачать/установить Python: $($_.Exception.Message)"
        return $false
    }
}

$py = Get-RealPython
if (-not $py) {
    if (Install-Python) {
        # Обновляем PATH текущей сессии (установщик меняет его только в реестре)
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
        # Явные пути установки per-user — на случай, если PATH ещё не подхватился
        $guess = Get-ChildItem "$env:LOCALAPPDATA\Programs\Python" -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | Select-Object -First 1
        if ($guess -and (Test-Path (Join-Path $guess.FullName "python.exe"))) {
            $env:Path = (Join-Path $guess.FullName) + ";" + $env:Path
        }
        $py = Get-RealPython
    }
}
if (-not $py) {
    Write-Err "Не удалось найти или установить Python 3.10+."
    Write-Host "    Установите вручную с https://www.python.org/downloads/" -ForegroundColor Gray
    Write-Host "    Обязательно отметьте 'Add Python to PATH' при установке." -ForegroundColor Gray
    Exit-WithPause 1
}
Write-Ok "Python $($py.ver) найден: $($py.exe) $($py.arg)"

# Предупреждение для Python 3.14+
$minorVer = [int]($py.ver.Split(".")[1])
if ($minorVer -ge 14) {
    Write-Warn "Python $($py.ver) — очень новая версия"
    Write-Host "    openai-whisper требует pkg_resources (удалён в setuptools 81+)." -ForegroundColor DarkGray
    Write-Host "    Мы принудительно поставим setuptools<81, но если установка упадёт —" -ForegroundColor DarkGray
    Write-Host "    установите Python 3.12 с https://www.python.org/downloads/" -ForegroundColor DarkGray
}

# ─── 2. Проверка ffmpeg (опционально) ──────────────────────────────
Write-Step "Проверка ffmpeg..."
$ffmpegFound = $false
try {
    $ffver = & ffmpeg -version 2>&1 | Select-Object -First 1
    if ("$ffver" -match "ffmpeg version") {
        Write-Ok "ffmpeg найден"
        $ffmpegFound = $true
    }
} catch {}
if (-not $ffmpegFound) {
    # ffmpeg нужен для hardsub / конвертации / очистки аудио.
    # Скачиваем статическую сборку gyan.dev в %LOCALAPPDATA%\VoxPaperAi\runtime\bin —
    # движок сам находит её там (find_ffmpeg_executable), PATH менять не нужно.
    Write-Step "ffmpeg не найден — скачиваем статический ffmpeg (~80 МБ)..."
    $FfmpegBinDir = Join-Path $env:LOCALAPPDATA "VoxPaperAi\runtime\bin"
    $TmpZip = Join-Path $env:TEMP "ffmpeg-release-essentials.zip"
    $FfOk = $false
    try {
        New-Item -ItemType Directory -Path $FfmpegBinDir -Force | Out-Null
        Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $TmpZip -UseBasicParsing -TimeoutSec 600
        $ExtractDir = Join-Path $env:TEMP "ffmpeg-extract-$(Get-Random)"
        Expand-Archive -Path $TmpZip -DestinationPath $ExtractDir -Force
        $binDir = Get-ChildItem $ExtractDir -Directory | Where-Object { Test-Path (Join-Path $_.FullName "bin\ffmpeg.exe") } | Select-Object -First 1
        if ($binDir) {
            Copy-Item (Join-Path $binDir.FullName "bin\ffmpeg.exe") $FfmpegBinDir -Force
            Copy-Item (Join-Path $binDir.FullName "bin\ffprobe.exe") $FfmpegBinDir -Force -ErrorAction SilentlyContinue
            $ffver = & (Join-Path $FfmpegBinDir "ffmpeg.exe") -version 2>&1 | Select-Object -First 1
            if ("$ffver" -match "ffmpeg version") { $FfOk = $true }
        }
        Remove-Item $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $TmpZip -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "    Скачивание не удалось: $($_.Exception.Message)" -ForegroundColor Gray
    }
    if ($FfOk) {
        Write-Ok "ffmpeg установлен: $FfmpegBinDir\ffmpeg.exe"
    } else {
        Write-Warn "ffmpeg не установлен — hardsub/конвертация будут недоступны (остальное работает)"
        Write-Host "    Установите: winget install ffmpeg" -ForegroundColor Gray
    }
}

# ─── 3. Создание директории ────────────────────────────────────────
Write-Step "Создание директории: $InstallDir"
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Write-Ok "Директория готова"

# ─── 4. Остановка старого движка ──────────────────────────────────
Get-Process pythonw -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*transcrypt-engine*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# ─── 5. Скачивание engine_server.py, src/ и requirements ──────────
Write-Step "Скачивание engine_server.py, src/ и requirements-engine.txt..."
$tmpTarball = Join-Path $InstallDir "repo.tar.gz"
$tmpExtract = Join-Path $InstallDir "_extract"

try {
    Invoke-WebRequest -Uri $RepoTarball -OutFile $tmpTarball -UseBasicParsing -TimeoutSec 600
} catch {
    Write-Err "Не удалось скачать архив репозитория. Проверьте интернет."
    Write-Host "    $($_.Exception.Message)" -ForegroundColor Gray
    Exit-WithPause 1
}

if (-not (Test-Path $tmpExtract)) {
    New-Item -ItemType Directory -Path $tmpExtract -Force | Out-Null
}

# Распаковываем tarball (Windows 10+ имеет встроенный tar)
$extractedDir = Join-Path $tmpExtract "Transcrypt-main"
$hasTar = Get-Command tar -ErrorAction SilentlyContinue
if ($hasTar) {
    cmd /c "tar -xzf `"$tmpTarball`" -C `"$tmpExtract`"" 2>&1 | Out-Null
}
if (-not (Test-Path $extractedDir)) {
    if ($hasTar) {
        Write-Err "Не удалось распаковать архив репозитория (tar)."
    } else {
        Write-Err "В системе нет tar.exe (нужен Windows 10+). Обновите систему или распакуйте вручную:"
        Write-Host "    $RepoTarball" -ForegroundColor Gray
    }
    Exit-WithPause 1
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
Remove-Item -Force $tmpTarball -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $tmpExtract -ErrorAction SilentlyContinue
Write-Ok "Файлы скачаны (engine_server.py + src/ + requirements)"

# ─── 6. Создание venv ──────────────────────────────────────────────
$venvPython  = Join-Path $VenvDir "Scripts\python.exe"
$venvPip     = Join-Path $VenvDir "Scripts\pip.exe"
$venvPythonw = Join-Path $VenvDir "Scripts\pythonw.exe"

if (-not (Test-Path $VenvDir)) {
    Write-Step "Создание виртуального окружения Python..."
    if ($py.arg -ne "") { & $py.exe $py.arg -m venv $VenvDir } else { & $py.exe -m venv $VenvDir }
    if (-not (Test-Path $venvPython)) {
        Write-Err "Не удалось создать venv (python -m venv)."
        Exit-WithPause 1
    }
    Write-Ok "venv создан"
} else {
    Write-Ok "venv уже существует"
}

# ─── 7. Установка зависимостей ────────────────────────────────────
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
    Write-Host "  3. Запустите этот установщик заново — он подхватит Python 3.12"
    Exit-WithPause 1
}
Write-Ok "Зависимости установлены"

# ─── 8. Запуск движка ──────────────────────────────────────────────
Write-Step "Запуск engine_server.py на http://127.0.0.1:8765..."

# python.exe (не pythonw) с -u — чтобы логи реально писались в файл
$LogFileErr = "$LogFile.err"
$proc = Start-Process -FilePath $venvPython -ArgumentList "-u", $EngineFile -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $LogFileErr -PassThru

# ─── 9. Проверка /api/health ───────────────────────────────────────
# Ждём до 3 минут: первый импорт torch/whisper идёт долго, порт
# начинает отвечать только после всех импортов.
Write-Step "Ожидаем ответа /api/health (первый запуск может занять 1-3 минуты)..."
$healthOk = $false
for ($i = 1; $i -le 60; $i++) {
    if ($proc.HasExited) {
        Write-Err "Движок завершился с ошибкой. Логи:"
        Get-Content $LogFile -ErrorAction SilentlyContinue | Select-Object -Last 40
        Get-Content $LogFileErr -ErrorAction SilentlyContinue | Select-Object -Last 40
        Exit-WithPause 1
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

# ─── 10. Автозапуск с системой (реестр) ────────────────────────────
Write-Step "Настраиваем автозапуск с системой (Windows Registry)..."
$autorunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$autorunValue = "TranscryptEngine"
$autorunData = "`"$venvPythonw`" `"$EngineFile`""
try {
    New-ItemProperty -Path $autorunKey -Name $autorunValue -Value $autorunData -PropertyType String -Force | Out-Null
    Write-Ok "Автозапуск настроен — движок будет стартовать при входе в систему"
} catch {
    Write-Warn "Не удалось настроить автозапуск через реестр"
    Write-Host "    Ручная настройка: Win+R -> shell:startup -> создать ярлык на:" -ForegroundColor Gray
    Write-Host "    `"$venvPythonw`" `"$EngineFile`"" -ForegroundColor Gray
}

# ─── 11. Открытие браузера ────────────────────────────────────────
Write-Step "Открываем веб-интерфейс в браузере..."
# НЕ критичный шаг: на серверных/урезанных Windows может не быть браузера
# по умолчанию — Start-Process бросает исключение и при Stop-политике
# ронял ВСЮ установку на самом последнем шаге. Оборачиваем в try/catch.
try {
    Start-Process "https://maksjermy123.github.io/Transcrypt/"
} catch {
    Write-Warn "Не удалось открыть браузер автоматически — откройте вручную:"
    Write-Host "    https://maksjermy123.github.io/Transcrypt/" -ForegroundColor Gray
}

# ─── 12. Финальное сообщение ──────────────────────────────────────
Write-Host ""
Write-Host "======================================================"
Write-Ok "Установка завершена!"
Write-Host "======================================================"
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
Write-Host "  • Старт:  `"$venvPythonw`" `"$EngineFile`""
Write-Host "  • Удалить автозапуск:"
Write-Host "    Remove-ItemProperty -Path $autorunKey -Name $autorunValue"
Write-Host "  • Полное удаление:"
Write-Host "    Remove-Item -Recurse -Force $InstallDir"
Write-Host "    Remove-ItemProperty -Path $autorunKey -Name $autorunValue"
Write-Host ""
Write-Host "Это окно можно закрыть. Движок продолжит работать в фоне."
Write-Host ""
Wait-Enter "Нажмите Enter, чтобы закрыть это окно (движок продолжит работать в фоне)"
