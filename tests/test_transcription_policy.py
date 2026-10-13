import unittest

from src.core.transcription_policy import needs_translation


class TestTranscriptionPolicy(unittest.TestCase):
    def test_auto_detected_russian_is_not_translated_to_russian(self):
        self.assertFalse(needs_translation("ru", "auto", detected_source_language="ru"))

    def test_explicit_russian_is_not_translated_to_russian(self):
        self.assertFalse(needs_translation("ru", "ru"))

    def test_detected_english_is_translated_to_russian(self):
        self.assertTrue(needs_translation("ru", "auto", detected_source_language="en"))

    def test_no_target_means_no_translation(self):
        self.assertFalse(needs_translation("-", "ru"))


if __name__ == "__main__":
    unittest.main()
