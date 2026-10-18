from PyQt6.QtCore import QTimer
from PyQt6.QtWidgets import QFrame, QLabel, QMainWindow, QTabWidget, QWidget, QVBoxLayout
from src.ui.tabs.transcription_tab import TranscriptionTab
from src.ui.tabs.converter_tab import ConverterTab
from src.ui.tabs.translation_tab import TranslationTab
from src.ui.tabs.settings_tab import SettingsTab
from src.ui.tabs.about_tab import AboutTab
from src.ui.tabs.media_tab import MediaTab
from src.utils.processing_guard import processing_notifier, processing_snapshot
from src.utils.config import load_config, save_config

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("VoxPaperAi Pro")
        self.resize(1200, 800)

        # Central Widget
        central_widget = QWidget()
        central_widget.setObjectName("mainCentral")
        self.setCentralWidget(central_widget)

        # Layout
        layout = QVBoxLayout(central_widget)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        self.notice_frame = QFrame()
        self.notice_frame.setObjectName("appNotice")
        self.notice_frame.hide()
        notice_layout = QVBoxLayout(self.notice_frame)
        notice_layout.setContentsMargins(12, 8, 12, 8)
        self.notice_label = QLabel("")
        self.notice_label.setWordWrap(True)
        notice_layout.addWidget(self.notice_label)
        layout.addWidget(self.notice_frame)

        # Tabs
        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        layout.addWidget(self.tabs)
        self.tabs.currentChanged.connect(self.on_tab_changed)

        # Add Tabs
        self.tabs.addTab(TranscriptionTab(), "Транскрибация")
        self.tabs.addTab(MediaTab(), "Медиа")
        self.tabs.addTab(ConverterTab(), "Конвертер")
        self.tabs.addTab(TranslationTab(), "Перевод")
        self.tabs.addTab(SettingsTab(), "Настройки")
        self.tabs.addTab(AboutTab(), "О программе")

        # Персист активной вкладки: перезапуск приложения вернёт на неё же
        try:
            last_idx = int(load_config().get("ui_last_tab", 0))
        except Exception:
            last_idx = 0
        if 0 <= last_idx < self.tabs.count():
            self.tabs.setCurrentIndex(last_idx)

        self.queue_panel = QFrame()
        self.queue_panel.setObjectName("queuePanel")
        queue_layout = QVBoxLayout(self.queue_panel)
        queue_layout.setContentsMargins(12, 10, 12, 10)
        queue_layout.setSpacing(3)
        self.queue_title_label = QLabel("Очередь задач")
        self.queue_title_label.setObjectName("queuePanelTitle")
        self.queue_current_label = QLabel("Сейчас ничего не выполняется")
        self.queue_current_label.setObjectName("queuePanelCurrent")
        self.queue_next_label = QLabel("Очередь пуста")
        self.queue_next_label.setObjectName("queuePanelNext")
        self.queue_current_label.setWordWrap(True)
        self.queue_next_label.setWordWrap(True)
        queue_layout.addWidget(self.queue_title_label)
        queue_layout.addWidget(self.queue_current_label)
        queue_layout.addWidget(self.queue_next_label)
        layout.addWidget(self.queue_panel)

        self._notice_timer = QTimer(self)
        self._notice_timer.setSingleShot(True)
        self._notice_timer.timeout.connect(self.notice_frame.hide)
        processing_notifier().state_changed.connect(self.update_queue_panel)
        self.update_queue_panel(processing_snapshot())

    def show_notification(self, message: str, level: str = "info", timeout_ms: int = 4500):
        palette = {
            "info": ("#1F3B70", "#DCEBFF", "#8CC2FF"),
            "success": ("#143D2E", "#DDF8E8", "#5DD39E"),
            "warning": ("#4C3410", "#FFF2D8", "#F0B35A"),
            "error": ("#4A1622", "#FFE2E7", "#F47A96"),
        }
        bg, fg, border = palette.get(level, palette["info"])
        self.notice_label.setText(message)
        self.notice_frame.setStyleSheet(
            f"QFrame#appNotice {{ background-color: {bg}; border: 1px solid {border}; border-radius: 12px; }}"
            f"QFrame#appNotice QLabel {{ color: {fg}; font-weight: 600; }}"
        )
        self.notice_frame.show()
        self._notice_timer.start(timeout_ms)

    def update_queue_panel(self, snapshot=None):
        snapshot = snapshot or processing_snapshot()
        active_label = snapshot.get("active_label")
        queue = snapshot.get("queue") or []
        if active_label:
            self.queue_current_label.setText(f"Сейчас выполняется: {active_label}")
        else:
            self.queue_current_label.setText("Сейчас ничего не выполняется")

        if queue:
            queue_text = " · ".join(f"{idx + 1}. {item.get('label', 'Задача')}" for idx, item in enumerate(queue))
            self.queue_next_label.setText(f"Дальше по очереди: {queue_text}")
        else:
            self.queue_next_label.setText("Очередь пуста")

    def on_tab_changed(self, idx: int):
        # Персист активной вкладки (Task 34): перезапуск вернёт на неё же
        try:
            cfg = load_config()
            if int(cfg.get("ui_last_tab", -1)) != int(idx):
                cfg["ui_last_tab"] = int(idx)
                save_config(cfg)
        except Exception:
            pass
        try:
            from src.utils.event_log import get_event_log

            name = self.tabs.tabText(idx)
            get_event_log().write("ui_tab_changed", index=int(idx), name=str(name))
        except Exception:
            pass
