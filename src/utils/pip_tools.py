"""Мелкие утилиты pip для self-обслуживания движка (без тяжёлых импортов)."""

import re


def parse_pip_upgrade_output(output: str) -> tuple[bool, str]:
    """Разбор вывода «pip install --upgrade <pkg>».

    Возвращает (upgraded, new_version). Пример строки успеха:
    «Successfully installed yt-dlp-2026.10.1 curl-cffi-0.15.0».
    Если pip ничего не обновил («Requirement already satisfied») — (False, "").
    """
    if "Successfully installed" in output:
        m = re.search(r"yt-dlp-([0-9][0-9a-zA-Z.]*[^\s,)])", output)
        return True, (m.group(1) if m else "?")
    return False, ""
