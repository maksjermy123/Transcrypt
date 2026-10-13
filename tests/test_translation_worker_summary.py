import os
import sys
import tempfile
import unittest

from PyQt6.QtCore import QCoreApplication


sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.ui.tabs.translation_tab import TranslationWorker


class TestTranslationWorkerSummary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QCoreApplication.instance() or QCoreApplication([])

    def test_worker_reports_errors_in_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "sample.txt")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("hello")

            worker = TranslationWorker(
                [{"path": path, "lang": "ru", "format": "txt"}],
                tmpdir,
                "Google",
                "",
                "FAST",
            )

            log_messages = []
            summaries = []

            worker.log.connect(log_messages.append)
            worker.finished.connect(summaries.append)

            def boom(*args, **kwargs):
                raise RuntimeError("synthetic failure")

            worker.translator.translate_text = boom
            worker.run()

            self.assertEqual(len(summaries), 1)
            self.assertEqual(summaries[0]["errors"], 1)
            self.assertEqual(summaries[0]["success"], 0)
            self.assertTrue(any("synthetic failure" in msg for msg in log_messages))


if __name__ == "__main__":
    unittest.main()
