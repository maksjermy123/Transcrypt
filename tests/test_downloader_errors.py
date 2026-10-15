import os
import sys
import unittest
from unittest.mock import patch

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.core.downloader import Downloader


class TestErrorClassification(unittest.TestCase):
    """YouTube error strings must map to the right category and friendly text.

    Regression: with ignoreerrors=True the real cause (bot-check, 429,
    unavailable video) was swallowed and users only saw the generic
    «yt-dlp не получил информацию о видео (возможна блокировка или 429)».
    """

    def test_rate_limit(self):
        e = Exception("ERROR: unable to download video data: HTTP Error 429: Too Many Requests")
        self.assertEqual(Downloader._classify_download_error(e), "rate_limit")

    def test_bot_check_with_curly_apostrophe(self):
        # yt-dlp uses typographic apostrophe: you’re
        e = Exception(
            "ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you’re not a bot. "
            "Use --cookies-from-browser or --cookies for the authentication"
        )
        self.assertEqual(Downloader._classify_download_error(e), "bot_check")

    def test_age_restriction_beats_bot_check(self):
        # 'sign in to confirm your age' also contains 'sign in to confirm'
        e = Exception("ERROR: Sign in to confirm your age. This video may be inappropriate")
        self.assertEqual(Downloader._classify_download_error(e), "age")

    def test_fatal_video(self):
        for msg in (
            "ERROR: [youtube] x: Video unavailable",
            "ERROR: [youtube] x: Private video. Sign in if you've been granted access",
            "ERROR: [youtube] x: The uploader has not made this video available in your country",
        ):
            self.assertEqual(Downloader._classify_download_error(Exception(msg)), "fatal_video")

    def test_network(self):
        e = Exception("ERROR: Unable to download webpage: Temporary failure in name resolution")
        self.assertEqual(Downloader._classify_download_error(e), "network")

    def test_extract_fail(self):
        e = Exception("ERROR: [youtube] x: Unable to extract uploader id; please report this issue")
        self.assertEqual(Downloader._classify_download_error(e), "extract_fail")

    def test_clean_error_strips_prefix_and_cookie_help(self):
        e = Exception(
            "ERROR: [youtube] jNQXAC9IVRw: Sign in to confirm you’re not a bot. "
            " Use --cookies-from-browser or --cookies for the authentication. "
            " See https://github.com/yt-dlp/yt-dlp/wiki/FAQ for how to manually pass cookies."
        )
        cleaned = Downloader._clean_ytdlp_error(e)
        self.assertFalse(cleaned.startswith("ERROR"))
        self.assertNotIn("jNQXAC9IVRw:", cleaned)
        self.assertNotIn("cookies-from-browser", cleaned)
        self.assertIn("not a bot", cleaned)

    def test_friendly_message_contains_reason_and_attempts(self):
        e = Exception("ERROR: [youtube] x: Sign in to confirm you’re not a bot")
        msg = Downloader._friendly_download_error(e, 9)
        self.assertIn("9 попыток", msg)
        self.assertIn("bot", msg.lower())
        self.assertIn("yt-dlp", msg)

    def test_attempt_configs_chain(self):
        dl = Downloader(output_dir="/tmp/voxpaperai-test-attempts")
        configs = dl._attempt_configs()
        labels = [c["_label"] for c in configs]
        # Клиенты YouTube идут первыми, cookies — последними
        self.assertTrue(labels[0].startswith("клиент mweb"))
        self.assertTrue(any("tv" in l for l in labels))
        self.assertTrue(any("web_safari" in l for l in labels))
        self.assertTrue(labels[-1].startswith("cookies из"))
        # cookies-попытки содержат кортеж cookiesfrombrowser
        for c in configs:
            if c["_label"].startswith("cookies из"):
                self.assertIsInstance(c["cookiesfrombrowser"], tuple)

    def test_download_surfaces_real_error_after_all_attempts(self):
        """Bot-check on every attempt → friendly RuntimeError, not generic text."""
        import yt_dlp

        dl = Downloader(output_dir="/tmp/voxpaperai-test-surface")
        err = yt_dlp.utils.DownloadError(
            "ERROR: [youtube] x: Sign in to confirm you’re not a bot. "
            " Use --cookies-from-browser or --cookies for the authentication"
        )

        with patch("yt_dlp.YoutubeDL") as mock_ydl:
            instance = mock_ydl.return_value.__enter__.return_value
            instance.extract_info.side_effect = err

            with self.assertRaises(RuntimeError) as ctx:
                dl.download("https://www.youtube.com/watch?v=abc", extract_audio=True)

        text = str(ctx.exception)
        self.assertIn("не робот", text)          # дружелюбная подсказка
        self.assertIn("не удалось", text.lower())  # заголовок
        self.assertNotIn("возможна блокировка или 429", text)  # старый общий текст исчез
        # Проверяем, что перебор действительно шёл: несколько YoutubeDL-конструкций
        self.assertGreaterEqual(mock_ydl.call_count, 4)

    def test_429_retry_then_success(self):
        """HTTP 429 → пауза и повтор тем же способом → успех."""
        import yt_dlp

        dl = Downloader(output_dir="/tmp/voxpaperai-test-429")
        rate_err = yt_dlp.utils.DownloadError("ERROR: unable to download video data: HTTP Error 429: Too Many Requests")

        info = {"title": "video", "id": "1", "requested_downloads": [{"filepath": __file__}]}

        with patch("yt_dlp.YoutubeDL") as mock_ydl, patch("time.sleep") as mock_sleep:
            instance = mock_ydl.return_value.__enter__.return_value
            # 1-я попытка: extract_info(download=False) → 429; 2-я: OK; 3-я (download=True): OK
            instance.extract_info.side_effect = [rate_err, info, info]
            instance.prepare_filename.return_value = __file__  # существует → early return

            path, is_new = dl.download("https://www.youtube.com/watch?v=abc")

            self.assertTrue(is_new is False)  # файл уже существовал → кэш
            mock_sleep.assert_called()  # пауза между 429-попытками была


if __name__ == "__main__":
    unittest.main()
