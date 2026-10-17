from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, QComboBox, 
                             QCheckBox, QPushButton, QProgressBar, QTextBrowser, QGroupBox,
                             QLineEdit, QFileDialog, QMessageBox)
from PyQt6.QtCore import Qt, QThread, pyqtSlot
from src.ui.widgets.file_list import FileListWidget
from src.core.worker import TaskWorker
from src.core.subtitles import parse_subtitles
from src.utils.url_checker import classify_url, not_video_message, NOT_VIDEO, SECTION
import logging
import os
import re

class TranscriptionTab(QWidget):
    def __init__(self):
        super().__init__()
        self.logger = logging.getLogger(__name__)
        self._processing_guard_label = "Транскрибация"
        self._task_token = None
        self._task_queued = False
        self.worker = None
        self._retry_indexes = None
        self.init_ui()
        
    def init_ui(self):
        layout = QVBoxLayout(self)
        top_row = QHBoxLayout()
        
        # --- Top Controls ---
        controls_group = QGroupBox("Параметры Whisper")
        controls_layout = QHBoxLayout(controls_group)
        
        # Model
        controls_layout.addWidget(QLabel("Модель:"))
        self.combo_model = QComboBox()
        self.combo_model.addItems(["tiny", "base", "small", "medium", "large-v3"])
        self.combo_model.setCurrentText("base")
        controls_layout.addWidget(self.combo_model)
        
        controls_layout.addSpacing(20) # Spacer
        
        # Language Source
        controls_layout.addWidget(QLabel("Язык аудио:"))
        self.combo_source_lang = QComboBox()
        self.combo_source_lang.addItems(["auto", "ru", "en", "uk", "es", "de", "fr"])
        self.combo_source_lang.setMinimumWidth(140)
        self.combo_source_lang.setMinimumContentsLength(8)
        self.combo_source_lang.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToContentsOnFirstShow)
        self.combo_source_lang.view().setMinimumWidth(220)
        controls_layout.addWidget(self.combo_source_lang)

        controls_layout.addSpacing(20) # Spacer

        # Language Target (Translation)
        controls_layout.addWidget(QLabel("Перевод на:"))
        self.combo_target_lang = QComboBox()
        self.combo_target_lang.addItems(["-", "ru", "en", "uk", "es", "de", "fr"])
        self.combo_target_lang.setToolTip("Выберите язык для перевода текста (опционально)")
        self.combo_target_lang.setMinimumWidth(160)
        self.combo_target_lang.setMinimumContentsLength(8)
        self.combo_target_lang.setSizeAdjustPolicy(QComboBox.SizeAdjustPolicy.AdjustToContentsOnFirstShow)
        self.combo_target_lang.view().setMinimumWidth(240)
        controls_layout.addWidget(self.combo_target_lang)
        
        controls_layout.addStretch() # Push everything to left
        
        top_row.addWidget(controls_group, 2)

        # --- Output Folder ---
        folder_group = QGroupBox("Папка сохранения")
        folder_layout = QHBoxLayout(folder_group)
        
        self.line_output_dir = QLineEdit()
        self.line_output_dir.setText(os.path.join(os.getcwd(), "whisper_output"))
        folder_layout.addWidget(self.line_output_dir)
        
        self.btn_browse = QPushButton("Обзор...")
        self.btn_browse.clicked.connect(self.browse_output_dir)
        folder_layout.addWidget(self.btn_browse)
        top_row.addWidget(folder_group, 1)
        layout.addLayout(top_row)
        
        # --- Options ---
        options_group = QGroupBox("Режимы и Опции")
        options_layout = QHBoxLayout(options_group)
        
        # Save Options
        self.chk_timecodes = QCheckBox("Таймкоды")
        self.chk_timecodes.setChecked(True)
        options_layout.addWidget(self.chk_timecodes)
        
        self.chk_save_audio = QCheckBox("Сохр. mp3")
        options_layout.addWidget(self.chk_save_audio)
        
        self.chk_save_video = QCheckBox("Сохр. видео")
        options_layout.addWidget(self.chk_save_video)
        
        layout.addWidget(options_group)
        
        # --- List Actions ---
        list_actions_layout = QHBoxLayout()
        
        self.btn_paste = QPushButton("📋 Вставить ссылку")
        self.btn_paste.setObjectName("ghostButton")
        self.btn_paste.clicked.connect(lambda: self.file_list.paste_from_clipboard())
        list_actions_layout.addWidget(self.btn_paste)

        self.btn_import_links = QPushButton("📄 Импорт ссылок (.txt)")
        self.btn_import_links.setObjectName("ghostButton")
        self.btn_import_links.clicked.connect(self.import_links_from_txt)
        list_actions_layout.addWidget(self.btn_import_links)
        
        self.btn_clear = QPushButton("🗑 Очистить список")
        self.btn_clear.setObjectName("ghostButton")
        self.btn_clear.clicked.connect(lambda: self.file_list.clear())
        list_actions_layout.addWidget(self.btn_clear)

        self.btn_clear_logs = QPushButton("🗑 Очистить логи")
        self.btn_clear_logs.setObjectName("ghostButton")
        self.btn_clear_logs.clicked.connect(self.clear_logs)
        list_actions_layout.addWidget(self.btn_clear_logs)
        
        list_actions_layout.addStretch()
        layout.addLayout(list_actions_layout)
        
        # --- File List ---
        self.file_list = FileListWidget()
        # Force transcription formats regardless of input file type
        self.file_list.set_override_formats(["txt", "docx", "srt", "json", "vtt", "md"])
        self.file_list.files_dropped.connect(self.on_files_dropped)
        self.file_list.urls_rejected.connect(self.on_urls_rejected)
        # self.file_list.set_format_options(...) # Not needed if overriding
        layout.addWidget(self.file_list)
        
        # --- Buttons ---
        btn_layout = QHBoxLayout()
        self.btn_start = QPushButton("НАЧАТЬ ОБРАБОТКУ")
        self.btn_start.setObjectName("successButton")
        self.btn_start.clicked.connect(self.start_processing)
        btn_layout.addWidget(self.btn_start)
        
        self.btn_stop = QPushButton("СТОП")
        self.btn_stop.setObjectName("dangerButton")
        self.btn_stop.clicked.connect(self.stop_processing)
        self.btn_stop.setEnabled(False)
        btn_layout.addWidget(self.btn_stop)
        
        layout.addLayout(btn_layout)

        self.queue_status_label = QLabel("Готов к работе")
        self.queue_status_label.setObjectName("statusLabel")
        layout.addWidget(self.queue_status_label)
        
        # --- Log & Progress ---
        self.progress_bar = QProgressBar()
        layout.addWidget(self.progress_bar)
        
        self.log_text = QTextBrowser()
        self.log_text.setReadOnly(True)
        self.log_text.setMaximumHeight(150)
        # Enable links
        self.log_text.setOpenExternalLinks(False)
        self.log_text.anchorClicked.connect(self.on_link_clicked)
        layout.addWidget(self.log_text)

        # Load saved settings and connect signals
        self.load_settings()
        
        self.combo_model.currentTextChanged.connect(self.save_settings)
        self.combo_source_lang.currentTextChanged.connect(self.save_settings)
        self.combo_target_lang.currentTextChanged.connect(self.save_settings)
        self.chk_timecodes.toggled.connect(self.save_settings)
        self.chk_save_audio.toggled.connect(self.save_settings)
        self.chk_save_video.toggled.connect(self.save_settings)
        self.line_output_dir.textChanged.connect(self.save_settings)
        from src.utils.processing_guard import processing_notifier
        processing_notifier().state_changed.connect(self._refresh_processing_status)
        self._refresh_processing_status()

    def clear_logs(self):
        self.log_text.clear()
        self.progress_bar.setValue(0)
        self.log("✅ Логи очищены. Можно запускать новую обработку.")

    def _notify(self, message: str, level: str = "info"):
        main_window = self.window()
        if hasattr(main_window, "show_notification"):
            main_window.show_notification(message, level=level)
        else:
            QMessageBox.information(self, "VoxPaperAi", message)

    def _refresh_processing_status(self, snapshot=None):
        from src.utils.processing_guard import processing_snapshot
        snapshot = snapshot or processing_snapshot()
        active_label = snapshot.get("active_label")
        queue = snapshot.get("queue") or []
        queue_pos = next((idx + 1 for idx, item in enumerate(queue) if item.get("token") == self._task_token), None)

        if self.worker and self.worker.isRunning():
            self.queue_status_label.setText("Выполняется: Транскрибация")
        elif self._task_queued and queue_pos is not None:
            lead = active_label or "предыдущая задача"
            self.queue_status_label.setText(f"В очереди #{queue_pos}: ждёт после «{lead}»")
        elif active_label:
            self.queue_status_label.setText(f"Сейчас выполняется: {active_label}")
        else:
            self.queue_status_label.setText("Готов к работе")

    def _extract_urls_from_text(self, text: str) -> list[str]:
        from src.utils.url_checker import extract_urls_from_text

        return extract_urls_from_text(text or "")

    def _extract_urls_from_document(self, path: str) -> list[str]:
        from src.core.translator import Translator

        content = Translator().read_file_content(path)
        return self._extract_urls_from_text(content or "")

    def on_files_dropped(self, paths: list[str]):
        """If user drops a text-like file with links, import URLs as tasks."""
        imported_total = 0
        removed_total = 0
        rejected_messages: list[str] = []
        importable_exts = {".txt", ".md", ".json", ".csv", ".log", ".xml", ".doc", ".docx", ".odt", ".rtf", ".rtfd", ".pdf"}
        for p in paths:
            if os.path.isfile(p) and os.path.splitext(p)[1].lower() in importable_exts:
                try:
                    urls = self._extract_urls_from_document(p)
                    if urls:
                        for u in urls:
                            verdict, hint = classify_url(u)
                            if verdict == NOT_VIDEO:
                                rejected_messages.append(not_video_message(u, hint or SECTION))
                                continue
                            self.file_list.add_file(u)
                            imported_total += 1
                        if self.file_list.remove_by_path(p):
                            removed_total += 1
                    else:
                        # Not a links list: remove to avoid confusion in transcription queue
                        if self.file_list.remove_by_path(p):
                            removed_total += 1
                        QMessageBox.information(
                            self,
                            "Импорт ссылок",
                            f"Файл не содержит ссылок (http/https): {os.path.basename(p)}",
                        )
                except Exception as e:
                    QMessageBox.warning(self, "Импорт ссылок", f"Не удалось прочитать файл: {e}")

        if imported_total:
            self.log(f"✅ Импортировано ссылок из документа: {imported_total}")
        if rejected_messages:
            self._show_rejected_notice(rejected_messages)

    def on_urls_rejected(self, messages: list):
        """Ссылки «не на видео» отклонены классификатором при вставке."""
        for msg in messages:
            self.log(f"⚠️ {msg}")
        self._show_rejected_notice(list(messages))

    def _show_rejected_notice(self, messages: list):
        if not messages:
            return
        shown = messages[:4]
        if len(messages) > len(shown):
            shown.append(f"… и ещё {len(messages) - len(shown)}")
        self._notify("\n".join(shown), "warning")

    def import_links_from_txt(self):
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("transcription_import_links_clicked")
        except Exception:
            pass
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Импорт ссылок из документа",
            "",
            "Documents (*.txt *.md *.json *.csv *.log *.xml *.doc *.docx *.odt *.rtf *.rtfd *.pdf);;All Files (*)",
        )
        if not path:
            return
        try:
            urls = self._extract_urls_from_document(path)
            if not urls:
                QMessageBox.information(self, "Импорт ссылок", "В файле не найдено ссылок (http/https).")
                return
            added = 0
            rejected_messages: list[str] = []
            for u in urls:
                verdict, hint = classify_url(u)
                if verdict == NOT_VIDEO:
                    rejected_messages.append(not_video_message(u, hint or SECTION))
                    continue
                if self.file_list.add_file(u) is not False:
                    added += 1
            self.log(f"✅ Импортировано ссылок: {added}")
            if rejected_messages:
                self._show_rejected_notice(rejected_messages)
        except Exception as e:
            QMessageBox.warning(self, "Импорт ссылок", f"Ошибка: {e}")

    def load_settings(self):
        from src.utils.config import load_config
        config = load_config()
        
        self.combo_model.setCurrentText(config.get("model", "base"))
        self.combo_source_lang.setCurrentText(config.get("source_lang", "auto"))
        self.combo_target_lang.setCurrentText(config.get("target_lang", "-"))
        
        self.chk_timecodes.setChecked(config.get("chk_timecodes", True))
        self.chk_save_audio.setChecked(config.get("chk_save_audio", False))
        self.chk_save_video.setChecked(config.get("chk_save_video", False))
        
        self.line_output_dir.setText(config.get("transcription_output_dir", os.path.join(os.getcwd(), "whisper_output")))
        self.update_ui_state()

    def save_settings(self, *args):
        from src.utils.config import load_config, save_config
        config = load_config()
        
        config["model"] = self.combo_model.currentText()
        config["source_lang"] = self.combo_source_lang.currentText()
        config["target_lang"] = self.combo_target_lang.currentText()
        
        config["chk_timecodes"] = self.chk_timecodes.isChecked()
        config["chk_save_audio"] = self.chk_save_audio.isChecked()
        config["chk_save_video"] = self.chk_save_video.isChecked()
        
        config["transcription_output_dir"] = self.line_output_dir.text()
        
        save_config(config)

    def browse_output_dir(self):
        dir_path = QFileDialog.getExistingDirectory(self, "Выберите папку для сохранения", self.line_output_dir.text())
        if dir_path:
            self.line_output_dir.setText(dir_path)

    def update_ui_state(self):
        pass

    def log(self, data):
        link = None
        message = ""
        
        if isinstance(data, tuple):
            message, link = data
        else:
            message = str(data)
            
        if link:
            # message is the text, link is the URL/Action
            # We use a custom scheme 'action:'
            # Use file:// protocol for local files
            if not link.startswith("file://") and not link.startswith("http") and not link.startswith("copy:"):
                 link = f"file://{link}"
                 
            if link.startswith("copy:"):
                html = f'{message} <a href="{link}" style="color: #2196F3; text-decoration: none; font-weight: bold;">[📋 Копировать]</a>'
            else:
                html = f'{message} <a href="{link}" style="color: #4CAF50; text-decoration: none; font-weight: bold;">[📂 Открыть папку]</a>'
            
            self.log_text.append(html)
        else:
            self.log_text.append(message)
            
        # Auto scroll
        sb = self.log_text.verticalScrollBar()
        sb.setValue(sb.maximum())

    def on_link_clicked(self, url):
        import subprocess
        import sys
        from PyQt6.QtWidgets import QApplication
        
        path = url.toString()
        
        if path.startswith("copy:"):
            text_to_copy = path[5:] # Remove 'copy:' prefix
            
            file_path = text_to_copy
            if os.path.exists(file_path) and file_path.endswith('.txt'):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        QApplication.clipboard().setText(content)
                        self.log("📋 Текст скопирован в буфер обмена!")
                except Exception as e:
                    self.log(f"⚠️ Ошибка копирования: {e}")
            else:
                 QApplication.clipboard().setText(file_path)
                 self.log("📋 Путь скопирован в буфер обмена!")
            return

        if path.startswith("file://"):
            path = path[7:]
            
        self.log(f"📂 Открываю: {path}")
        
        try:
            if sys.platform == "win32":
                os.startfile(path)
            elif sys.platform == "darwin":
                subprocess.run(["open", path])
            else:
                subprocess.run(["xdg-open", path])
        except Exception as e:
            self.log(f"⚠️ Ошибка открытия: {e}")

    def start_processing(self):
        from src.utils.processing_guard import active_processing_label, schedule_processing
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("transcription_start_clicked", queue_len=len(self.file_list.files))
        except Exception:
            pass
        retry_indexes = self._retry_indexes
        self._retry_indexes = None
        files_data = []
        for i, f in enumerate(self.file_list.files):
            should_process = f['status'] != 'Готово' if retry_indexes is None else i in retry_indexes
            if should_process:
                fmt = self.file_list.get_file_format(i)
                files_data.append({'path': f['path'], 'format': fmt, 'row_index': i})
        
        if not files_data:
            self.log("Нет файлов для обработки.")
            return

        self._show_duration_estimate(files_data)

        if self._task_queued:
            self._notify("Эта задача уже стоит в очереди.", "warning")
            return
        if self.worker and self.worker.isRunning():
            self._notify("Транскрибация уже выполняется.", "warning")
            return

        # Configuration
        from src.utils.config import load_config
        app_config = load_config()
        
        from src.utils.runtime import resolve_whisper_device

        config = {
            'model': self.combo_model.currentText(),
            'language': self.combo_source_lang.currentText(),
            'translate_to': self.combo_target_lang.currentText(),
            'device': resolve_whisper_device(app_config.get("device", "Auto")),
            'cpu_threads': app_config.get("cpu_threads", "Auto"),
            'timecodes': self.chk_timecodes.isChecked(),
            'save_audio': self.chk_save_audio.isChecked(),
            'save_video': self.chk_save_video.isChecked(),
            'output_dir': self.line_output_dir.text().strip()
        }
        
        if not config['output_dir']:
            from PyQt6.QtWidgets import QMessageBox
            reply = QMessageBox.question(self, "Папка сохранения",
                                         "Папка сохранения не выбрана. Файлы будут сохранены в папке 'whisper_output'. Продолжить?",
                                         QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if reply == QMessageBox.StandardButton.No:
                self.btn_start.setEnabled(True)
                return
            config['output_dir'] = os.path.join(os.getcwd(), "whisper_output")
            self.line_output_dir.setText(config['output_dir'])
        
        # Ensure output dir exists
        if not os.path.exists(config['output_dir']):
            try:
                os.makedirs(config['output_dir'])
            except Exception as e:
                self.log(f"❌ Ошибка создания папки: {e}")
                self.btn_start.setEnabled(True)
                return

        def _start_from_queue():
            self._task_queued = False
            self.log(f"Начинаем обработку {len(files_data)} файлов...")
            self.btn_start.setEnabled(False)
            self.btn_stop.setEnabled(True)
            self.progress_bar.setValue(0)
            self.worker = TaskWorker(self.process_task, files_data, config)
            self.worker.log.connect(self.log)
            self.worker.progress.connect(self.progress_bar.setValue)
            self.worker.status_update.connect(self.file_list.update_status)
            self.worker.file_result.connect(self.file_list.set_file_result)
            self.worker.file_retry_available.connect(self._offer_retry)
            self.worker.finished.connect(self.on_finished)
            self.worker.error.connect(self.on_error)
            self.worker.start()

        scheduled = schedule_processing(self._processing_guard_label, _start_from_queue)
        self._task_token = scheduled["token"]
        if not scheduled["started"]:
            self._task_queued = True
            self.btn_start.setEnabled(False)
            self.btn_stop.setEnabled(True)
            busy = scheduled["active_label"] or active_processing_label() or "другая задача"
            self.log(f"⏳ Задача поставлена в очередь ({scheduled['position']}). Сначала завершится: {busy}.")
            self._notify(f"Сейчас выполняется: {busy}. Транскрибация поставлена в очередь и запустится автоматически следующей.", "info")

    def retry_file(self, index: int):
        """Repeat just the selected failed item and leave successful items untouched."""
        if self.worker and self.worker.isRunning():
            self._notify("Дождитесь завершения текущей обработки.", "warning")
            return
        if not (0 <= index < len(self.file_list.files)):
            return
        self.file_list.update_status(index, "Ожидание")
        self._retry_indexes = {index}
        self.log("🔄 Повторный запуск выбранной задачи...")
        self.start_processing()

    @pyqtSlot(int)
    def _offer_retry(self, index: int):
        """Runs in the tab's UI thread when a worker reports a failed row."""
        self.file_list.set_retry_action(index, lambda: self.retry_file(index))

    def _show_duration_estimate(self, files_data):
        """Show a conservative estimate for files whose duration is known locally."""
        from src.utils.fs import get_audio_duration

        total = sum(
            get_audio_duration(item['path']) or 0
            for item in files_data
            if not item['path'].startswith("http")
        )
        if not total:
            return
        minutes, seconds = divmod(int(total), 60)
        duration_text = f"{minutes} мин {seconds} сек" if minutes else f"{seconds} сек"
        QMessageBox.information(
            self,
            "Оценка обработки",
            f"Длительность локальных файлов: {duration_text}.\n\n"
            "На CPU с моделью base распознавание часто занимает примерно столько же времени. "
            "Фактическая скорость зависит от модели, процессора и фоновой нагрузки; "
            "для URL оценка будет доступна после скачивания.",
        )

    def stop_processing(self):
        from src.utils.processing_guard import cancel_processing
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("transcription_stop_clicked")
        except Exception:
            pass
        if self._task_queued and cancel_processing(self._task_token):
            self._task_queued = False
            self._task_token = None
            self.log("🛑 Задача удалена из очереди.")
            self.btn_start.setEnabled(True)
            self.btn_stop.setEnabled(False)
            self._refresh_processing_status()
            return
        if self.worker and self.worker.isRunning():
            self.worker.request_stop()
            self.log("Остановка (дождитесь завершения текущего этапа)...")
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)

    def on_finished(self, result):
        from src.utils.processing_guard import release_processing
        release_processing(self._task_token)
        self._task_token = None
        errors = int(result.get("errors", 0)) if isinstance(result, dict) else 0
        success = int(result.get("success", 0)) if isinstance(result, dict) else 0
        total = int(result.get("total", 0)) if isinstance(result, dict) else 0
        if result is False:
             self.log("🛑 Обработка остановлена пользователем.")
        elif errors:
             self.log(f"⚠️ Обработка завершена с ошибками: успешно {success}/{total}, ошибок: {errors}.")
             self._notify(f"Транскрибация завершена с ошибками: {success}/{total} успешно.", "warning")
        else:
             self.log("✅ Обработка завершена.")
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self.progress_bar.setValue(100)
        self._refresh_processing_status()

    def on_error(self, err):
        from src.utils.processing_guard import release_processing
        release_processing(self._task_token)
        self._task_token = None
        self.log(f"❌ Ошибка: {err}")
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self._refresh_processing_status()

    def process_task(self, worker_obj, files, config):
        from src.core.downloader import Downloader
        from src.core.engine import WhisperEngine
        from src.core.converter import Converter
        import os
        import tempfile
        import time
        import traceback
        import shutil
        from src.utils.fs import safe_artifact_part
        
        total = len(files)
        summary = {"total": total, "success": 0, "errors": 0}
        downloader = Downloader(config['output_dir'])
        converter = Converter()
        
        # Load engine
        engine = WhisperEngine(
            model_name=config['model'],
            device=config['device'],
            num_threads=config.get('cpu_threads', 'Auto'),
        )

        audio_exts = {'.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.alac', '.wma'}
        video_exts = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv'}

        def unique_path(directory, filename):
            name, ext = os.path.splitext(filename)
            candidate = os.path.join(directory, filename)
            counter = 1
            while os.path.exists(candidate):
                candidate = os.path.join(directory, f"{name}_{counter}{ext}")
                counter += 1
            return candidate

        download_progress_state = {"bucket": -1}

        def download_progress_callback(percent, eta_str=""):
            base_progress = int(i / total * 100)
            staged = min(45, int(percent * 0.45))
            worker_obj.progress.emit(base_progress + staged)
            bucket = int(percent // 10)
            if bucket > download_progress_state["bucket"]:
                download_progress_state["bucket"] = bucket
                worker_obj.log.emit(f"⬇️ Скачивание: {percent}%")
            if eta_str:
                worker_obj.status_update.emit(row_index, f"Скачивание... ({eta_str})")

        def display_name_for_input(input_value: str) -> str:
            if not input_value.startswith("http"):
                return os.path.basename(input_value)
            try:
                label = downloader.get_artifact_label(input_value)
                if label:
                    return label
            except Exception:
                pass
            tail = input_value.strip().rstrip("/").split("/")[-1] or "link"
            return safe_artifact_part(tail)[:80] or "link"

        def persist_downloaded_media(downloaded_path: str):
            in_ext = os.path.splitext(downloaded_path)[1].lower()

            if config['save_video'] and in_ext in video_exts:
                dst = unique_path(config['output_dir'], os.path.basename(downloaded_path))
                worker_obj.log.emit("🎞 Сохранение видео в выходную папку...")
                shutil.copy2(downloaded_path, dst)
                worker_obj.log.emit(f"✅ Видео сохранено: {os.path.basename(dst)}")

            if config['save_audio']:
                if in_ext == '.mp3':
                    dst = unique_path(config['output_dir'], os.path.basename(downloaded_path))
                    worker_obj.log.emit("🎵 Сохранение аудио в выходную папку...")
                    shutil.copy2(downloaded_path, dst)
                    worker_obj.log.emit(f"✅ Аудио сохранено: {os.path.basename(dst)}")
                elif in_ext in audio_exts or in_ext in video_exts:
                    worker_obj.log.emit("🎵 Сохранение аудио (mp3) в выходную папку...")
                    saved_audio = converter.convert_media(downloaded_path, 'mp3', config['output_dir'], worker_obj=worker_obj)
                    worker_obj.log.emit(f"✅ Аудио сохранено: {os.path.basename(saved_audio)}")
        
        for i, file_data in enumerate(files):
            if worker_obj.is_stop_requested():
                return False
                
            row_index = file_data.get('row_index', i)
            file_path = file_data['path']
            fmt = file_data.get('format', 'txt')
            artifact_base = os.path.splitext(display_name_for_input(file_path))[0]
            
            c_hex = ["#4DA6FF", "#FFB74D", "#9CCC65", "#BA68C8", "#FF8A65"][i % 5]
            worker_obj.log.emit(f"<br><span style='color:{c_hex}; font-size:14px; font-weight:bold;'>🚀 Задача {i+1}/{total}: {artifact_base} (Формат: {fmt})</span>")
            worker_obj.status_update.emit(row_index, "Обработка...")
            
            temp_dir_ctx = None
            try:
                # --- 1. Handle URL Downloads ---
                was_downloaded = False
                is_new_file = False # Track if we created it
                subs_actual_lang = None  # Track language of downloaded subtitles
                task_downloader = downloader
                
                if file_path.startswith("http"):
                    temp_dir_ctx = tempfile.TemporaryDirectory(prefix="voxpaperai-transcription-")
                    task_downloader = Downloader(temp_dir_ctx.name)
                    was_downloaded = True
                    worker_obj.status_update.emit(row_index, "Этап 1/5: субтитры")
                    worker_obj.log.emit(f"🌐 Скачивание: {file_path}")
                    
                    # Track what language we actually got subtitles in
                    subs_actual_lang = None
                    
                    # LOGIC: Subtitle Priority (New Feature)
                    # 1. Check for subtitles
                    worker_obj.log.emit("🔎 Поиск субтитров...")
                    subs_info = task_downloader.list_subtitles(file_path)
                    
                    target_sub_lang = None
                    is_auto_sub = False
                    
                    req_lang = config['language']
                    fallback_langs = [lang for lang in ["en", "ru", "uk"] if lang != req_lang]
                    subtitle_choice = task_downloader.choose_subtitle_track(
                        subs_info,
                        req_lang,
                        fallback_langs=fallback_langs,
                    )
                    if subtitle_choice:
                        target_sub_lang = subtitle_choice["lang"]
                        is_auto_sub = subtitle_choice["auto"]
                    
                    # Execute Subtitle Download if found
                    if target_sub_lang:
                        worker_obj.log.emit(
                            f"✅ Найдено: субтитры '{target_sub_lang}' "
                            f"({'авто' if is_auto_sub else 'вручную'}). "
                            f"Причина выбора: {subtitle_choice['reason']}. Скачиваем..."
                        )
                        
                        sub_path = None
                        try:
                            sub_path = task_downloader.download_subtitles(
                                file_path,
                                target_sub_lang,
                                auto=is_auto_sub,
                                allow_auto_fallback=True,
                            )
                        except Exception as e:
                            worker_obj.log.emit(f"⚠️ Ошибка скачивания субтитров: {e}")
                            sub_path = None

                        if sub_path and os.path.exists(sub_path):
                            worker_obj.log.emit(f"📜 Субтитры скачаны: {os.path.basename(sub_path)}")
                            
                            # Parse VTT/SRT to internal format
                            # We need to simulate Whisper result structure: {'segments': [{'start': 0, 'end': 0, 'text': '...'}]}
                            parsed_segments = parse_subtitles(sub_path)
                            
                            # CLEANUP: Remove downloaded subtitle file after parsing
                            try:
                                os.remove(sub_path)
                            except Exception as e:
                                pass # Ignore deletion errors
                            
                            if parsed_segments:
                                result = {'segments': parsed_segments, 'text': " ".join([s['text'] for s in parsed_segments])}
                                subs_actual_lang = target_sub_lang  # Track what language the subtitles are in
                                
                                # If we downloaded a different language than requested, we MUST translate it
                                # e.g. User wanted 'ru', we got 'en'.
                                # OR if user explicitly requested translation to X
                                
                                # Logic:
                                # If target_sub_lang != config['language'], we treat it as "source was target_sub_lang".
                                
                                # Handle Media Download (if requested)
                                if config['save_video'] or config['save_audio']:
                                     worker_obj.log.emit("📥 Скачивание медиа (по запросу пользователя)...")
                                     # We download but don't transcribe
                                     extract_audio = not config['save_video']
                                     try:
                                         # Update file_path to the downloaded media!
                                         # This is critical so that Step 4 (Save) and Step 5 (Post-Processing) use the local file.
                                         file_path, is_new_file = task_downloader.download(
                                             file_path,
                                             extract_audio=extract_audio,
                                             worker_obj=worker_obj,
                                             progress_callback=download_progress_callback,
                                         )
                                         was_downloaded = True
                                         artifact_base = os.path.splitext(os.path.basename(file_path))[0]
                                         
                                     except Exception as e:
                                         worker_obj.log.emit(f"⚠️ Ошибка скачивания медиа: {e}")
                                
                                # Jump to Translation


                            else:
                                worker_obj.log.emit("⚠️ Не удалось прочитать субтитры. Переход к транскрибации.")
                                target_sub_lang = None # Fallback
                        else:
                             # Logged in except block or if path invalid
                             if not sub_path:
                                 worker_obj.log.emit("⚠️ Не удалось скачать субтитры. Переход к транскрибации.")
                             target_sub_lang = None
                    
                    if not target_sub_lang:
                        if worker_obj.is_stop_requested(): return False
                        
                        # Fallback to standard download & transcribe
                        worker_obj.log.emit("⚠️ Подходящих субтитров не найдено. Только теперь переходим к скачиванию медиа и транскрибации...")
                        worker_obj.status_update.emit(row_index, "Этап 2/5: скачивание")
                        extract_audio = not config['save_video']
                        file_path, is_new_file = task_downloader.download(
                            file_path,
                            extract_audio=extract_audio,
                            worker_obj=worker_obj,
                            progress_callback=download_progress_callback,
                        )
                        # Guard against silent download failures: never hand a
                        # non-existent path to Whisper.
                        if not os.path.exists(file_path):
                            raise RuntimeError(
                                "Скачивание не удалось: файл отсутствует после загрузки "
                                "(возможна блокировка YouTube HTTP 429). Попробуйте позже."
                            )
                        worker_obj.log.emit(f"✅ Загружено: {os.path.basename(file_path)}")
                        artifact_base = os.path.splitext(os.path.basename(file_path))[0]
                        
                        if worker_obj.is_stop_requested(): return False
                        
                        # --- 2. Transcribe ---
                        worker_obj.log.emit(f"🧠 Транскрибация ({config['model']})...")
                        worker_obj.status_update.emit(row_index, "Этап 3/5: распознавание")
                        
                        def progress_callback(percent, eta_str=""):
                            global_p = int((i / total * 100) + (percent / total))
                            worker_obj.progress.emit(global_p)
                            if eta_str:
                                worker_obj.status_update.emit(row_index, f"Обработка... ({eta_str})")
                        
                        result = engine.transcribe(
                            file_path,
                            language=config['language'],
                            progress_callback=progress_callback,
                            log_callback=worker_obj.log.emit,
                            worker_obj=worker_obj,
                        )
                    else:
                        # We have result from subtitles
                        # result is already set above
                        pass

                else:
                    # Local file - just transcribe
                    
                    worker_obj.log.emit(f"🧠 Транскрибация ({config['model']})...")
                    worker_obj.status_update.emit(row_index, "Этап 3/5: распознавание")
                    if worker_obj.is_stop_requested(): return False
                    
                    def progress_callback(percent, eta_str=""):
                        global_p = int((i / total * 100) + (percent / total))
                        worker_obj.progress.emit(global_p)
                        if eta_str:
                            worker_obj.status_update.emit(row_index, f"Обработка... ({eta_str})")
                    result = engine.transcribe(
                        file_path,
                        language=config['language'],
                        progress_callback=progress_callback,
                        log_callback=worker_obj.log.emit,
                        worker_obj=worker_obj,
                    )
                
                # --- 3. Translate (if requested) ---
                final_result = result
                suffix = ""
                
                # Determine if translation is actually needed. When the UI source
                # is "auto", use Whisper's detected language rather than comparing
                # the target with the literal string "auto".
                from src.core.transcription_policy import needs_translation

                target_lang = config['translate_to']
                detected_lang = result.get('language') if isinstance(result, dict) else None
                need_translate = needs_translation(
                    target_lang,
                    config['language'],
                    detected_source_language=detected_lang,
                    subtitle_language=subs_actual_lang,
                )
                if target_lang != "-" and not need_translate:
                    source_lang = subs_actual_lang or detected_lang or config['language']
                    worker_obj.log.emit(
                        f"ℹ️ Исходный язык '{source_lang}' совпадает с целевым '{target_lang}' — перевод не требуется."
                    )
                
                if need_translate:
                    if worker_obj.is_stop_requested(): return False
                    
                    worker_obj.log.emit(f"🌍 Перевод на '{target_lang}'...")
                    worker_obj.status_update.emit(row_index, "Этап 4/5: перевод")
                    
                    from src.core.translator import Translator
                    translator = Translator()
                    
                    texts = [s['text'] for s in result['segments']]
                    total_chars = sum(len(t or "") for t in texts)
                    worker_obj.log.emit(f"ℹ️ Сегментов для перевода: {len(texts)} | символов: {total_chars}")
                    
                    def trans_progress(percent, eta_str=""):
                        global_p = int((i / total * 100) + (percent / total))
                        worker_obj.progress.emit(global_p)
                        if eta_str:
                            worker_obj.status_update.emit(row_index, f"Перевод... ({eta_str})")

                    fast_whole_text = (
                        fmt in {"txt", "docx", "md"}
                        and not config.get('timecodes', True)
                        and len((result.get('text') or "").strip()) > 0
                    )

                    if fast_whole_text:
                        worker_obj.log.emit("⚡ Быстрый режим перевода: единый текстовый блок")
                        translated_full = translator.translate_text(
                            result.get('text', ''),
                            target_lang=target_lang,
                            progress_callback=trans_progress,
                        )
                        paragraph_texts = [p.strip() for p in re.split(r'\n\s*\n', translated_full or "") if p.strip()]
                        if not paragraph_texts and translated_full:
                            paragraph_texts = [translated_full.strip()]
                        final_result = {
                            'text': translated_full,
                            'segments': [
                                {'start': 0.0, 'end': 0.0, 'text': paragraph}
                                for paragraph in paragraph_texts
                            ] or [{'start': 0.0, 'end': 0.0, 'text': translated_full or ''}]
                        }
                    else:
                        translated_texts = translator.translate_batch(texts, target_lang=target_lang, progress_callback=trans_progress)
                        
                        import copy
                        final_result = copy.deepcopy(result)
                        for k, s in enumerate(final_result['segments']):
                            if k < len(translated_texts):
                                s['text'] = translated_texts[k]
                        final_result['text'] = "\n".join([s.get('text', '').strip() for s in final_result['segments'] if s.get('text', '').strip()])
                    suffix = f"_{target_lang}"
                
                # If subtitle language matches target and no translation was done, use clean name
                if not need_translate and suffix == "":
                    # No translation needed and no suffix set; keep clean name
                    pass
                    
                # --- 4. Save Text Result ---
                saved_path = self.save_result(
                    final_result,
                    config,
                    file_path,
                    worker_obj,
                    fmt,
                    suffix=suffix,
                    artifact_base_name=artifact_base,
                )
                if not saved_path:
                    raise RuntimeError("Не удалось сохранить результат транскрибации")
                worker_obj.status_update.emit(row_index, "Этап 5/5: сохранение")
                if saved_path:
                    worker_obj.file_result.emit(row_index, saved_path)
                    worker_obj.status_update.emit(row_index, "Готово")
                
                # --- 4.5 Media Post-Processing Skipped for Transcription Tab ---

                # --- 5. Post-Processing (Save Media) ---
                if was_downloaded:
                    if config['save_video'] or config['save_audio']:
                        try:
                            persist_downloaded_media(file_path)
                        except Exception as e:
                            worker_obj.log.emit(f"⚠️ Ошибка сохранения медиа: {e}")
                else:
                    # Local file: optional copy/extract into output_dir (to match checkbox expectations)
                    in_ext = os.path.splitext(file_path)[1].lower()
                    try:
                        if config['save_video'] and in_ext in video_exts:
                            src_abs = os.path.abspath(file_path)
                            out_abs = os.path.abspath(config['output_dir'])
                            if os.path.dirname(src_abs) != out_abs:
                                dst = unique_path(out_abs, os.path.basename(file_path))
                                worker_obj.log.emit("🎞 Сохранение видео в выходную папку...")
                                shutil.copy2(src_abs, dst)
                                worker_obj.log.emit(f"✅ Видео сохранено: {os.path.basename(dst)}")
                            else:
                                worker_obj.log.emit("ℹ️ Видео уже находится в выходной папке.")

                        if config['save_audio']:
                            if worker_obj.is_stop_requested():
                                return False
                            if in_ext in audio_exts or in_ext in video_exts:
                                worker_obj.log.emit("🎵 Сохранение аудио (mp3) в выходную папку...")
                                converter.convert_media(file_path, 'mp3', config['output_dir'], worker_obj=worker_obj)
                                worker_obj.log.emit("✅ Аудио сохранено.")
                    except Exception as e:
                        worker_obj.log.emit(f"⚠️ Ошибка сохранения медиа: {e}")

                # Update progress
                summary["success"] += 1
                worker_obj.progress.emit(int((i + 1) / total * 100))
                
            except Exception as e:
                summary["errors"] += 1
                worker_obj.log.emit(f"⚠️ Ошибка с {os.path.basename(file_path)}: {e}")
                worker_obj.log.emit(traceback.format_exc())
                worker_obj.status_update.emit(row_index, "Ошибка")
                worker_obj.file_retry_available.emit(row_index)
            finally:
                if temp_dir_ctx is not None:
                    try:
                        temp_dir_ctx.cleanup()
                    except Exception:
                        pass

                # Anti-HTTP-429: pause between URL tasks so YouTube does not
                # throttle rapid consecutive requests (subtitles + media).
                if (
                    file_path.startswith("http")
                    and i < total - 1
                    and not worker_obj.is_stop_requested()
                ):
                    pause_seconds = 5
                    worker_obj.log.emit(f"⏸ Пауза {pause_seconds} сек. перед следующей задачей (защита от блокировки YouTube)...")
                    for _ in range(pause_seconds):
                        if worker_obj.is_stop_requested():
                            break
                        time.sleep(1)

        return summary
    
    def save_result(self, result, config, file_path, worker_obj, fmt, suffix="", artifact_base_name=None):
        from src.utils.timestamps import format_timestamp_compact
        import os
        import json
        
        if artifact_base_name:
            base_name = artifact_base_name + suffix
        else:
            base_name = os.path.splitext(os.path.basename(file_path))[0] + suffix
        
        def get_unique_path(directory, filename):
            """
            Generates a unique path by appending _1, _2, etc. if file exists.
            """
            name, ext = os.path.splitext(filename)
            counter = 1
            unique_name = filename
            full_path = os.path.join(directory, unique_name)
            
            while os.path.exists(full_path):
                unique_name = f"{name}_{counter}{ext}"
                full_path = os.path.join(directory, unique_name)
                counter += 1
            
            return full_path

        # Write TXT
        if fmt == 'txt':
            out_path = get_unique_path(config['output_dir'], f"{base_name}.txt")
            with open(out_path, "w", encoding="utf-8") as f:
                for segment in result['segments']:
                    start = segment['start']
                    text = segment['text'].strip()
                    if config['timecodes']:
                        ts = format_timestamp_compact(start)
                        f.write(f"{ts} {text}\n")
                    else:
                        f.write(f"{text}\n\n")
            worker_obj.log.emit((f"📄 Сохранено: {os.path.basename(out_path)}", config['output_dir']))
            worker_obj.log.emit(("✅ Текст готов:", f"copy:{out_path}"))
            return out_path

        # Write SRT
        elif fmt == 'srt':
            out_path = get_unique_path(config['output_dir'], f"{base_name}.srt")
            def format_srt_time(seconds):
                hours = int(seconds // 3600)
                minutes = int((seconds % 3600) // 60)
                secs = int(seconds % 60)
                millis = int((seconds - int(seconds)) * 1000)
                return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"

            with open(out_path, "w", encoding="utf-8") as f:
                for i, segment in enumerate(result['segments']):
                    start = format_srt_time(segment['start'])
                    end = format_srt_time(segment['end'])
                    text = segment['text'].strip()
                    f.write(f"{i+1}\n{start} --> {end}\n{text}\n\n")
            worker_obj.log.emit((f"📄 Сохранено: {os.path.basename(out_path)}", config['output_dir']))
            worker_obj.log.emit(("✅ Текст готов:", f"copy:{out_path}"))
            return out_path
        
        # Write JSON
        elif fmt == 'json':
            out_path = get_unique_path(config['output_dir'], f"{base_name}.json")
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=4)
            worker_obj.log.emit((f"📄 Сохранено: {os.path.basename(out_path)}", config['output_dir']))
            worker_obj.log.emit(("✅ Текст готов:", f"copy:{out_path}"))
            return out_path

        # Write VTT
        elif fmt == 'vtt':
            out_path = get_unique_path(config['output_dir'], f"{base_name}.vtt")
            def format_vtt_time(seconds):
                hours = int(seconds // 3600)
                minutes = int((seconds % 3600) // 60)
                secs = int(seconds % 60)
                millis = int((seconds - int(seconds)) * 1000)
                return f"{hours:02}:{minutes:02}:{secs:02}.{millis:03}"

            with open(out_path, "w", encoding="utf-8") as f:
                f.write("WEBVTT\n\n")
                for segment in result['segments']:
                    start = format_vtt_time(segment['start'])
                    end = format_vtt_time(segment['end'])
                    text = segment['text'].strip()
                    f.write(f"{start} --> {end}\n{text}\n\n")
            worker_obj.log.emit((f"📄 Сохранено: {os.path.basename(out_path)}", config['output_dir']))
            worker_obj.log.emit(("✅ Текст готов:", f"copy:{out_path}"))
            return out_path
            
        # Write DOCX
        elif fmt == 'docx':
            try:
                from docx import Document
                doc = Document()
                doc.add_heading(base_name, 0)
                
                for segment in result['segments']:
                    start = segment['start']
                    text = segment['text'].strip()
                    if config['timecodes']:
                        ts = format_timestamp_compact(start)
                        p = doc.add_paragraph()
                        p.add_run(f"[{ts}] ").bold = True
                        p.add_run(text)
                    else:
                        doc.add_paragraph(text)
                        
                out_path = get_unique_path(config['output_dir'], f"{base_name}.docx")
                doc.save(out_path)
                worker_obj.log.emit((f"📄 Сохранено: {os.path.basename(out_path)}", config['output_dir']))
                worker_obj.log.emit(("✅ Текст готов:", f"copy:{out_path}"))
                return out_path
            except ImportError:
                worker_obj.log.emit("⚠️ Ошибка: python-docx не установлен.")
                return None
            except Exception as e:
                worker_obj.log.emit(f"⚠️ Ошибка сохранения DOCX: {e}")
                return None

        # Write Markdown
        elif fmt == 'md':
            out_path = get_unique_path(config['output_dir'], f"{base_name}.md")
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(f"# Транскрибация: {base_name}\n\n")
                for segment in result['segments']:
                    start = segment['start']
                    text = segment['text'].strip()
                    if config['timecodes']:
                        ts = format_timestamp_compact(start)
                        f.write(f"**[{ts}]** {text}  \n")
                    else:
                        f.write(f"{text}\n\n")
            worker_obj.log.emit((f"📝 Сохранено: {os.path.basename(out_path)}", config['output_dir']))
            worker_obj.log.emit(("✅ Текст готов:", f"copy:{out_path}"))
            return out_path

        return None

    def parse_subtitles(self, path):
        """
        Simple VTT/SRT parser.
        Returns list of segments: [{'start': float, 'end': float, 'text': str}]
        """
        def clean_subtitle_text(text: str) -> str:
            if not text:
                return ""
            text = text.replace("\r", "\n")
            text = re.sub(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", "", text)
            text = re.sub(r"</?c(?:\.[^>]*)?>", "", text)
            text = re.sub(r"</?v[^>]*>", "", text)
            text = re.sub(r"</?i>", "", text)
            text = re.sub(r"</?b>", "", text)
            text = re.sub(r"</?u>", "", text)
            text = re.sub(r"<[^>]+>", "", text)
            text = re.sub(r"\s+", " ", text)
            return text.strip()

        segments = []
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                
            # Simple approach: Split by double newline (blocks)
            content = content.replace('\r\n', '\n').replace('\r', '\n')
            blocks = re.split(r'\n\s*\n', content)
            seen_texts = set()
            
            for block in blocks:
                lines = block.strip().split('\n')
                if len(lines) < 2:
                    continue
                
                # Find timestamp line
                ts_line_idx = -1
                for k, line in enumerate(lines):
                    if '-->' in line:
                        ts_line_idx = k
                        break
                
                if ts_line_idx == -1:
                    continue
                
                ts_line = lines[ts_line_idx]
                text_lines = lines[ts_line_idx+1:]
                text = clean_subtitle_text(" ".join(text_lines).strip())
                if not text:
                    continue
                
                # Parse timestamps
                # Example: 00:00:01.500 --> 00:00:04.120
                times = ts_line.split('-->')
                if len(times) != 2:
                    continue
                    
                start_str = times[0].strip().split(" ")[0]
                end_str = times[1].strip().split(" ")[0]
                
                def parse_ts(s):
                    # Handle VTT/SRT formats
                    # 00:00:00.000 or 00:00.000
                    s = s.replace(',', '.') # SRT uses comma
                    parts = s.split(':')
                    seconds = 0.0
                    if len(parts) == 3:
                        seconds += float(parts[0]) * 3600
                        seconds += float(parts[1]) * 60
                        seconds += float(parts[2])
                    elif len(parts) == 2:
                        seconds += float(parts[0]) * 60
                        seconds += float(parts[1])
                    return seconds
                
                try:
                    start = parse_ts(start_str)
                    end = parse_ts(end_str)
                    dedupe_key = (round(start, 2), text)
                    if dedupe_key in seen_texts:
                        continue
                    seen_texts.add(dedupe_key)
                    segments.append({
                        'start': start,
                        'end': end,
                        'text': text
                    })
                except:
                    continue
                    
        except Exception as e:
            print(f"Error parsing subtitles: {e}")
            return []
            
        return segments
