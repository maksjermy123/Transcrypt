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
INSTALL_DIR="$HOME/.transcrypt-engine"
VENV_DIR="$INSTALL_DIR/venv"
ENGINE_FILE="$INSTALL_DIR/engine_server.py"
REQUIREMENTS_FILE="$INSTALL_DIR/requirements-engine.txt"
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

# ─── 3. Проверка ffmpeg ───────────────────────────────────────────
print_step "Проверка ffmpeg..."
if command -v ffmpeg &> /dev/null; then
    print_ok "ffmpeg найден: $(which ffmpeg)"
else
    print_warn "ffmpeg не найден — медиа-операции не будут работать"
    echo "    Установите через:"
    echo "    Ubuntu/Debian:  sudo apt install ffmpeg"
    echo "    Fedora:         sudo dnf install ffmpeg"
    echo "    Arch:           sudo pacman -S ffmpeg"
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

# ─── 6. Скачивание файлов ────────────────────────────────────────
print_step "Скачивание engine_server.py и requirements-engine.txt..."
curl -fsSL "$REPO_RAW/engine_server.py" -o "$ENGINE_FILE"
curl -fsSL "$REPO_RAW/engine-install/requirements-engine.txt" -o "$REQUIREMENTS_FILE"
print_ok "Файлы скачаны"

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
"$VENV_DIR/bin/pip" install -r "$REQUIREMENTS_FILE" --quiet
print_ok "Зависимости установлены"

# ─── 9. Запуск движка ─────────────────────────────────────────────
print_step "Запуск engine_server.py на http://127.0.0.1:8765..."

nohup "$VENV_DIR/bin/python" "$ENGINE_FILE" > "$LOG_FILE" 2>&1 &
ENGINE_PID=$!
echo "$ENGINE_PID" > "$PID_FILE"
disown $ENGINE_PID 2>/dev/null || true

sleep 3

if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    print_err "Движок не запустился. Логи:"
    cat "$LOG_FILE"
    exit 1
fi

# Пинг /api/health
HEALTH_OK=false
for i in {1..10}; do
    if curl -fsS http://127.0.0.1:8765/api/health > /dev/null 2>&1; then
        HEALTH_OK=true
        break
    fi
    sleep 1
done

if [ "$HEALTH_OK" = true ]; then
    print_ok "Движок запущен на http://127.0.0.1:8765 (PID $ENGINE_PID)"
else
    print_err "Движок не отвечает. Логи:"
    cat "$LOG_FILE"
    exit 1
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
