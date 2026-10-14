#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# Transcrypt Web Engine — Удаление для Linux
# ════════════════════════════════════════════════════════════════════
#
# Этот скрипт ПОЛНОСТЬЮ удаляет локальный движок Transcrypt:
#   1. Останавливает systemd user unit + disables его
#   2. Удаляет systemd unit
#   3. Удаляет директорию ~/.transcrypt-engine (venv + engine_server.py + src/)
#   4. Убивает запущенные процессы движка
#
# Запуск (одной командой из терминала):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-linux.sh)"
# ════════════════════════════════════════════════════════════════════

set -e

INSTALL_DIR="$HOME/.transcrypt-engine"
SYSTEMD_UNIT_FILE="$HOME/.config/systemd/user/transcrypt-engine.service"

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
echo "   Transcrypt Web Engine — Удаление для Linux"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Это действие НЕЛЬЗЯ отменить. Будет удалено:"
echo "  • ~/.transcrypt-engine/ (venv + Whisper ~800 МБ + src/)"
echo "  • ~/.config/systemd/user/transcrypt-engine.service"
echo "  • Запущенные процессы движка"
echo ""
read -p "Продолжить удаление? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Отменено пользователем."
    exit 0
fi
echo ""

# ─── 1. Остановка systemd unit ────────────────────────────────────
print_step "Останавливаем systemd unit…"
if [ -f "$SYSTEMD_UNIT_FILE" ]; then
    systemctl --user stop transcrypt-engine.service 2>/dev/null || true
    systemctl --user disable transcrypt-engine.service 2>/dev/null || true
    rm -f "$SYSTEMD_UNIT_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
    print_ok "systemd unit удалён и disabled"
else
    print_ok "systemd unit не найден"
fi

# ─── 2. Остановка запущенных процессов движка ─────────────────────
print_step "Останавливаем запущенные процессы движка…"
if [ -d "$INSTALL_DIR" ]; then
    pkill -f "$INSTALL_DIR/engine_server.py" 2>/dev/null && print_ok "Процессы движка остановлены" || print_ok "Активных процессов движка не найдено"
fi

# ─── 3. Удаление директории ────────────────────────────────────────
print_step "Удаляем директорию: $INSTALL_DIR"
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    print_ok "Директория удалена (~800 МБ освобождено)"
else
    print_ok "Директория не найдена"
fi

# ─── 4. Проверка ──────────────────────────────────────────────────
print_step "Проверяем что движок остановлен…"
sleep 1
if curl -fsS http://127.0.0.1:8765/api/health > /dev/null 2>&1; then
    print_warn "Движок всё ещё отвечает на 127.0.0.1:8765"
    echo "    Найдите и остановите вручную:"
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
echo "Что осталось:"
echo "  • Python (ставился через apt/dnf/pacman — не трогаем)"
echo "  • ffmpeg (если был установлен — не трогаем)"
echo "  • Браузерный Whisper в кеше браузера"
echo "  • Настройки сайта в localStorage браузера"
echo ""
echo "Чтобы снова использовать Transcrypt: https://maksjermy123.github.io/Transcrypt/"
echo "Браузерный Whisper работает без установки."
echo ""
