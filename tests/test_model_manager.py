import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.core.model_manager import ModelManager


class TestModelManager(unittest.TestCase):
    def test_model_status_is_a_per_model_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "tiny.pt").write_bytes(b"model")
            with patch("src.core.model_manager.models_dir", return_value=directory):
                status = ModelManager().get_model_status()
            self.assertTrue(status["tiny"])
            self.assertFalse(status["base"])
            self.assertEqual(set(status), {"tiny", "base", "small", "medium", "large-v3"})
