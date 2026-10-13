#!/bin/bash
set -euo pipefail

# Переходим в директорию скрипта (корень проекта)
cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
VoxPaperAi Pro (Dev/Test runner)

Использование:
  ./run_dev.command                # запустить приложение
  ./run_dev.command --app          # запустить приложение
  ./run_dev.command --tests        # прогнать UI-тесты (offscreen)
  ./run_dev.command --tests -k     # любые доп. аргументы будут переданы unittest

Примеры:
  ./run_dev.command --tests
  ./run_dev.command --tests -v
EOF
}

# Активируем виртуальное окружение
if [ ! -d ".venv" ]; then
  echo "❌ Не найдено виртуальное окружение: .venv"
  echo "Создайте его и установите зависимости:"
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  pip install -r requirements.txt"
  exit 1
fi

# Надёжно используем Python из venv (не полагаемся на `activate`)
VENV_PY="$(pwd)/.venv/bin/python"
if [ ! -x "$VENV_PY" ]; then
  echo "❌ Не найден исполняемый Python в venv: $VENV_PY"
  exit 1
fi

# Добавляем корень проекта в PYTHONPATH (на всякий случай)
export PYTHONPATH="${PYTHONPATH:-}:$(pwd)"

# На всякий случай добавим venv/bin в PATH (для yt-dlp и других entrypoints)
export PATH="$(pwd)/.venv/bin:${PATH}"

# Нормализуем locale для Qt (особенно важно для тестов)
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

mode="app"
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
elif [ "${1:-}" = "--tests" ]; then
  mode="tests"
  shift
elif [ "${1:-}" = "--app" ]; then
  mode="app"
  shift
elif [ "${1:-}" != "" ]; then
  echo "❌ Неизвестный аргумент: $1"
  echo
  usage
  exit 2
fi

if [ "$mode" = "tests" ]; then
  echo "🧪 Запуск UI-тестов (offscreen)..."
  export QT_QPA_PLATFORM=offscreen
  "$VENV_PY" -m unittest discover tests "$@"
else
  echo "🔍 Проверка FFmpeg runtime..."
  if ! "$VENV_PY" -m src.utils.ffmpeg_installer --ensure; then
    echo "⚠️ Не удалось автоматически установить FFmpeg."
    echo "⚠️ Приложение будет запущено в ограниченном режиме."
  fi
  echo "▶️ Запуск VoxPaperAi Pro (Dev Mode)..."
  "$VENV_PY" src/main.py
fi
