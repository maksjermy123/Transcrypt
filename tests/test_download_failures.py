import os
import sys
import unittest
from unittest.mock import patch


sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.core.downloader import Downloader
from src.utils.fs import get_audio_duration


class TestDownloadFailureHandling(unittest.TestCase):
    """Regression: silent download failures must not return non-existent paths.

    Previously a YouTube HTTP 429 was swallowed (ignoreerrors=True) and the
    caller handed a missing file to the Whisper subprocess, which failed with
    a confusing 'Audio not found' error.
    """

    def test_download_raises_when_file_missing(self):
        dl = Downloader(output_dir="/tmp/voxpaperai-test-nonexistent")
        fake_path = "/tmp/voxpaperai-test-nonexistent/never_downloaded.mp3"

        with patch("yt_dlp.YoutubeDL") as mock_ydl:
            instance = mock_ydl.return_value.__enter__.return_value
            instance.extract_info.return_value = {"title": "x", "id": "1"}
            instance.prepare_filename.return_value = fake_path

            with self.assertRaises(RuntimeError) as ctx:
                dl.download("https://www.youtube.com/watch?v=abc", extract_audio=True)

            # Real download must not swallow errors anymore.
            second_call_opts = mock_ydl.call_args_list[-1][0][0]
            self.assertFalse(second_call_opts.get("ignoreerrors", True))

        self.assertIn("не найден", str(ctx.exception))

    def test_download_returns_existing_cached_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            existing = os.path.join(tmpdir, "video.mp3")
            with open(existing, "w", encoding="utf-8") as f:
                f.write("data")

            dl = Downloader(output_dir=tmpdir)
            with patch("yt_dlp.YoutubeDL") as mock_ydl:
                instance = mock_ydl.return_value.__enter__.return_value
                instance.extract_info.return_value = {"title": "video", "id": "1"}
                instance.prepare_filename.return_value = existing

                path, is_new = dl.download("https://example.com/v", extract_audio=True)

            self.assertEqual(path, existing)
            self.assertFalse(is_new)

    def test_get_audio_duration_handles_missing_file(self):
        self.assertIsNone(get_audio_duration("/nonexistent/file.mp3"))


if __name__ == "__main__":
    unittest.main()
