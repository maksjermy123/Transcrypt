#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  Transcrypt — ПОЛНОЕ удаление с компьютера (macOS)
#
#  Запуск:
#    bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-mac.command)"
#
#  Что удаляет:
#    1. Автозапуск: LaunchAgent com.transcrypt.engine (~/Library/LaunchAgents)
#    2. Папку движка: ~/.transcrypt-engine (venv, engine_server.py, src, логи)
#    3. Данные программы: ~/Library/Application Support/VoxPaperAi
#       (модели Whisper *.pt, скачанный ffmpeg, результаты транскрипций, журнал задач)
#    4. Останавливает работающие процессы движка
#
#  Что НЕ удаляет:
#    - Кеш браузерного Whisper (Cache API браузера) — очищается кнопкой
#      «Очистить данные в браузере» в Настройках сайта
# ═══════════════════════════════════════════════════════════════

set -u

INSTALL_DIR="$HOME/.transcrypt-engine"
APP_SUPPORT="$HOME/Library/Application Support/VoxPaperAi"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
LAUNCH_AGENT_FILE="$LAUNCH_AGENT_DIR/com.transcrypt.engine.plist"

C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_B='\033[1;36m'; C_N='\033[0m'
step() { echo -e "${C_B}▸${C_N} $1"; }
ok()   { echo -e "${C_G}✓${C_N} $1"; }
warn() { echo -e "${C_Y}⚠${C_N} $1"; }
err()  { echo -e "${C_R}✗${C_N} $1"; }

echo ""
echo -e "${C_B}═══════════════════════════════════════════════════${C_N}"
echo -e "${C_B}  Transcrypt — полное удаление с компьютера (macOS)${C_N}"
echo -e "${C_B}═══════════════════════════════════════════════════${C_N}"
echo ""

FREED=0

dir_size_mb() {
    if [ -d "$1" ]; then
        du -sm "$1" 2>/dev/null | cut -f1 | tr -d ' '
    else
        echo 0
    fi
}

# ─── 1. Остановка движка ─────────────────────────────────────────
step "1/5 Останавливаем движок..."
if launchctl bootout "gui/$(id -u)/com.transcrypt.engine" &> /dev/null; then
    ok "LaunchAgent выгружен (bootout)"
fi
if [ -f "$LAUNCH_AGENT_FILE" ]; then
    launchctl unload "$LAUNCH_AGENT_FILE" &> /dev/null 2>&1 || true
fi
pkill -f "$INSTALL_DIR/engine_server.py" 2>/dev/null && ok "Процесс движка остановлен" || ok "Процессы движка не запущены"
pkill -f "engine_server.py" 2>/dev/null || true
sleep 1

# ─── 2. Автозапуск ────────────────────────────────────────────────
step "2/5 Удаляем автозапуск (LaunchAgent)..."
if [ -f "$LAUNCH_AGENT_FILE" ]; then
    rm -f "$LAUNCH_AGENT_FILE"
    ok "Удалён: $LAUNCH_AGENT_FILE"
else
    ok "LaunchAgent не найден (уже удалён)"
fi

# ─── 3. Папка движка ─────────────────────────────────────────────
step "3/5 Удаляем папку движка..."
SIZE=$(dir_size_mb "$INSTALL_DIR")
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    [ "$SIZE" -gt 0 ] && FREED=$((FREED + SIZE))
    ok "Удалена: $INSTALL_DIR (освобождено ${SIZE} МБ)"
else
    ok "Папка не найдена: $INSTALL_DIR"
fi

# ─── 4. Данные программы (модели, ffmpeg, результаты) ────────────
step "4/5 Удаляем данные программы (модели Whisper, ffmpeg, результаты)..."
SIZE=$(dir_size_mb "$APP_SUPPORT")
if [ -d "$APP_SUPPORT" ]; then
    rm -rf "$APP_SUPPORT"
    [ "$SIZE" -gt 0 ] && FREED=$((FREED + SIZE))
    ok "Удалена: $APP_SUPPORT (освобождено ${SIZE} МБ)"
else
    ok "Папка данных не найдена: $APP_SUPPORT"
fi

# ─── 5. Кеш whisper в ~/.cache (на случай ручных запусков) ───────
step "5/5 Проверяем кеш OpenAI Whisper (~/.cache/whisper)..."
if [ -d "$HOME/.cache/whisper" ]; then
    SIZE=$(dir_size_mb "$HOME/.cache/whisper")
    rm -rf "$HOME/.cache/whisper"
    [ "$SIZE" -gt 0 ] && FREED=$((FREED + SIZE))
    ok "Удалён кеш ~/.cache/whisper (освобождено ${SIZE} МБ)"
else
    ok "Кеш ~/.cache/whisper не найден"
fi

echo ""
TOTAL_GB=$(python3 -c "print(f'{$FREED/1024:.1f}')" 2>/dev/null || echo "$((FREED/1024))")
echo -e "${C_G}═══════════════════════════════════════════════════${C_N}"
echo -e "${C_G}  Transcrypt полностью удалён с этого компьютера${C_N}"
echo -e "${C_G}  Освобождено: ${FREED} МБ${TOTAL_GB:+ (~${TOTAL_GB} ГБ)}${C_N}"
echo -e "${C_G}═══════════════════════════════════════════════════${C_N}"
echo ""
echo "Остался только кеш браузера (модели браузерного Whisper)."
echo "Очистите его кнопкой «Очистить данные в браузере» в Настройках сайта"
echo "(Настройки → Удаление Transcrypt → Очистить данные в браузере)."
echo ""
