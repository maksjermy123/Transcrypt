import os
import sys
import tempfile
import unittest


sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.utils import app_paths
from src.utils.fs import artifact_label_from_info, safe_artifact_part, safe_filename, unique_path, url_site_tag


class TestCoreSmoke(unittest.TestCase):
    def test_app_paths_are_absolute(self):
        self.assertTrue(os.path.isabs(app_paths.app_support_dir()))
        self.assertTrue(os.path.isabs(app_paths.app_config_dir()))
        self.assertTrue(os.path.isabs(app_paths.config_file_path()))
        self.assertTrue(os.path.isabs(app_paths.logs_dir()))
        self.assertTrue(os.path.isabs(app_paths.runtime_dir()))

    def test_safe_filename_strips_forbidden_characters(self):
        self.assertEqual(safe_filename('a:b*c?d"e<f>g|h/i\\j'), "abcdefghij")

    def test_safe_artifact_part_keeps_readable_unicode(self):
        value = safe_artifact_part("  Пример: тестового / файла?  ")
        self.assertEqual(value, "Пример тестового файла")

    def test_unique_path_adds_suffix_for_existing_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            original = os.path.join(tmpdir, "report.txt")
            with open(original, "w", encoding="utf-8") as handle:
                handle.write("x")
            candidate = unique_path(original)
            self.assertTrue(candidate.endswith("report_1.txt"))
            self.assertNotEqual(candidate, original)

    def test_url_site_tag_and_artifact_label(self):
        self.assertEqual(url_site_tag("https://www.youtube.com/watch?v=123"), "YT")
        self.assertEqual(url_site_tag("https://vkvideo.ru/video-1_2"), "VK")
        label = artifact_label_from_info(
            {"title": "Lecture", "uploader": "Channel"},
            "https://www.youtube.com/watch?v=123",
        )
        self.assertEqual(label, "YT Channel - Lecture")


if __name__ == "__main__":
    unittest.main()
