#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Генерирует engine-install/engine-files.txt — список файлов движка
# для резервного скачивания ПО ОДНОМУ.
#
# Зачем: установщики движка сначала качают tarball всего репозитория
# (github.com → codeload.github.com). На части сетей этот трафик
# перехватывается провайдером/антивирусом (curl: «SEC_E_WRONG_PRINCIPAL»,
# PowerShell: «доверительные отношения SSL/TLS»), а вот
# raw.githubusercontent.com остаётся доступен — с него же скачивается
# сам установщик. Тогда установщик берёт этот список и качает каждый
# файл отдельно.
#
# Когда пересоздавать: после любого изменения СОСТАВА файлов
# (добавили/удалили/перенесли файл в src/, engine_server.py,
# requirements-engine.txt). CI (windows-e2e) сверяет свежесть.
#
# Запуск из корня репозитория:  bash engine-install/gen-files-manifest.sh
# ════════════════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")/.."
{
    echo "# Файлы движка для резервного скачивания по одному (raw-fallback)."
    echo "# Пересоздавать после изменения состава файлов движка:"
    echo "#   bash engine-install/gen-files-manifest.sh"
    git ls-files engine_server.py engine-install/requirements-engine.txt src/
} > engine-install/engine-files.txt
echo "OK: engine-install/engine-files.txt — $(grep -vc '^#' engine-install/engine-files.txt) файлов"
