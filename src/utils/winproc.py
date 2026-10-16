"""
Скрытие консольных окон дочерних процессов на Windows.

Проблема: движок запускается как pythonw.exe (без консольного окна).
Каждый subprocess.run/Popen консольной программы (ffmpeg, ffprobe, pip,
whisper-runner) в этом случае создаёт НОВОЕ чёрное консольное окно:
визуально окна «мигают» на экране при каждом health-опросе сайта или
задаче. Флаг CREATE_NO_WINDOW запрещает создание нового окна — вывод
как обычно идёт в pipe, а окно не появляется вовсе.

На macOS/Linux флаг не нужен — no_window_kwargs() возвращает пустой dict.
"""

import sys

# CREATE_NO_WINDOW = 0x08000000 (wincon.h). Используется только на Windows.
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def no_window_kwargs() -> dict:
    """kwargs для subprocess.run/Popen: скрывает консольное окно на Windows.

    Использование:
        subprocess.run(cmd, stdout=PIPE, **no_window_kwargs())
        subprocess.Popen(cmd, stdout=PIPE, **no_window_kwargs())
    """
    return {"creationflags": CREATE_NO_WINDOW} if CREATE_NO_WINDOW else {}
