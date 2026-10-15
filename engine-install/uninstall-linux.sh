#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Transcrypt — ПОЛНОЕ удаление с компьютера (Linux)
#
#  Запуск:
#    bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-linux.sh)"
#
#  Что удаляет:
#    1. Автозапуск: systemd user unit transcrypt-engine.service
#    2. Папку движка: ~/.transcrypt-engine (venv, engine_server.py, src, логи)
#    3. Данные программы: ~/.local/share/VoxPaperAi
#       (модели Whisper, скачанный ffmpeg, результаты, журнал задач)
#    4. Кеш OpenAI Whisper ~/.cache/whisper (если есть)
#    5. Останавливает работающие процессы движка
#
#  Кеш браузерного Whisper очищается кнопкой в Настройках сайта.
# ═══════════════════════════════════════════════════════════════

set -u

INSTALL_DIR="$HOME/.transcrypt-engine"
APP_SUPPORT="${XDG_DATA_HOME:-$HOME/.local/share}/VoxPaperAi"
UNIT_FILE="$HOME/.config/systemd/user/transcrypt-engine.service"

G='\033[1;32m'; Y='\033[1;33m'; B='\033[1;36m'; N='\033[0m'
step() { echo -e "${B}▸${N} $1"; }
ok()   { echo -e "${G}✓${N} $1"; }

echo ""
echo -e "${B}═══════════════════════════════════════════════════${N}"
echo -e "${B}  Transcrypt — полное удаление с компьютера (Linux)${N}"
echo -e "${B}═══════════════════════════════════════════════════${N}"
echo ""

FREED=0
dir_size_mb() {
    if [ -d "$1" ]; then du -sm "$1" 2>/dev/null | cut -f1 | tr -d ' '; else echo 0; fi
}

# ─── 1. Остановка ────────────────────────────────────────────────
step "1/5 Останавливаем движок..."
if command -v systemctl &> /dev/null; then
    systemctl --user stop transcrypt-engine.service &> /dev/null && ok "systemd unit остановлен" || ok "Unit не запущен"
fi
pkill -f "$INSTALL_DIR/engine_server.py" 2>/dev/null && ok "Процесс движка остановлен" || ok "Процессы движка не запущены"
pkill -f "engine_server.py" 2>/dev/null || true
sleep 1

# ─── 2. Автозапуск ────────────────────────────────────────────────
step "2/5 Удаляем автозапуск (systemd user unit)..."
if [ -f "$UNIT_FILE" ]; then
    systemctl --user disable transcrypt-engine.service &> /dev/null || true
    rm -f "$UNIT_FILE"
    systemctl --user daemon-reload &> /dev/null || true
    systemctl --user reset-failed &> /dev/null || true
    ok "Удалён: $UNIT_FILE"
else
    ok "Unit не найден (уже удалён)"
fi

# ─── 3. Папка движка ─────────────────────────────────────────────
step "3/5 Удаляем папку движка..."
SIZE=$(dir_size_mb "$INSTALL_DIR")
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    FREED=$((FREED + SIZE))
    ok "Удалена: $INSTALL_DIR (освобождено ${SIZE} МБ)"
else
    ok "Папка не найдена: $INSTALL_DIR"
fi

# ─── 4. Данные программы ─────────────────────────────────────────
step "4/5 Удаляем данные программы (модели Whisper, ffmpeg, результаты)..."
SIZE=$(dir_size_mb "$APP_SUPPORT")
if [ -d "$APP_SUPPORT" ]; then
    rm -rf "$APP_SUPPORT"
    FREED=$((FREED + SIZE))
    ok "Удалена: $APP_SUPPORT (освобождено ${SIZE} МБ)"
else
    ok "Папка данных не найдена: $APP_SUPPORT"
fi

# ─── 5. Кеш whisper ───────────────────────────────────────────────
step "5/5 Проверяем кеш OpenAI Whisper (~/.cache/whisper)..."
if [ -d "$HOME/.cache/whisper" ]; then
    SIZE=$(dir_size_mb "$HOME/.cache/whisper")
    rm -rf "$HOME/.cache/whisper"
    FREED=$((FREED + SIZE))
    ok "Удалён кеш ~/.cache/whisper (освобождено ${SIZE} МБ)"
else
    ok "Кеш ~/.cache/whisper не найден"
fi

echo ""
echo -e "${G}═══════════════════════════════════════════════════${N}"
echo -e "${G}  Transcrypt полностью удалён с этого компьютера${N}"
echo -e "${G}  Освобождено: ${FREED} МБ${N}"
echo -e "${G}═══════════════════════════════════════════════════${N}"
echo ""
echo "Остался только кеш браузера — очистите его кнопкой"
echo "«Очистить данные в браузере» в Настройках сайта."
echo ""
