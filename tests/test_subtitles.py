import tempfile
import unittest
from pathlib import Path

from src.core.subtitles import parse_subtitles


class TestSubtitleParser(unittest.TestCase):
    def test_parses_srt_and_strips_vtt_markup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "captions.vtt"
            path.write_text(
                "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n<c.green>Привет</c>\n\n"
                "00:00:03,500 --> 00:00:05,000\nмир\n",
                encoding="utf-8",
            )
            self.assertEqual(
                parse_subtitles(str(path)),
                [
                    {"start": 1.0, "end": 3.5, "text": "Привет"},
                    {"start": 3.5, "end": 5.0, "text": "мир"},
                ],
            )
