#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# Transcrypt Web Engine — Удаление для macOS
# ════════════════════════════════════════════════════════════════════
#
# Этот скрипт ПОЛНОСТЬЮ удаляет локальный движок Transcrypt:
#   1. Останавливает запущенный движок (LaunchAgent + kill)
#   2. Удаляет LaunchAgent (автозапуск с системой)
#   3. Удаляет директорию ~/.transcrypt-engine (venv ~800 МБ + engine_server.py + src/)
#   4. Останавливает все процессы python, запущенные из ~/.transcrypt-engine/
#
# Запуск (одной командой из Terminal):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-mac.command)"
#
# Браузер после этого остаётся работать — доступна только транскрипция
# локальных файлов через браузерный Whisper.
# ════════════════════════════════════════════════════════════════════

set -e

INSTALL_DIR="$HOME/.transcrypt-engine"
LAUNCH_AGENT_FILE="$HOME/Library/LaunchAgents/com.transcrypt.engine.plist"
VENV_DIR="$INSTALL_DIR/venv"

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
echo "   Transcrypt Web Engine — Удаление для macOS"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Это действие НЕЛЬЗЯ отменить. Будет удалено:"
echo "  • ~/.transcrypt-engine/ (venv + Whisper ~800 МБ + src/)"
echo "  • ~/Library/LaunchAgents/com.transcrypt.engine.plist"
echo "  • Запущенные процессы движка"
echo ""
read -p "Продолжить удаление? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Отменено пользователем."
    exit 0
fi
echo ""

# ─── 1. Остановка LaunchAgent ────────────────────────────────────
print_step "Останавливаем LaunchAgent (автозапуск)…"
if [ -f "$LAUNCH_AGENT_FILE" ]; then
    launchctl unload "$LAUNCH_AGENT_FILE" 2>/dev/null || true
    rm -f "$LAUNCH_AGENT_FILE"
    print_ok "LaunchAgent удалён"
else
    print_ok "LaunchAgent не найден (видимо, уже удалён)"
fi

# ─── 2. Остановка запущенных процессов движка ─────────────────────
print_step "Останавливаем запущенные процессы движка…"
# Убиваем все процессы python, чья командная строка содержит путь к engine_server.py
if [ -d "$INSTALL_DIR" ]; then
    pkill -f "$INSTALL_DIR/engine_server.py" 2>/dev/null && print_ok "Процессы движка остановлены" || print_ok "Активных процессов движка не найдено"
fi

# ─── 3. Удаление директории ────────────────────────────────────────
print_step "Удаляем директорию: $INSTALL_DIR"
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    print_ok "Директория удалена (~800 МБ освобождено)"
else
    print_ok "Директория не найдена (видимо, уже удалена)"
fi

# ─── 4. Проверка что движок действительно недоступен ───────────────
print_step "Проверяем что движок остановлен…"
sleep 1
if curl -fsS http://127.0.0.1:8765/api/health > /dev/null 2>&1; then
    print_warn "Движок всё ещё отвечает на 127.0.0.1:8765"
    echo "    Возможно, он был запущен вручную. Найдите и остановите:"
    echo "      ps aux | grep engine_server"
    echo "      kill <PID>"
else
    print_ok "Движок полностью остановлен"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}✓ Удаление завершено!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Что осталось на компьютере:"
echo "  • Python (ставился Homebrew/системно — не трогаем)"
echo "  • ffmpeg (если был установлен через brew — не трогаем)"
echo "  • Браузерный Whisper в кеше браузера (в IndexedDB)"
echo "  • Настройки сайта в localStorage браузера"
echo ""
echo "Чтобы использовать Transcrypt снова — просто откройте:"
echo "  https://maksjermy123.github.io/Transcrypt/"
echo "Браузерный Whisper работает без установки."
echo ""
echo "Чтобы снова установить локальный движок — запустите команду"
echo "установки на сайте (кнопка «Установить движок»)."
echo ""
