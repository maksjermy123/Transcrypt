"""Регрессионные тесты Converter: кодировка вывода ffmpeg + дедлок stderr.

Два реальных инцидента (2026-10-19), закрытых фиксом в converter.py:

1. «charmap» на Windows. ffmpeg печатает в stderr имя входного файла;
   чтение этого вывода в text=True без явной encoding использовало
   системную CP1251, а байты UTF-8 кириллицы (например 0x98 — второй
   байт «И» в «ЗАРУБИЛСЯ») в CP1251 не существуют:
   UnicodeDecodeError: 'charmap' codec can't decode byte 0x98 in position 146.
   Симптом пользователя: конвертация mp4→avi/mp3 падала на десктопе.

2. «Вечное зависание» конвертации. Вет БЕЗ progress_callback не вычитывал
   stderr вообще: ffmpeg постоянно пишет туда статистику, буфер канала
   (~64 КБ) переполнялся на длинных файлах, ffmpeg замирал на записи,
   process.wait() никогда не возвращался. Симптом: сайт висел на задаче
   конвертации десятки минут, движок показывал «running» навсегда.

Тесты подменяют ffmpeg/ffprobe фейками (скрипт-обёртка + python-скрипт),
поэтому не требуют настоящего ffmpeg и детерминированы на любой ОС.
"""

import os
import sys
import tempfile
import unittest
from unittest import mock


sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import src.utils.fs as fs  # noqa: E402
from src.core.converter import Converter  # noqa: E402

CYRILLIC_NAME = "Уборщик ЗАРУБИЛСЯ с Бодибилдерами в Зале ｜ ANATOLY Gym Prank.mp4"

FAKE_FFMPEG = r"""
import os, sys
try:
    sys.stderr.reconfigure(encoding="utf-8")  # ребёнок всегда пишет UTF-8
except Exception:
    pass
mode = os.environ.get("VPAI_FAKE_FFMPEG", "ok")
args = sys.argv[1:]
inp = args[args.index("-i") + 1] if "-i" in args else "input.mp4"
out = args[-1]
w = sys.stderr.write
w("ffmpeg version 7.1-fake Copyright (c) 2000-2026 тест\n")
if mode == "ok":
    # Кириллическое имя файла в выводе — раньше это роняло 'charmap'-декодер
    w(f"Input #0, mov,mp4, from '{inp}' [Уборщик ЗАРУБИЛСЯ ｜ тест]\n")
    for i in range(2000):
        w(f"frame={i} fps=25 q=-1.0 size= 256 time=00:00:{i % 60:02d}.50 bitrate=1000.0kbits/s speed=1x\r\n")
    sys.stderr.flush()
    with open(out, "wb") as f:
        f.write(b"FAKE" * 64)
    sys.exit(0)
elif mode == "flood":
    # 300 КБ в stderr — гарантированно больше буфера канала (~64 КБ):
    # без вычитывания stderr родитель навсегда зависает в process.wait()
    w("x" * 300000 + "\n")
    sys.stderr.flush()
    with open(out, "wb") as f:
        f.write(b"FAKE" * 64)
    sys.exit(0)
elif mode == "fail":
    w("Ошибка: не удалось открыть файл [Уборщик ЗАРУБИЛСЯ]\n")
    sys.stderr.flush()
    sys.exit(1)
sys.exit(2)
"""

FAKE_FFPROBE = "import sys\nsys.stdout.write('10.0\\n')\nsys.exit(0)\n"


def _make_fake_tool(tmpdir, base, inner_code):
    """Создаёт исполняемую обёртку, запускающую python-скрипт с аргументами."""
    inner = os.path.join(tmpdir, base + ".py")
    with open(inner, "w", encoding="utf-8") as f:
        f.write(inner_code)
    if os.name == "nt":
        exe = os.path.join(tmpdir, base + ".cmd")
        with open(exe, "w", encoding="ascii") as f:
            f.write(f'@echo off\r\n"{sys.executable}" "{inner}" %*\r\n')
    else:
        exe = os.path.join(tmpdir, base + ".sh")
        with open(exe, "w", encoding="utf-8") as f:
            f.write(f'#!/bin/sh\nexec "{sys.executable}" "{inner}" "$@"\n')
        os.chmod(exe, 0o755)
    return exe


class TestConverterEncoding(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="vpai-conv-tests-")
        tmpdir = self._tmp.name
        self.ffmpeg = _make_fake_tool(tmpdir, "fake_ffmpeg", FAKE_FFMPEG)
        self.ffprobe = _make_fake_tool(tmpdir, "fake_ffprobe", FAKE_FFPROBE)
        # Входной файл с тем самым именем, что падало у пользователя
        self.input = os.path.join(tmpdir, CYRILLIC_NAME)
        with open(self.input, "wb") as f:
            f.write(b"\x00" * 1024)

    def tearDown(self):
        self._tmp.cleanup()

    def test_progress_branch_survives_cyrillic_output(self):
        """Регрессион «charmap»: прогресс-ветка читает stderr с кириллицей в UTF-8."""
        calls = []
        with tempfile.TemporaryDirectory() as outdir:
            with mock.patch.object(fs, "find_ffmpeg_executable", return_value=self.ffmpeg), \
                 mock.patch.object(fs, "find_ffprobe_executable", return_value=self.ffprobe), \
                 mock.patch.dict(os.environ, {"VPAI_FAKE_FFMPEG": "ok"}):
                conv = Converter()
                out = conv.convert_media(
                    self.input, "avi", outdir,
                    progress_callback=lambda *a, **kw: calls.append(a),
                )
            self.assertTrue(os.path.exists(out))
            self.assertTrue(out.endswith(".avi"))
            # прогресс реально приходил (time=-строки разбирались)
            self.assertGreaterEqual(len(calls), 1)

    def test_no_progress_branch_drains_stderr_without_deadlock(self):
        """Регрессион «вечного зависания»: 300 КБ stderr вычитываются, не висим."""
        with tempfile.TemporaryDirectory() as outdir:
            with mock.patch.object(fs, "find_ffmpeg_executable", return_value=self.ffmpeg), \
                 mock.patch.object(fs, "find_ffprobe_executable", return_value=self.ffprobe), \
                 mock.patch.dict(os.environ, {"VPAI_FAKE_FFMPEG": "flood"}):
                conv = Converter()
                out = conv.convert_media(self.input, "avi", outdir)
            self.assertTrue(os.path.exists(out))

    def test_failure_raises_with_decoded_utf8_message(self):
        """Падение ffmpeg поднимает RuntimeError с читаемым (UTF-8) ответом ffmpeg."""
        with tempfile.TemporaryDirectory() as outdir:
            with mock.patch.object(fs, "find_ffmpeg_executable", return_value=self.ffmpeg), \
                 mock.patch.object(fs, "find_ffprobe_executable", return_value=self.ffprobe), \
                 mock.patch.dict(os.environ, {"VPAI_FAKE_FFMPEG": "fail"}):
                conv = Converter()
                with self.assertRaises(RuntimeError) as ctx:
                    conv.convert_media(self.input, "avi", outdir)
            msg = str(ctx.exception)
            self.assertIn("ffmpeg завершился с кодом 1", msg)
            self.assertIn("Ошибка: не удалось открыть файл", msg)
            self.assertNotIn("\ufffd", msg)  # без крякозябр-replacement

    def test_stderr_text_never_raises(self):
        stat = Converter._stderr_text
        self.assertEqual(stat(b"\xd0\x98"), "И")
        # битые байты не бросают исключение — заменяются U+FFFD
        self.assertIsInstance(stat(b"\xff\xfe garbage"), str)
        self.assertEqual(stat(None), "")
        self.assertEqual(stat(""), "")
        self.assertEqual(stat("строка"), "строка")


if __name__ == "__main__":
    unittest.main()
