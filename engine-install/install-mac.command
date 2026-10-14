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
print_step "Проверка Python 3..."
if command -v python3 &> /dev/null; then
    PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    PY_MAJOR=$(echo $PY_VERSION | cut -d. -f1)
    PY_MINOR=$(echo $PY_VERSION | cut -d. -f2)
    if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 10 ]; then
        print_ok "Python $PY_VERSION найден: $(which python3)"
    else
        print_err "Требуется Python 3.10+. Найдена версия $PY_VERSION"
        echo "    Установите Python 3.10+ с https://www.python.org/downloads/ или через brew:"
        echo "    brew install python@3.11"
        exit 1
    fi
else
    print_err "Python 3 не найден. Установите с https://www.python.org/downloads/ или:"
    echo "    brew install python@3.11"
    exit 1
fi

# ─── 2. Проверка ffmpeg (опционально, но рекомендуем) ──────────────
print_step "Проверка ffmpeg..."
if command -v ffmpeg &> /dev/null; then
    print_ok "ffmpeg найден: $(which ffmpeg)"
else
    print_warn "ffmpeg не найден — некоторые медиа-операции (конвертация, hardsub) не будут работать"
    echo "    Установите через brew: brew install ffmpeg"
    echo "    Продолжаем установку движка..."
fi

# ─── 3. Создание директории ───────────────────────────────────────
print_step "Создание директории: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
print_ok "Директория готова"

# ─── 4. Остановка старого движка если запущен ─────────────────────
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        print_step "Останавливаем старый движок (PID $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$PID_FILE"
fi

# ─── 5. Скачивание engine_server.py и requirements ────────────────
print_step "Скачивание engine_server.py и requirements-engine.txt..."
curl -fsSL "$REPO_RAW/engine_server.py" -o "$ENGINE_FILE"
curl -fsSL "$REPO_RAW/engine-install/requirements-engine.txt" -o "$REQUIREMENTS_FILE"
print_ok "Файлы скачаны"

# ─── 6. Создание venv ─────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    print_step "Создание виртуального окружения Python..."
    python3 -m venv "$VENV_DIR"
    print_ok "venv создан"
else
    print_ok "venv уже существует, переиспользуем"
fi

# ─── 7. Установка зависимостей ───────────────────────────────────
print_step "Установка зависимостей (это займёт несколько минут при первом запуске)..."
"$VENV_DIR/bin/pip" install --upgrade pip --quiet
"$VENV_DIR/bin/pip" install -r "$REQUIREMENTS_FILE" --quiet
print_ok "Зависимости установлены"

# ─── 8. Запуск движка ──────────────────────────────────────────────
print_step "Запуск engine_server.py на http://127.0.0.1:8765..."

# Запуск в фоне, логи в файл
nohup "$VENV_DIR/bin/python" "$ENGINE_FILE" > "$LOG_FILE" 2>&1 &
ENGINE_PID=$!
echo "$ENGINE_PID" > "$PID_FILE"

# Ждём пока поднимется
sleep 3

# Проверяем живой ли процесс
if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    print_err "Движок не запустился. Логи:"
    cat "$LOG_FILE"
    exit 1
fi

# Пингуем /api/health
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
    print_err "Движок не отвечает на /api/health. Логи:"
    cat "$LOG_FILE"
    exit 1
fi

# ─── 9. Открытие браузера ─────────────────────────────────────────
print_step "Открываем веб-интерфейс в браузере..."
sleep 1
open "https://maksjermy123.github.io/Transcrypt/"

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
echo "  • Стоп:   kill \$(cat $PID_FILE)"
echo "  • Старт:  $VENV_DIR/bin/python $ENGINE_FILE"
echo "  • Удалить: rm -rf $INSTALL_DIR"
echo ""
echo "Это окно можно закрыть. Движок продолжит работать в фоне."
echo ""

# Держим окно открытым 5 секунд для прочтения
sleep 5
