#!/bin/bash
cd "$(dirname "$0")"

echo "=================================================="
echo "  🎙 VoxPaperAi Pro — Запуск локального движка"
echo "=================================================="

# Check Python 3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 не найден. Пожалуйста, установите Python: https://www.python.org"
    read -p "Нажмите Enter для выхода..."
    exit 1
fi

# Use virtual environment if present
if [ -d ".venv" ]; then
    source .venv/bin/activate
elif [ -d "../.venv" ]; then
    source ../.venv/bin/activate
fi

# Open Web App in browser after 1 second in background
(sleep 1 && open "https://maksjermy123.github.io/Transcrypt/") &

# Start Engine
python3 engine_server.py
