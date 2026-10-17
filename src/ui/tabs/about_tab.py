from PyQt6.QtWidgets import QWidget, QVBoxLayout, QTextBrowser, QLabel, QFrame, QHBoxLayout, QScrollArea
from PyQt6.QtCore import Qt
import os
import sys

class AboutTab(QWidget):
    def __init__(self):
        super().__init__()
        self.init_ui()
        
    def init_ui(self):
        outer_layout = QVBoxLayout(self)
        outer_layout.setContentsMargins(0, 0, 0, 0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.Shape.NoFrame)
        outer_layout.addWidget(scroll)

        content = QWidget()
        scroll.setWidget(content)

        layout = QVBoxLayout(content)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(12)

        hero = QFrame()
        hero.setObjectName("aboutHero")
        hero_layout = QHBoxLayout(hero)
        hero_layout.setContentsMargins(20, 20, 20, 20)
        hero_layout.setSpacing(16)

        self.logo_label = QLabel()
        self.logo_label.setFixedSize(88, 88)
        self.logo_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hero_layout.addWidget(self.logo_label)

        title_wrap = QVBoxLayout()
        self.title_label = QLabel()
        self.title_label.setStyleSheet("font-size: 30px; font-weight: 800;")
        title_wrap.addWidget(self.title_label)

        self.subtitle_label = QLabel("Инструмент для транскрибации, медиа-обработки, перевода, конвертации и очередей задач.")
        self.subtitle_label.setWordWrap(True)
        self.subtitle_label.setStyleSheet("font-size: 15px; color: #7A8798;")
        title_wrap.addWidget(self.subtitle_label)

        self.meta_label = QLabel()
        self.meta_label.setStyleSheet("font-size: 13px; font-weight: 600;")
        title_wrap.addWidget(self.meta_label)
        title_wrap.addStretch()
        hero_layout.addLayout(title_wrap, 1)
        layout.addWidget(hero)

        card = QFrame()
        card.setObjectName("aboutCard")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(18, 18, 18, 18)
        card_layout.setSpacing(12)

        self.text_area = QTextBrowser()
        self.text_area.setOpenExternalLinks(True)
        card_layout.addWidget(self.text_area)
        layout.addWidget(card, 1)
        
        self.load_instruction()
        
    def load_instruction(self):
        if getattr(sys, "frozen", False):
            if hasattr(sys, "_MEIPASS"):
                resource_root = sys._MEIPASS
            else:
                resource_root = os.path.abspath(os.path.join(os.path.dirname(sys.executable), "../Resources"))
            version_file = os.path.join(resource_root, "VERSION")
            logo_path = os.path.join(resource_root, "ui", "assets", "logo.png")
        else:
            base_dir = os.path.dirname(__file__)
            version_file = os.path.abspath(os.path.join(base_dir, "..", "..", "..", "VERSION"))
            logo_path = os.path.abspath(os.path.join(base_dir, "..", "assets", "logo.png"))
        
        # Read Version
        version = "Unknown"
        if os.path.exists(version_file):
            with open(version_file, "r") as f:
                version = f.read().strip()
                
        # Logo HTML
        if os.path.exists(logo_path):
            from PyQt6.QtGui import QPixmap

            pix = QPixmap(logo_path)
            self.logo_label.setPixmap(pix.scaled(78, 78, Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
        else:
            self.logo_label.setText("VPA")
            self.logo_label.setStyleSheet("font-size: 24px; font-weight: 800;")

        self.title_label.setText(f"VoxPaperAi Pro <span style='font-size:16px; color:#7A8798;'>v{version}</span>")
        self.meta_label.setText("Whisper • ffmpeg • PyQt6 • PDF/DOCX • Queue Scheduler")

        html_content = f"""
        <div style="line-height: 1.55;">
        <h2 style="margin-top:0;">Что умеет программа</h2>
        <ul>
            <li><b>Транскрибация</b>: аудио/видео, YouTube, импорт ссылок из <b>.txt/.md/.doc/.docx/.odt/.pdf</b>, таймкоды, очередь задач, этапы пайплайна.</li>
            <li><b>Проверка ссылок</b>: перед добавлением каждая ссылка проверяется — страницы каналов, студии, плейлистов и профилей отклоняются сразу с объяснением (не нужно ждать ошибку после старта).</li>
            <li><b>Медиа</b>: скачивание видео/аудио, очистка аудио, вшивание субтитров, перевод субтитров перед хардсабом.</li>
            <li><b>Перевод</b>: TXT/DOCX/PDF через Google/DeepL, режимы <b>FAST</b> и <b>LAYOUT</b> для PDF.</li>
            <li><b>Конвертер</b>: документы, изображения, медиа и сценарии вроде <b>PDF -> PDF</b> без ложных unsupported-ошибок.</li>
        </ul>
        
        <h2>Как начать</h2>
        <ol>
            <li><b>Добавьте файл или ссылку</b> перетаскиванием, вставкой из буфера обмена или импортом ссылок из текстовых/документных файлов.</li>
            <li>Выберите нужную вкладку и параметры обработки.</li>
            <li>Нажмите <b>НАЧАТЬ</b>. Если уже идёт тяжёлая задача, следующая будет поставлена в очередь автоматически.</li>
            <li>После завершения используйте кнопки действий напротив артефакта: открыть папку или скопировать путь/содержимое.</li>
        </ol>
        
        <h2>Горячие клавиши</h2>
        <ul>
            <li><b>Cmd+V / Ctrl+V</b>: Вставить ссылку или путь к файлу из буфера обмена.</li>
            <li><b>Del / Backspace</b>: Удалить выбранный файл из списка.</li>
        </ul>

        <h2>Важно знать</h2>
        <ul>
            <li><b>Перевод</b> требует интернет; при выборе DeepL нужен корректный API key.</li>
            <li><b>YouTube субтитры</b> могут иногда возвращать <b>HTTP 429</b>. В таком случае приложение переходит на fallback через скачивание медиа и Whisper.</li>
            <li><b>Whisper</b> запускается в отдельном подпроцессе, поэтому тяжёлая транскрибация не должна открывать второе главное окно приложения.</li>
            <li><b>PDF режим LAYOUT</b> для финального DOCX→PDF обычно требует Microsoft Word или LibreOffice.</li>
            <li><b>Светлая/тёмная тема</b> подстраивается под систему, включая автоматическое переключение по времени суток на macOS.</li>
            <li><b>Диагностика среды</b> доступна во вкладке <b>Настройки</b>: ffmpeg, ffprobe, LibreOffice, устройство и потоки Whisper.</li>
        </ul>

        <h2>Отказ от ответственности</h2>
        <p>
            Приложение предоставляется <b>“как есть”</b>, без гарантий непрерывной работы,
            точности результатов и совместимости со всеми внешними сервисами. Пользователь
            самостоятельно несёт ответственность за проверку транскрипций, переводов,
            правомерность использования контента и соблюдение правил сторонних платформ.
        </p>
        <p>
            Полный текст уведомления и ограничения ответственности доступны в файле
            <b>DISCLAIMER.txt</b>, который поставляется вместе с приложением.
        </p>
        
        <p style="margin-top:18px; color:#7A8798; font-size:11px;">Разработано с использованием Python, PyQt6, OpenAI Whisper, ffmpeg и дополнительных open-source библиотек.</p>
        </div>
        """
        self.text_area.setHtml(html_content)
