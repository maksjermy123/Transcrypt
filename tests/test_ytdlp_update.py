import os
import sys
import unittest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.utils.pip_tools import parse_pip_upgrade_output


class TestParsePipUpgradeOutput(unittest.TestCase):
    """Разбор вывода «pip install --upgrade yt-dlp» для кнопки Обновить yt-dlp."""

    def test_success_with_new_version(self):
        out = (
            "Collecting yt-dlp\n"
            "  Downloading yt_dlp-2026.10.1-py3-none-any.whl.metadata\n"
            "Installing collected packages: yt-dlp\n"
            "Successfully installed yt-dlp-2026.10.1"
        )
        upgraded, version = parse_pip_upgrade_output(out)
        self.assertTrue(upgraded)
        self.assertEqual(version, "2026.10.1")

    def test_success_multiple_packages(self):
        out = "Successfully installed curl-cffi-0.15.0 yt-dlp-2026.10.2"
        upgraded, version = parse_pip_upgrade_output(out)
        self.assertTrue(upgraded)
        self.assertEqual(version, "2026.10.2")

    def test_already_satisfied(self):
        out = (
            "Requirement already satisfied: yt-dlp in ./venv/lib (2026.8.19)\n"
            "Requirement already satisfied: requests in ./venv/lib (2.32.3)"
        )
        upgraded, version = parse_pip_upgrade_output(out)
        self.assertFalse(upgraded)
        self.assertEqual(version, "")

    def test_empty_output(self):
        upgraded, version = parse_pip_upgrade_output("")
        self.assertFalse(upgraded)
        self.assertEqual(version, "")


if __name__ == "__main__":
    unittest.main()
