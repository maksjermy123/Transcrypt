from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtGui import QPixmap
from PyQt6.QtWidgets import QApplication, QFrame, QHBoxLayout, QLabel, QMainWindow, QTabWidget, QWidget, QVBoxLayout
from src.ui.tabs.transcription_tab import TranscriptionTab
from src.ui.tabs.converter_tab import ConverterTab
from src.ui.tabs.translation_tab import TranslationTab
from src.ui.tabs.settings_tab import SettingsTab
from src.ui.tabs.about_tab import AboutTab
from src.ui.tabs.media_tab import MediaTab
from src.utils.processing_guard import processing_notifier, processing_snapshot
from src.utils.config import load_config, save_config
import os
import sys

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()

        self.setWindowTitle("VoxPaperAi Pro")
        self.resize(1200, 800)
        self.setMinimumSize(1020, 680)

        # Central Widget
        central_widget = QWidget()
        central_widget.setObjectName("mainCentral")
        self.setCentralWidget(central_widget)

        # Layout
        layout = QVBoxLayout(central_widget)
        layout.setContentsMargins(16, 12, 16, 12)
        layout.setSpacing(10)

        # --- Modern header: logo + name + subtitle + version pill ---
        layout.addWidget(self._build_header())

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
        self.tabs.setExpanding(False)
        self.tabs.setElideMode(Qt.TextElideMode.ElideRight)
        self.tabs.setUsesScrollButtons(True)
        layout.addWidget(self.tabs)
        self.tabs.currentChanged.connect(self.on_tab_changed)

        # Add Tabs (иконки-эмодзи — кроссплатформенно и без ресурсов)
        self.tabs.addTab(TranscriptionTab(), "🎙 Транскрибация")
        self.tabs.addTab(MediaTab(), "⬇ Медиа")
        self.tabs.addTab(ConverterTab(), "🔄 Конвертер")
        self.tabs.addTab(TranslationTab(), "🌐 Перевод")
        self.tabs.addTab(SettingsTab(), "⚙ Настройки")
        self.tabs.addTab(AboutTab(), "ℹ О программе")

        # Restore last active tab (как в вебе: перезапуск возвращает на исходную)
        try:
            last_idx = int(load_config().get("ui_last_tab", 0))
        except Exception:
            last_idx = 0
        if 0 <= last_idx < self.tabs.count():
            self.tabs.setCurrentIndex(last_idx)

        self.queue_panel = QFrame()
        self.queue_panel.setObjectName("queuePanel")
        queue_layout = QVBoxLayout(self.queue_panel)
        queue_layout.setContentsMargins(14, 10, 14, 10)
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

    def _read_version(self) -> str:
        try:
            if getattr(sys, "frozen", False):
                base = getattr(sys, "_MEIPASS", None) or os.path.abspath(
                    os.path.join(os.path.dirname(sys.executable), "../Resources")
                )
                version_file = os.path.join(base, "VERSION")
            else:
                version_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "VERSION"))
            if os.path.exists(version_file):
                with open(version_file, "r", encoding="utf-8") as f:
                    return f.read().strip() or "—"
        except Exception:
            pass
        return "—"

    def _build_header(self) -> QFrame:
        header = QFrame()
        header.setObjectName("appHeader")
        h = QHBoxLayout(header)
        h.setContentsMargins(16, 10, 16, 10)
        h.setSpacing(12)

        logo = QLabel()
        logo.setObjectName("appHeaderLogo")
        logo.setFixedSize(44, 44)
        logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo_path = self._resolve_logo_path()
        if logo_path and os.path.exists(logo_path):
            pix = QPixmap(logo_path)
            if not pix.isNull():
                logo.setPixmap(pix.scaled(
                    40, 40,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                ))
        if logo.pixmap() is None or logo.pixmap().isNull():
            logo.setText("VPA")
        h.addWidget(logo)

        title_wrap = QVBoxLayout()
        title_wrap.setSpacing(1)
        title = QLabel("VoxPaperAi Pro")
        title.setObjectName("appHeaderTitle")
        subtitle = QLabel("Транскрибация · Медиа · Конвертация · Перевод")
        subtitle.setObjectName("appHeaderSubtitle")
        title_wrap.addWidget(title)
        title_wrap.addWidget(subtitle)
        h.addLayout(title_wrap)

        h.addStretch()

        version = QLabel(f"v{self._read_version()}")
        version.setObjectName("appHeaderVersion")
        h.addWidget(version)
        return header

    def _resolve_logo_path(self):
        if getattr(sys, "frozen", False):
            base = getattr(sys, "_MEIPASS", None) or os.path.abspath(
                os.path.join(os.path.dirname(sys.executable), "../Resources")
            )
            return os.path.join(base, "ui", "assets", "logo.png")
        return os.path.abspath(os.path.join(os.path.dirname(__file__), "assets", "logo.png"))

    def show_notification(self, message: str, level: str = "info", timeout_ms: int = 4500):
        is_light = False
        try:
            is_light = QApplication.instance().styleHints().colorScheme() == Qt.ColorScheme.Light
        except Exception:
            is_light = False
        if is_light:
            palette = {
                "info": ("#EAF2FF", "#173A6B", "#9CC2F5"),
                "success": ("#E4F8EC", "#14532D", "#8FD9B1"),
                "warning": ("#FFF6E0", "#5C430F", "#EFC77E"),
                "error": ("#FFE9ED", "#6E1626", "#F1A0AF"),
            }
        else:
            palette = {
                "info": ("#10203B", "#D7E8FF", "#3E6FB8"),
                "success": ("#0F2E22", "#D8F5E5", "#2E9464"),
                "warning": ("#3A2A0C", "#FFF0D3", "#C08A3E"),
                "error": ("#3B121E", "#FFDCE3", "#C25368"),
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
        # Персист активной вкладки: перезапуск приложения вернёт на неё же
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
