#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# Transcrypt Web Engine — Установщик для macOS
# ════════════════════════════════════════════════════════════════════
#
# Этот скрипт:
#   1. Проверяет наличие Python 3
#   2. Создаёт изолированное окружение в ~/.transcrypt-engine
#   3. Скачивает engine_server.py и requirements-engine.txt из GitHub
#   4. Устанавливает зависимости в venv (whisper, yt-dlp, ffmpeg-python, curl-cffi)
#   5. Запускает engine_server.py на http://127.0.0.1:8765
#   6. Открывает браузер с https://maksjermy123.github.io/Transcrypt/
#
# Запуск: двойной клик по этому файлу в Finder
# Или через терминал: bash install-mac.command
#
# Удаление: rm -rf ~/.transcrypt-engine
# ════════════════════════════════════════════════════════════════════

set -e

# Можно переопределить Python: TRANSCRYPT_PYTHON=python3.12 bash install-mac.command
PYTHON_BIN="${TRANSCRYPT_PYTHON:-python3}"

REPO_RAW="https://raw.githubusercontent.com/maksjermy123/Transcrypt/main"
REPO_TARBALL="https://github.com/maksjermy123/Transcrypt/archive/refs/heads/main.tar.gz"
INSTALL_DIR="$HOME/.transcrypt-engine"
VENV_DIR="$INSTALL_DIR/venv"
ENGINE_FILE="$INSTALL_DIR/engine_server.py"
REQUIREMENTS_FILE="$INSTALL_DIR/requirements-engine.txt"
SRC_DIR="$INSTALL_DIR/src"
PID_FILE="$INSTALL_DIR/engine.pid"
LOG_FILE="$INSTALL_DIR/engine.log"

# Цветной вывод
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() { echo -e "${BLUE}▸ $1${NC}"; }
print_ok()   { echo -e "${GREEN}✓ $1${NC}"; }
print_warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_err()  { echo -e "${RED}✗ $1${NC}"; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "   Transcrypt Web Engine — Установка для macOS"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── 1. Проверка Python 3 ─────────────────────────────────────────
print_step "Проверка Python 3 ($PYTHON_BIN)..."
if command -v "$PYTHON_BIN" &> /dev/null; then
    PY_VERSION=$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PY_MAJOR=$(echo $PY_VERSION | cut -d. -f1)
    PY_MINOR=$(echo $PY_VERSION | cut -d. -f2)
    if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 10 ]; then
        print_ok "Python $PY_VERSION найден: $(which "$PYTHON_BIN")"
        # Предупреждение для Python 3.14+ — openai-whisper может не собраться
        if [ "$PY_MINOR" -ge 14 ]; then
            print_warn "Python $PY_VERSION — очень новая версия"
            echo "    openai-whisper требует pkg_resources (удалён в setuptools 81+)."
            echo "    Мы принудительно установим setuptools<81, но если установка"
            echo "    всё равно упадёт — поставьте Python 3.12 через brew:"
            echo "      brew install python@3.12"
            echo "    и запустите установщик снова с этим Python:"
            echo "      TRANSCRYPT_PYTHON=python3.12 bash -c \"\$(curl -fsSL $REPO_RAW/engine-install/install-mac.command)\""
            echo "    Продолжаем установку..."
        fi
    else
        print_err "Требуется Python 3.10+. Найдена версия $PY_VERSION"
        echo "    Установите Python 3.10+ с https://www.python.org/downloads/ или через brew:"
        echo "    brew install python@3.11"
        exit 1
    fi
else
    print_err "Python 3 не найден (искали: $PYTHON_BIN). Установите с https://www.python.org/downloads/ или:"
    echo "    brew install python@3.11"
    exit 1
fi

# ─── 2. Проверка ffmpeg — при отсутствии скачиваем статический ──────
print_step "Проверка ffmpeg..."
if command -v ffmpeg &> /dev/null; then
    print_ok "ffmpeg найден: $(which ffmpeg)"
else
    # ffmpeg нужен для hardsub / конвертации / очистки аудио.
    # Скачиваем статическую сборку в Application Support/VoxPaperAi/runtime/bin —
    # движок сам находит её там (find_ffmpeg_executable), PATH менять не нужно.
    FFMPEG_BIN_DIR="$HOME/Library/Application Support/VoxPaperAi/runtime/bin"
    TMPFF="$(mktemp -d)"
    ARCH="$(uname -m)"
    print_step "ffmpeg не найден — скачиваем статический ffmpeg (~40 МБ, архитектура: $ARCH)..."
    mkdir -p "$FFMPEG_BIN_DIR"
    FF_OK=0
    if [ "$ARCH" = "arm64" ]; then
        # Нативная сборка для Apple Silicon (osxexperts), фолбэк — evermeet (Intel + Rosetta)
        if curl -fsSL --max-time 300 "https://www.osxexperts.net/FFmpeg7ARM.zip" -o "$TMPFF/ffmpeg.zip" 2>/dev/null \
           && unzip -o -q "$TMPFF/ffmpeg.zip" -d "$FFMPEG_BIN_DIR" 2>/dev/null; then
            FF_OK=1
        fi
        if [ "$FF_OK" = "1" ]; then
            # ffprobe отдельным архивом; если не выйдет — не критично (прогресс hardsub без ETA)
            curl -fsSL --max-time 180 "https://www.osxexperts.net/FFprobe7ARM.zip" -o "$TMPFF/ffprobe.zip" 2>/dev/null \
                && unzip -o -q "$TMPFF/ffprobe.zip" -d "$FFMPEG_BIN_DIR" 2>/dev/null || true
        else
            if curl -fsSL --max-time 300 "https://evermeet.cx/ffmpeg/get/ffmpeg.zip" -o "$TMPFF/ffmpeg.zip" 2>/dev/null \
               && unzip -o -q "$TMPFF/ffmpeg.zip" -d "$FFMPEG_BIN_DIR" 2>/dev/null \
               && curl -fsSL --max-time 180 "https://evermeet.cx/ffmpeg/get/ffprobe.zip" -o "$TMPFF/ffprobe.zip" 2>/dev/null \
               && unzip -o -q "$TMPFF/ffprobe.zip" -d "$FFMPEG_BIN_DIR" 2>/dev/null; then
                FF_OK=1
            fi
        fi
    else
        if curl -fsSL --max-time 300 "https://evermeet.cx/ffmpeg/get/ffmpeg.zip" -o "$TMPFF/ffmpeg.zip" 2>/dev/null \
           && unzip -o -q "$TMPFF/ffmpeg.zip" -d "$FFMPEG_BIN_DIR" 2>/dev/null \
           && curl -fsSL --max-time 180 "https://evermeet.cx/ffmpeg/get/ffprobe.zip" -o "$TMPFF/ffprobe.zip" 2>/dev/null \
           && unzip -o -q "$TMPFF/ffprobe.zip" -d "$FFMPEG_BIN_DIR" 2>/dev/null; then
            FF_OK=1
        fi
    fi
    chmod +x "$FFMPEG_BIN_DIR/ffmpeg" "$FFMPEG_BIN_DIR/ffprobe" 2>/dev/null || true
    rm -rf "$TMPFF"
    if [ "$FF_OK" = "1" ] && "$FFMPEG_BIN_DIR/ffmpeg" -version &> /dev/null; then
        print_ok "ffmpeg установлен: $FFMPEG_BIN_DIR/ffmpeg"
    elif command -v brew &> /dev/null; then
        print_warn "Скачивание не удалось — пробуем brew install ffmpeg (может занять время)..."
        if brew install ffmpeg &> /dev/null; then
            print_ok "ffmpeg установлен через Homebrew"
        else
            print_warn "ffmpeg не установлен — hardsub/конвертация будут недоступны (остальное работает)"
        fi
    else
        print_warn "ffmpeg не установлен — hardsub/конвертация будут недоступны (остальное работает)"
        echo "    Установите вручную: brew install ffmpeg"
    fi
    echo "    Продолжаем установку движка..."
fi

# ─── 3. Создание директории ───────────────────────────────────────
print_step "Создание директории: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
print_ok "Директория готова"

# ─── 4. Остановка старого движка если запущен ─────────────────────
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_FILE="$LAUNCH_AGENT_DIR/com.transcrypt.engine.plist"

# Сначала останавливаем экземпляр под управлением launchd (если был)
if [ -f "$LAUNCH_AGENT_FILE" ]; then
    launchctl unload "$LAUNCH_AGENT_FILE" 2>/dev/null || true
fi

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        print_step "Останавливаем старый движок (PID $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$PID_FILE"
fi

# ─── 5. Скачивание engine_server.py, src/ и requirements ───────────
print_step "Скачивание engine_server.py, src/ и requirements-engine.txt..."
# Скачиваем tarball всего репо, распаковываем во временную папку
TMP_TARBALL="$INSTALL_DIR/repo.tar.gz"
TMP_EXTRACT="$INSTALL_DIR/_extract"
curl -fsSL "$REPO_TARBALL" -o "$TMP_TARBALL"
mkdir -p "$TMP_EXTRACT"
tar -xzf "$TMP_TARBALL" -C "$TMP_EXTRACT"

# Внутри tarball директория называется Transcrypt-main/
EXTRACTED="$TMP_EXTRACT/Transcrypt-main"
if [ ! -d "$EXTRACTED" ]; then
    print_err "Не удалось распаковать репозиторий"
    exit 1
fi

# Копируем нужные файлы
cp "$EXTRACTED/engine_server.py" "$ENGINE_FILE"
cp "$EXTRACTED/engine-install/requirements-engine.txt" "$REQUIREMENTS_FILE"
# Копируем весь каталог src/ — engine_server.py импортирует из него
if [ -d "$SRC_DIR" ]; then
    rm -rf "$SRC_DIR"
fi
cp -r "$EXTRACTED/src" "$SRC_DIR"

# Чистим временные файлы
rm -f "$TMP_TARBALL"
rm -rf "$TMP_EXTRACT"
print_ok "Файлы скачаны (engine_server.py + src/ + requirements)"

# ─── 6. Создание venv ─────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    print_step "Создание виртуального окружения Python..."
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    print_ok "venv создан"
else
    print_ok "venv уже существует, переиспользуем"
fi

# ─── 7. Установка зависимостей ───────────────────────────────────
# Intel Mac (x86_64): свежие torch (2.3+) собираются только под Apple Silicon,
# последняя версия с колесами для macOS x86_64 — 2.2.2. Ставим её ПЕРЕД
# requirements, иначе pip упадёт «No matching distribution for torch».
ARCH="$(uname -m)"
if [ "$ARCH" != "arm64" ]; then
    print_step "MacBook Intel ($ARCH): ставим torch 2.2.2 (последняя с поддержкой x86_64 macOS)..."
    if "$VENV_DIR/bin/pip" install "torch==2.2.2" --quiet --no-cache-dir; then
        print_ok "torch 2.2.2 установлен (Intel)"
    else
        print_warn "torch 2.2.2 не установился — pip попробует сам найти совместимую версию"
    fi
fi

print_step "Установка зависимостей (это займёт несколько минут при первом запуске)..."
"$VENV_DIR/bin/pip" install --upgrade pip --quiet
# ВАЖНО: сначала отдельно setuptools<81, потом остальные пакеты.
# openai-whisper требует pkg_resources (удалён в setuptools 81+).
"$VENV_DIR/bin/pip" install "setuptools<81" --quiet

# Установка остальных зависимостей с подробным выводом при ошибке
if ! "$VENV_DIR/bin/pip" install -r "$REQUIREMENTS_FILE" --quiet --no-cache-dir; then
    print_err "Не удалось установить зависимости."
    echo ""
    echo "Если у вас Python 3.14+ — openai-whisper может не собраться."
    echo "Рекомендуется установить Python 3.12 через brew:"
    echo ""
    echo "  brew install python@3.12"
    echo "  rm -rf $VENV_DIR"
    echo "  python3.12 -m venv $VENV_DIR"
    echo "  $VENV_DIR/bin/pip install --upgrade pip"
    echo "  $VENV_DIR/bin/pip install \"setuptools<81\""
    echo "  $VENV_DIR/bin/pip install -r $REQUIREMENTS_FILE"
    echo ""
    echo "Затем запустите установщик снова — он использует обновлённый venv."
    exit 1
fi
print_ok "Зависимости установлены"

# ─── 8. Запуск движка ──────────────────────────────────────────────
print_step "Запуск engine_server.py на http://127.0.0.1:8765..."

# Запуск в фоне, логи в файл (-u — небуферизованный вывод: логи видны сразу)
nohup "$VENV_DIR/bin/python" -u "$ENGINE_FILE" > "$LOG_FILE" 2>&1 &
ENGINE_PID=$!
echo "$ENGINE_PID" > "$PID_FILE"

# Ждём подъёма ДО 3 МИНУТ: первый импорт torch/whisper идёт долго,
# особенно на Python 3.14. Порт начинает отвечать только после всех импортов.
print_step "Ожидаем ответа /api/health (первый запуск может занять 1–3 минуты)..."
HEALTH_OK=false
for i in $(seq 1 180); do
    # Процесс умер — реальная ошибка, показываем лог и выходим
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
        print_err "Движок завершился с ошибкой. Логи:"
        tail -40 "$LOG_FILE" 2>/dev/null
        echo ""
        echo "Если ошибка связана с pkg_resources/whisper — установите Python 3.12:"
        echo "  brew install python@3.12"
        echo "  rm -rf $VENV_DIR"
        echo "  и запустите установщик снова:"
        echo "  TRANSCRYPT_PYTHON=python3.12 bash -c \"\$(curl -fsSL $REPO_RAW/engine-install/install-mac.command)\""
        exit 1
    fi
    if curl -fsS http://127.0.0.1:8765/api/health > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    # Прогресс каждые 15 секунд, чтобы пользователь видел, что установка жива
    if [ $((i % 15)) -eq 0 ]; then
        print_warn "Движок ещё импортирует библиотеки... (${i} сек)"
    fi
    sleep 1
done

if [ "$HEALTH_OK" = true ]; then
    print_ok "Движок запущен на http://127.0.0.1:8765 (PID $ENGINE_PID)"
else
    # Процесс жив, но за 3 минуты так и не ответил — НЕ роняем установку:
    # он, вероятно, поднимется через минуту (медленный диск/антivirus). Продолжаем.
    print_warn "Движок пока не отвечает, но процесс работает (PID $ENGINE_PID)."
    echo "    Он автоматически станет доступен через пару минут — индикатор на"
    echo "    сайте позеленеет сам. Лог: tail -f $LOG_FILE"
fi

# ─── 9. Открытие браузера ─────────────────────────────────────────
print_step "Открываем веб-интерфейс в браузере..."
sleep 1
open "https://maksjermy123.github.io/Transcrypt/"

# ─── 9.5. Автозапуск с системой (LaunchAgent) ────────────────────
print_step "Настраиваем автозапуск с системой (LaunchAgent)..."
mkdir -p "$LAUNCH_AGENT_DIR"

# Создаём plist файл для LaunchAgent — macOS запустит движок при логине
cat > "$LAUNCH_AGENT_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.transcrypt.engine</string>
    <key>ProgramArguments</key>
    <array>
        <string>$VENV_DIR/bin/python</string>
        <string>$ENGINE_FILE</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
</dict>
</plist>
EOF

# НЕ грузим агент немедленно: движок уже работает (nohup), а повторный
# запуск через launchd упёрся бы в занятый порт. macOS сам подхватит
# plist из ~/Library/LaunchAgents при следующем входе в систему.
print_ok "LaunchAgent создан — движок будет стартовать при входе в систему"

# ─── 10. Финальное сообщение ──────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}✓ Установка завершена!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Локальный движок запущен на http://127.0.0.1:8765"
echo "Веб-интерфейс открыт в браузере."
echo ""
echo "На веб-странице:"
echo "  1. Пройдите онбординг (если ещё не пройден)"
echo "  2. Индикатор в шапке должен быть зелёным — «Движок online»"
echo "  3. Теперь доступны URL-задачи (YouTube, TikTok, Instagram)"
echo ""
echo "Управление движком:"
echo "  • Лог:    tail -f $LOG_FILE"
echo "  • Стоп:   launchctl unload $LAUNCH_AGENT_FILE"
echo "  • Старт:  launchctl load $LAUNCH_AGENT_FILE"
echo "  • Удалить автозапуск: rm $LAUNCH_AGENT_FILE"
echo "  • Полное удаление:    rm -rf $INSTALL_DIR && rm $LAUNCH_AGENT_FILE"
echo ""
echo "Это окно можно закрыть. Движок продолжит работать в фоне."
echo ""

# Держим окно открытым 5 секунд для прочтения
sleep 5
