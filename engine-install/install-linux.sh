#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# Transcrypt Web Engine — Установщик для Linux
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
# Запуск: bash install-linux.sh
# Удаление: rm -rf ~/.transcrypt-engine
# ════════════════════════════════════════════════════════════════════

set -e

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
NC='\033[0m'

print_step() { echo -e "${BLUE}▸ $1${NC}"; }
print_ok()   { echo -e "${GREEN}✓ $1${NC}"; }
print_warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_err()  { echo -e "${RED}✗ $1${NC}"; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "   Transcrypt Web Engine — Установка для Linux"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── 1. Проверка Python 3 ─────────────────────────────────────────
print_step "Проверка Python 3..."
if command -v python3 &> /dev/null; then
    PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PY_MAJOR=$(echo $PY_VERSION | cut -d. -f1)
    PY_MINOR=$(echo $PY_VERSION | cut -d. -f2)
    if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 10 ]; then
        print_ok "Python $PY_VERSION найден: $(which python3)"
        # Предупреждение для Python 3.14+ — openai-whisper может не собраться
        if [ "$PY_MINOR" -ge 14 ]; then
            print_warn "Python $PY_VERSION — очень новая версия"
            echo "    openai-whisper требует pkg_resources (удалён в setuptools 81+)."
            echo "    Мы принудительно установим setuptools<81, но если установка"
            echo "    всё равно упадёт — установите Python 3.12:"
            echo "      Ubuntu/Debian: sudo apt install python3.12 python3.12-venv"
            echo "      Fedora:         sudo dnf install python3.12"
            echo "      Arch:           sudo pacman -S python"  # Arch всегда последний
            echo "    Продолжаем установку..."
        fi
    else
        print_err "Требуется Python 3.10+. Найдена версия $PY_VERSION"
        echo "    Установите через пакетный менеджер вашего дистрибутива:"
        echo "    Ubuntu/Debian:  sudo apt install python3 python3-venv python3-pip"
        echo "    Fedora:         sudo dnf install python3"
        echo "    Arch:           sudo pacman -S python"
        exit 1
    fi
else
    print_err "Python 3 не найден. Установите через:"
    echo "    Ubuntu/Debian:  sudo apt install python3 python3-venv python3-pip"
    echo "    Fedora:         sudo dnf install python3"
    echo "    Arch:           sudo pacman -S python"
    exit 1
fi

# ─── 2. Проверка venv модуля ──────────────────────────────────────
print_step "Проверка модуля venv..."
if ! python3 -c "import venv" &> /dev/null; then
    print_err "Модуль venv не найден. Установите python3-venv:"
    echo "    Ubuntu/Debian:  sudo apt install python3-venv"
    exit 1
fi
print_ok "venv доступен"

# ─── 3. Проверка ffmpeg — при отсутствии скачиваем статический ────
print_step "Проверка ffmpeg..."
if command -v ffmpeg &> /dev/null; then
    print_ok "ffmpeg найден: $(which ffmpeg)"
else
    # Скачиваем статическую сборку johnvansickle в ~/.local/share/VoxPaperAi/runtime/bin —
    # движок сам находит её там (find_ffmpeg_executable), sudo и apt не нужны
    FFMPEG_BIN_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/VoxPaperAi/runtime/bin"
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64)  FF_TARBALL="ffmpeg-release-amd64-static.tar.xz" ;;
        aarch64|arm64) FF_TARBALL="ffmpeg-release-arm64-static.tar.xz" ;;
        *)       FF_TARBALL="" ;;
    esac
    print_step "ffmpeg не найден — скачиваем статический ffmpeg (~35 МБ, $ARCH)..."
    FF_OK=0
    if [ -n "$FF_TARBALL" ]; then
        TMPFF="$(mktemp -d)"
        if curl -fsSL --max-time 600 "https://johnvansickle.com/ffmpeg/releases/${FF_TARBALL}" -o "$TMPFF/ff.tar.xz" 2>/dev/null \
           && tar -xf "$TMPFF/ff.tar.xz" -C "$TMPFF" 2>/dev/null; then
            mkdir -p "$FFMPEG_BIN_DIR"
            find "$TMPFF" -type d -name "ffmpeg-*-static" | head -1 | while read -r SRC; do
                cp "$SRC/ffmpeg" "$SRC/ffprobe" "$FFMPEG_BIN_DIR/" 2>/dev/null
            done
            chmod +x "$FFMPEG_BIN_DIR/ffmpeg" "$FFMPEG_BIN_DIR/ffprobe" 2>/dev/null || true
            [ -x "$FFMPEG_BIN_DIR/ffmpeg" ] && FF_OK=1
        fi
        rm -rf "$TMPFF"
    fi
    if [ "$FF_OK" = "1" ] && "$FFMPEG_BIN_DIR/ffmpeg" -version &> /dev/null; then
        print_ok "ffmpeg установлен: $FFMPEG_BIN_DIR/ffmpeg"
    elif command -v apt-get &> /dev/null || command -v dnf &> /dev/null || command -v pacman &> /dev/null; then
        print_warn "Скачивание не удалось — попробуйте установить пакет вручную:"
        echo "    Ubuntu/Debian:  sudo apt install ffmpeg"
        echo "    Fedora:         sudo dnf install ffmpeg"
        echo "    Arch:           sudo pacman -S ffmpeg"
        print_warn "Без ffmpeg hardsub/конвертация будут недоступны (остальное работает)"
    else
        print_warn "ffmpeg не установлен — hardsub/конвертация будут недоступны (остальное работает)"
    fi
fi

# ─── 4. Создание директории ───────────────────────────────────────
print_step "Создание директории: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
print_ok "Директория готова"

# ─── 5. Остановка старого движка ──────────────────────────────────
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        print_step "Останавливаем старый движок (PID $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$PID_FILE"
fi

# ─── 6. Скачивание engine_server.py, src/ и requirements ───────────
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

# ─── 7. Создание venv ─────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    print_step "Создание виртуального окружения Python..."
    python3 -m venv "$VENV_DIR"
    print_ok "venv создан"
else
    print_ok "venv уже существует, переиспользуем"
fi

# ─── 8. Установка зависимостей ───────────────────────────────────
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
    echo "Рекомендуется установить Python 3.12:"
    echo ""
    echo "  Ubuntu/Debian: sudo apt install python3.12 python3.12-venv"
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

# ─── 9. Запуск движка ─────────────────────────────────────────────
print_step "Запуск engine_server.py на http://127.0.0.1:8765..."

nohup "$VENV_DIR/bin/python" -u "$ENGINE_FILE" > "$LOG_FILE" 2>&1 &
ENGINE_PID=$!
echo "$ENGINE_PID" > "$PID_FILE"
disown $ENGINE_PID 2>/dev/null || true

# Ждём подъёма до 3 минут: первый импорт torch/whisper идёт долго,
# порт начинает отвечать только после всех импортов.
print_step "Ожидаем ответа /api/health (первый запуск может занять 1–3 минуты)..."
HEALTH_OK=false
for i in $(seq 1 180); do
    if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
        print_err "Движок завершился с ошибкой. Логи:"
        tail -40 "$LOG_FILE" 2>/dev/null
        exit 1
    fi
    if curl -fsS http://127.0.0.1:8765/api/health > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    if [ $((i % 15)) -eq 0 ]; then
        print_warn "Движок ещё импортирует библиотеки... (${i} сек)"
    fi
    sleep 1
done

if [ "$HEALTH_OK" = true ]; then
    print_ok "Движок запущен на http://127.0.0.1:8765 (PID $ENGINE_PID)"
else
    # Процесс жив, но долго не отвечает — не роняем установку:
    # движок поднимется чуть позже и индикатор на сайте позеленеет сам.
    print_warn "Движок пока не отвечает, но процесс работает (PID $ENGINE_PID)."
    echo "    Он автоматически станет доступен через пару минут."
    echo "    Лог: tail -f $LOG_FILE"
fi

# ─── 10. Открытие браузера ────────────────────────────────────────
print_step "Открываем веб-интерфейс в браузере..."
sleep 1
if command -v xdg-open &> /dev/null; then
    xdg-open "https://maksjermy123.github.io/Transcrypt/" &> /dev/null &
elif command -v sensible-browser &> /dev/null; then
    sensible-browser "https://maksjermy123.github.io/Transcrypt/" &> /dev/null &
else
    print_warn "Не удалось открыть браузер автоматически. Откройте вручную: https://maksjermy123.github.io/Transcrypt/"
fi

# ─── 10.5. Автозапуск с системой (systemd user unit) ─────────────
print_step "Настраиваем автозапуск с системой (systemd user unit)..."
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
SYSTEMD_UNIT_FILE="$SYSTEMD_USER_DIR/transcrypt-engine.service"
mkdir -p "$SYSTEMD_USER_DIR"

# Создаём systemd unit
cat > "$SYSTEMD_UNIT_FILE" << EOF
[Unit]
Description=Transcrypt Web Engine (local Python server)
After=network.target

[Service]
Type=simple
ExecStart=$VENV_DIR/bin/python $ENGINE_FILE
WorkingDirectory=$INSTALL_DIR
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

# Активируем и запускаем systemd unit
systemctl --user daemon-reload 2>/dev/null || true
systemctl --user enable transcrypt-engine.service 2>/dev/null || true
print_ok "systemd unit создан и включён — движок будет стартовать при входе в систему"

# ─── 11. Финальное сообщение ───────────────────────────────────────
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
echo "  • Стоп:   systemctl --user stop transcrypt-engine"
echo "  • Старт:  systemctl --user start transcrypt-engine"
echo "  • Удалить автозапуск: systemctl --user disable transcrypt-engine && rm $SYSTEMD_UNIT_FILE"
echo "  • Полное удаление:    rm -rf $INSTALL_DIR && rm $SYSTEMD_UNIT_FILE"
echo ""
