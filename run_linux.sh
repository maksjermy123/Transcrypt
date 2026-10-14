#!/bin/bash
cd "$(dirname "$0")"

echo "=================================================="
echo "  🎙 VoxPaperAi Pro — Запуск локального движка"
echo "=================================================="

if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 не найден. Установите python3."
    exit 1
fi

if [ -d ".venv" ]; then
    source .venv/bin/activate
fi

if command -v xdg-open &> /dev/null; then
    (sleep 1 && xdg-open "https://maksjermy123.github.io/Transcrypt/") &
fi

python3 engine_server.py
