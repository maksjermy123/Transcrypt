"""Tests for deno (EJS solver runtime) diagnostics helpers.

deno is the JS runtime yt-dlp needs to solve the YouTube PO Token challenge;
when it is missing (e.g. removed by antivirus from the portable folder) every
download fails with «Requested format is not available». These helpers power
the Settings tab diagnostics and the self-check line in download error texts.
"""

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.utils import fs


class TestParseDenoVersion(unittest.TestCase):
    def test_standard_output(self):
        self.assertEqual(
            fs.parse_deno_version("deno 2.9.7 (release, x86_64-pc-windows-msvc)\nv8 13.x\ntypescript 5.x"),
            "2.9.7",
        )

    def test_linux_output(self):
        self.assertEqual(fs.parse_deno_version("deno 1.46.3 (stable, aarch64-unknown-linux-gnu)"), "1.46.3")

    def test_macos_output(self):
        self.assertEqual(fs.parse_deno_version("deno 2.9.7 (release, aarch64-apple-darwin)"), "2.9.7")

    def test_empty_output(self):
        self.assertEqual(fs.parse_deno_version(""), "")
        self.assertEqual(fs.parse_deno_version(None), "")

    def test_garbage_output(self):
        self.assertEqual(fs.parse_deno_version("not deno at all"), "")
        self.assertEqual(fs.parse_deno_version("deno"), "")

    def test_multiline_takes_first_line(self):
        self.assertEqual(fs.parse_deno_version("garbage\ndeno 3.0.0 (release)"), "")


class TestFindDenoCached(unittest.TestCase):
    """Positive results are cached (like ffmpeg); cache resets when path dies."""

    def setUp(self):
        fs._exe_cache.pop("deno", None)

    def tearDown(self):
        fs._exe_cache.pop("deno", None)

    def test_positive_result_is_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            deno_path = os.path.join(tmp, "deno.exe" if os.name == "nt" else "deno")
            with open(deno_path, "w", encoding="utf-8") as f:
                f.write("#!/bin/sh\necho 'deno 9.9.9 (test)'\n")
            with patch.object(fs, "_find_deno_uncached", lambda: deno_path):
                self.assertEqual(fs.find_deno_executable(), deno_path)
                # второй вызов берётся из кэша — finder больше не нужен
                with patch.object(fs, "_find_deno_uncached", lambda: self.fail("cache miss")):
                    self.assertEqual(fs.find_deno_executable(), deno_path)

    def test_negative_result_not_cached(self):
        with patch.object(fs, "_find_deno_uncached", lambda: None):
            self.assertIsNone(fs.find_deno_executable())
            # повторный вызов снова идёт в finder (отрицательный не кэшируется)
            self.assertIsNone(fs.find_deno_executable())


class TestNoFormatsSelfCheck(unittest.TestCase):
    """«Requested format is not available» message must contain the actual
    deno status so the user sees whether the solver is alive."""

    def setUp(self):
        from src.core.downloader import Downloader

        self.Downloader = Downloader
        Downloader._pypi_cache = {"ts": 0.0, "version": ""}
        p = patch.object(Downloader, "_latest_ytdlp_version", staticmethod(lambda *a, **k: ""))
        p.start()
        self.addCleanup(p.stop)

    def _text(self, deno: str | None):
        with patch("src.utils.fs.find_deno_executable", lambda: deno), \
             patch("src.utils.fs.deno_version", lambda p: "2.9.7" if deno else ""):
            err = Exception("ERROR: Requested format is not available")
            return self.Downloader._friendly_download_error(err, attempts_total=9)

    def test_deno_found_line(self):
        text = self._text("/fake/path/deno")
        self.assertIn("deno найден", text)
        self.assertIn("2.9.7", text)
        self.assertIn("VPN", text)

    def test_deno_missing_line(self):
        text = self._text(None)
        self.assertIn("deno НЕ найден", text)
        self.assertIn("антивирус", text.lower())
        self.assertIn("Переустановите", text)

    def test_other_kinds_have_no_selfcheck(self):
        err = Exception("ERROR: HTTP Error 429: Too Many Requests")
        text = self.Downloader._friendly_download_error(err, attempts_total=9)
        self.assertNotIn("Самопроверка решателя", text)


if __name__ == "__main__":
    unittest.main()
