import sys
import os
import unittest
from PyQt6.QtWidgets import QApplication
from PyQt6.QtTest import QTest
from PyQt6.QtCore import Qt

# Add src to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.ui.main_window import MainWindow

# Ensure QApplication exists
app = QApplication.instance()
if app is None:
    app = QApplication(sys.argv)

class TestVoxPaperUI(unittest.TestCase):
    def setUp(self):
        self.window = MainWindow()

    def tearDown(self):
        self.window.close()

    def test_tabs_exist(self):
        """Test if all major tabs are present and correctly named."""
        tabs = self.window.tabs
        self.assertEqual(tabs.count(), 6)
        
        expected_tabs = [
            "🎙 Транскрибация",
            "⬇ Медиа",
            "🔄 Конвертер",
            "🌐 Перевод",
            "⚙ Настройки",
            "ℹ О программе"
        ]
        
        for i, expected_name in enumerate(expected_tabs):
            self.assertEqual(tabs.tabText(i), expected_name)

    def test_transcription_tab_ui(self):
        """Test basic elements in Transcription tab."""
        trans_tab = self.window.tabs.widget(0)
        self.assertIsNotNone(trans_tab.btn_start)
        self.assertIsNotNone(trans_tab.btn_stop)
        self.assertIsNotNone(trans_tab.combo_model)
        
        # Check that there is at least one model loaded in combo
        self.assertGreater(trans_tab.combo_model.count(), 0)

    def test_media_tab_ui(self):
        """Test basic elements and actions in Media tab."""
        media_tab = self.window.tabs.widget(1)
        
        self.assertIsNotNone(media_tab.combo_action)
        self.assertIsNotNone(media_tab.btn_start)
        self.assertIsNotNone(media_tab.btn_stop)

    def test_settings_tab_danger_zone(self):
        """Test if the Danger Zone (Uninstall) exists."""
        settings_tab = self.window.tabs.widget(4)
        
        # Specific check: Ensure model_widgets dict is populated
        self.assertIn('base', settings_tab.model_widgets)
        
if __name__ == '__main__':
    unittest.main()
