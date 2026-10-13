import os
import sys
import unittest


sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.core.downloader import Downloader


class TestSubtitleSelection(unittest.TestCase):
    def test_prefers_exact_manual_language(self):
        choice = Downloader.choose_subtitle_track(
            {"manual": ["ru", "en"], "auto": ["ru"]},
            "ru",
            fallback_langs=["en", "uk"],
        )
        self.assertEqual(choice["lang"], "ru")
        self.assertFalse(choice["auto"])

    def test_matches_language_variants(self):
        choice = Downloader.choose_subtitle_track(
            {"manual": ["en-US", "de"], "auto": []},
            "en",
            fallback_langs=["ru", "uk"],
        )
        self.assertEqual(choice["lang"], "en-US")
        self.assertFalse(choice["auto"])

    def test_falls_back_to_preferred_translation_languages_before_anything_else(self):
        choice = Downloader.choose_subtitle_track(
            {"manual": ["uk", "fr"], "auto": ["en"]},
            "ru",
            fallback_langs=["en", "uk"],
        )
        self.assertEqual(choice["lang"], "en")
        self.assertTrue(choice["auto"])

    def test_uses_any_manual_before_any_auto(self):
        choice = Downloader.choose_subtitle_track(
            {"manual": ["fr"], "auto": ["es"]},
            "ru",
            fallback_langs=["en", "uk"],
        )
        self.assertEqual(choice["lang"], "fr")
        self.assertFalse(choice["auto"])

    def test_returns_none_when_no_subtitles_exist(self):
        choice = Downloader.choose_subtitle_track(
            {"manual": [], "auto": []},
            "ru",
            fallback_langs=["en", "uk"],
        )
        self.assertIsNone(choice)


if __name__ == "__main__":
    unittest.main()
