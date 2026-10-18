import os
import traceback
from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, QComboBox, 
                             QPushButton, QProgressBar, QTextBrowser, QGroupBox,
                             QLineEdit, QFileDialog, QMessageBox)
from src.ui.widgets.file_list import FileListWidget
from src.core.worker import TaskWorker
from src.core.subtitles import parse_subtitles
from src.utils.config import load_config, save_config

class MediaTab(QWidget):
    def __init__(self):
        super().__init__()
        
        layout = QVBoxLayout(self)
        
        # --- Options ---
        options_group = QGroupBox("Медиа Операции")
        options_layout = QHBoxLayout(options_group)
        
        # Action Selection
        options_layout.addWidget(QLabel("Действие:"))
        self.combo_action = QComboBox()
        self._initializing = True
        self.combo_action.addItems([
            "Скачать ВИДЕО",
            "Скачать АУДИО",
            "🎧 Очистить аудио",
            "🎥 Вшить субтитры"
        ])
        options_layout.addWidget(self.combo_action)
        
        # Subtitle Language (only for hardsubbing)
        self.lbl_sub_lang = QLabel("Язык субтитров:")
        self.lbl_sub_lang.setVisible(False)
        options_layout.addWidget(self.lbl_sub_lang)
        
        self.combo_sub_lang = QComboBox()
        self.combo_sub_lang.addItems(["ru", "en", "es", "fr", "de", "it", "pt", "uk", "pl", "tr"])
        self.combo_sub_lang.setEditable(True)
        self.combo_sub_lang.setVisible(False)
        self.combo_sub_lang.setToolTip("Если указан, скачает субтитры с YouTube перед вшиванием.")
        options_layout.addWidget(self.combo_sub_lang)
        
        # --- AI Generation Options (Only for Hardsub) ---
        ai_layout = QHBoxLayout()
        
        self.lbl_model = QLabel("Модель ИИ:")
        self.lbl_model.setVisible(False)
        ai_layout.addWidget(self.lbl_model)
        
        self.combo_model = QComboBox()
        self.combo_model.addItems(["tiny", "base", "small", "medium", "large-v3"])
        self.combo_model.setCurrentText("base")
        self.combo_model.setVisible(False)
        self.combo_model.setToolTip("Модель для генерации субтитров, если готовые не найдены.")
        ai_layout.addWidget(self.combo_model)
        
        self.lbl_video_lang = QLabel("Язык видео:")
        self.lbl_video_lang.setVisible(False)
        ai_layout.addWidget(self.lbl_video_lang)
        
        self.combo_video_lang = QComboBox()
        self.combo_video_lang.addItems(["ru", "en", "es", "fr", "de", "it", "pt", "uk", "pl", "tr"])
        self.combo_video_lang.setCurrentText("ru")
        self.combo_video_lang.setEditable(True)
        self.combo_video_lang.setVisible(False)
        self.combo_video_lang.setToolTip("Язык для ИИ-распознавания.")
        ai_layout.addWidget(self.combo_video_lang)
        
        options_layout.addLayout(ai_layout)
        
        options_layout.addStretch()
        layout.addWidget(options_group)
        
        # --- Link Actions ---
        link_actions_layout = QHBoxLayout()
        self.btn_paste = QPushButton("📋 Вставить ссылку")
        self.btn_paste.setToolTip("Вставить ссылку на видео из буфера обмена (ссылки на каналы/плейлисты отклоняются с объяснением)")
        self.btn_paste.clicked.connect(lambda: self.file_list.paste_from_clipboard())
        link_actions_layout.addWidget(self.btn_paste)
        
        self.btn_clear_list = QPushButton("🗑 Очистить список")
        self.btn_clear_list.clicked.connect(lambda: self.file_list.clear())
        link_actions_layout.addWidget(self.btn_clear_list)
        
        link_actions_layout.addStretch()
        layout.addLayout(link_actions_layout)
        
        # --- File List ---
        self.file_list = FileListWidget()
        self.file_list.urls_rejected.connect(self.on_urls_rejected)
        layout.addWidget(self.file_list)
        
        # --- Output Directory ---
        dir_layout = QHBoxLayout()
        self.line_output_dir = QLineEdit()
        self.line_output_dir.setPlaceholderText("Папка по умолчанию: media_output")
        btn_browse = QPushButton("Обзор...")
        btn_browse.clicked.connect(self.browse_output_dir)
        dir_layout.addWidget(QLabel("Папка сохранения:"))
        dir_layout.addWidget(self.line_output_dir)
        dir_layout.addWidget(btn_browse)
        layout.addLayout(dir_layout)
        
        # --- Controls ---
        control_layout = QHBoxLayout()
        self.btn_start = QPushButton("▶ НАЧАТЬ")
        self.btn_start.clicked.connect(self.start_processing)
        self.btn_stop = QPushButton("🛑 СТОП")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self.stop_processing)
        
        self.progress_bar = QProgressBar()
        self.progress_bar.setValue(0)
        
        control_layout.addWidget(self.btn_start)
        control_layout.addWidget(self.btn_stop)
        
        self.btn_clear_logs = QPushButton("🗑️ Очистить логи")
        self.btn_clear_logs.setToolTip("Очистить окно логов ниже и сбросить очередь")
        self.btn_clear_logs.clicked.connect(self.clear_logs_and_list)
        control_layout.addWidget(self.btn_clear_logs)
        
        control_layout.addWidget(self.progress_bar)
        layout.addLayout(control_layout)

        self.queue_status_label = QLabel("Готов к работе")
        self.queue_status_label.setStyleSheet("color: #6B7280;")
        layout.addWidget(self.queue_status_label)
        
        # --- Log ---
        self.log_area = QTextBrowser()
        self.log_area.setOpenExternalLinks(False)
        self.log_area.anchorClicked.connect(self.handle_link_click)
        layout.addWidget(self.log_area)
        
        self.worker = None
        self._task_token = None
        self._task_queued = False
        from src.utils.processing_guard import processing_notifier
        processing_notifier().state_changed.connect(self._refresh_processing_status)
        
        # Connect signals
        self.combo_action.currentIndexChanged.connect(self.on_action_changed)
        self.line_output_dir.textChanged.connect(self.save_settings)
        self.combo_sub_lang.currentTextChanged.connect(self.save_settings)
        self.combo_model.currentTextChanged.connect(self.save_settings)
        self.combo_video_lang.currentTextChanged.connect(self.save_settings)
        
        self.load_settings()
        self._initializing = False
        self._apply_format_policy()
        self._refresh_processing_status()

    def update_ui_state(self):
        action = self.combo_action.currentText()
        is_hardsub = action == "🎥 Вшить субтитры"
        self.lbl_sub_lang.setVisible(is_hardsub)
        self.combo_sub_lang.setVisible(is_hardsub)
        self.lbl_model.setVisible(is_hardsub)
        self.combo_model.setVisible(is_hardsub)
        self.lbl_video_lang.setVisible(is_hardsub)
        self.combo_video_lang.setVisible(is_hardsub)
        
    def on_action_changed(self):
        if hasattr(self, '_initializing') and self._initializing:
            return
            
        self.update_ui_state()
        self._apply_format_policy()
        self.save_settings()
        
        action = self.combo_action.currentText()
        if action == "🎥 Вшить субтитры":
            # Show warning once
            if not getattr(self, '_hardsub_warned', False):
                QMessageBox.warning(
                    self,
                    "⚠️ Внимание: Вшивание субтитров",
                    "Вшивание субтитров требует полной покадровой перекодировки видео.\n\n"
                    "Этот процесс занимает ОЧЕНЬ долгое время (в 5-10 раз дольше обычной транскрибации).\n\n"
                    "1. Программа попытается найти готовые субтитры (в файле SRT или на YouTube).\n"
                    "2. Если их НЕТ — она автоматически включит ИИ-движок выбранной модели, "
                    "создаст субтитры и вошьет их в видео.\n",
                    QMessageBox.StandardButton.Ok
                )
                self._hardsub_warned = True

    def _apply_format_policy(self):
        action = self.combo_action.currentText()
        if action == "Скачать ВИДЕО":
            formats = ["mp4", "mkv", "webm", "mov", "avi"]
        elif action == "Скачать АУДИО":
            formats = ["mp3", "wav", "m4a", "flac", "aac", "ogg"]
        elif action == "🎧 Очистить аудио":
            formats = ["wav"]
        else:
            formats = ["mp4"]
        self.file_list.set_override_formats(formats)

    def load_settings(self):
        config = load_config()
        idx = self.combo_action.findText(config.get("media_action", "Скачать ВИДЕО"))
        if idx >= 0:
            self.combo_action.setCurrentIndex(idx)
        
        self.combo_sub_lang.setCurrentText(config.get("media_sub_lang", "ru"))
        self.combo_model.setCurrentText(config.get("media_model", "base"))
        self.combo_video_lang.setCurrentText(config.get("media_video_lang", "ru"))
        self.line_output_dir.setText(config.get("media_output_dir", os.path.join(os.getcwd(), "media_output")))
        self.update_ui_state()

    def save_settings(self):
        if hasattr(self, '_initializing') and self._initializing:
            return
            
        config = load_config()
        config["media_action"] = self.combo_action.currentText()
        config["media_sub_lang"] = self.combo_sub_lang.currentText()
        config["media_model"] = self.combo_model.currentText()
        config["media_video_lang"] = self.combo_video_lang.currentText()
        config["media_output_dir"] = self.line_output_dir.text()
        save_config(config)

    def clear_logs_and_list(self):
        """Clears the log area and the file list to prepare for the next batch."""
        self.log_area.clear()
        self.file_list.clear()
        self.progress_bar.setValue(0)
        self.log("✅ Логи и список файлов очищены. Можно добавлять новые задачи.")

    def on_urls_rejected(self, messages: list):
        """Ссылки «не на видео» отклонены классификатором при вставке."""
        for msg in messages:
            self.log(f"⚠️ {msg}")
        shown = list(messages)[:4]
        if len(messages) > len(shown):
            shown.append(f"… и ещё {len(messages) - len(shown)}")
        self._notify("\n".join(shown), "warning")

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
            self.queue_status_label.setText("Выполняется: Медиа")
        elif self._task_queued and queue_pos is not None:
            lead = active_label or "предыдущая задача"
            self.queue_status_label.setText(f"В очереди #{queue_pos}: ждёт после «{lead}»")
        elif active_label:
            self.queue_status_label.setText(f"Сейчас выполняется: {active_label}")
        else:
            self.queue_status_label.setText("Готов к работе")

    def browse_output_dir(self):
        dir_path = QFileDialog.getExistingDirectory(self, "Выберите папку для сохранения")
        if dir_path:
            self.line_output_dir.setText(dir_path)

    def log(self, data):
        link = None
        if isinstance(data, tuple):
            text, link = data
        else:
            text = data
            
        if link:
            self.log_area.append(f"<a href='{link}' style='color:#4DA6FF; text-decoration:none;'>{text}</a>")
        else:
            self.log_area.append(text)

    def handle_link_click(self, url):
        link_text = url.toString()
        if link_text.startswith("copy:"):
            import PyQt6.QtGui as QtGui
            from PyQt6.QtWidgets import QApplication
            clipboard = QApplication.instance().clipboard()
            clipboard.setText(link_text[5:])
            # Optional: temporary log message that copy was successful
            self.log("<i>Текст скопирован в буфер обмена.</i>")
        elif link_text.startswith("folder:"):
             import platform, subprocess
             path = link_text[7:]
             if platform.system() == "Darwin":
                 subprocess.run(["open", path])
             elif platform.system() == "Windows":
                 subprocess.run(["explorer", path.replace('/', '\\')])
        else:
            import webbrowser
            webbrowser.open(link_text)

    def start_processing(self):
        from src.utils.processing_guard import active_processing_label, schedule_processing
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("media_start_clicked", action=self.combo_action.currentText(), queue_len=len(self.file_list.files))
        except Exception:
            pass
        file_paths = self.file_list.get_files()
        if not file_paths:
            self.log("⚠️ Нет файлов для обработки.")
            return

        if self._task_queued:
            self._notify("Эта задача уже стоит в очереди.", "warning")
            return
        if self.worker and self.worker.isRunning():
            self._notify("Медиа-задача уже выполняется.", "warning")
            return
        files = []
        for i, path in enumerate(file_paths):
            files.append({
                'path': path,
                'format': (self.file_list.get_file_format(i) or "").lower().strip(),
            })
            
        config = {
            'action': self.combo_action.currentText(),
            'sub_lang': self.combo_sub_lang.currentText(),
            'model': self.combo_model.currentText(),
            'video_lang': self.combo_video_lang.currentText(),
            'output_dir': self.line_output_dir.text().strip(),
            'device': load_config().get('device', 'Auto'),
            'cpu_threads': load_config().get('cpu_threads', 'Auto'),
        }
        from src.utils.runtime import resolve_whisper_device
        config['device'] = resolve_whisper_device(config['device'])
        
        if not config['output_dir']:
            reply = QMessageBox.question(self, "Папка сохранения",
                                         "Папка сохранения не выбрана. Файлы будут сохранены в папке 'media_output'. Продолжить?",
                                         QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if reply == QMessageBox.StandardButton.No:
                self.btn_start.setEnabled(True)
                return
            config['output_dir'] = os.path.join(os.getcwd(), "media_output")
            self.line_output_dir.setText(config['output_dir'])
            
        if not os.path.exists(config['output_dir']):
            try:
                os.makedirs(config['output_dir'], exist_ok=True)
            except Exception as e:
                self.log(f"❌ Ошибка создания папки: {e}")
                self.btn_start.setEnabled(True)
                return

        def _start_from_queue():
            self._task_queued = False
            self.log_area.clear()
            self.progress_bar.setValue(0)
            self.btn_start.setEnabled(False)
            self.btn_stop.setEnabled(True)
            self.log(f"Начинаем обработку {len(files)} файлов...")
            self.worker = TaskWorker(self.process_task, files, config)
            self.worker.log.connect(self.log)
            self.worker.progress.connect(self.progress_bar.setValue)
            self.worker.status_update.connect(self.file_list.update_status)
            self.worker.file_result.connect(self.file_list.set_file_result)
            self.worker.finished.connect(self.on_finished)
            self.worker.error.connect(self.on_error)
            self.worker.start()

        scheduled = schedule_processing("Медиа", _start_from_queue)
        self._task_token = scheduled["token"]
        if not scheduled["started"]:
            self._task_queued = True
            self.btn_start.setEnabled(False)
            self.btn_stop.setEnabled(True)
            busy = scheduled["active_label"] or active_processing_label() or "другая задача"
            self.log(f"⏳ Задача поставлена в очередь ({scheduled['position']}). Сначала завершится: {busy}.")
            self._notify(f"Сейчас выполняется: {busy}. Медиа-задача поставлена в очередь и запустится автоматически следующей.", "info")

    def stop_processing(self):
        from src.utils.processing_guard import cancel_processing
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("media_stop_clicked")
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
            self.log("Остановка (может занять несколько секунд)...")
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
             self.log(f"⚠️ Медиа-обработка завершена с ошибками: успешно {success}/{total}, ошибок: {errors}.")
             self._notify(f"Медиа-обработка завершена с ошибками: {success}/{total} успешно.", "warning")
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
        from src.core.converter import Converter
        from src.core.engine import WhisperEngine
        from src.core.translator import Translator
        from src.utils.timestamps import format_timestamp_compact
        from src.utils.fs import safe_artifact_part
        import shutil
        import tempfile
        import copy
        
        total = len(files)
        summary = {"total": total, "success": 0, "errors": 0}
        downloader = Downloader(config['output_dir'])
        converter = Converter()
        translator = Translator()
        action = config['action']

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

        def copy_result_to_output(temp_path: str) -> str:
            dst = os.path.join(config['output_dir'], os.path.basename(temp_path))
            if os.path.abspath(temp_path) == os.path.abspath(dst):
                return temp_path
            if os.path.exists(dst):
                base, ext = os.path.splitext(dst)
                counter = 1
                while os.path.exists(dst):
                    dst = f"{base}_{counter}{ext}"
                    counter += 1
            shutil.copy2(temp_path, dst)
            return dst

        def format_srt_time(seconds):
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            millis = int((seconds - int(seconds)) * 1000)
            return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"

        def parse_subtitle_segments(path: str):
            try:
                return parse_subtitles(path)
            except OSError:
                return []

        def write_segments_to_srt(segments, srt_path: str):
            with open(srt_path, "w", encoding="utf-8") as f:
                for si, segment in enumerate(segments):
                    start = format_srt_time(segment['start'])
                    end = format_srt_time(segment['end'])
                    text = (segment.get('text') or "").strip()
                    if not text:
                        continue
                    f.write(f"{si+1}\n{start} --> {end}\n{text}\n\n")

        def maybe_translate_segments(segments, source_lang: str | None, target_lang: str | None):
            if not segments:
                return segments
            target_lang = (target_lang or "").strip().lower()
            source_lang = (source_lang or "").strip().lower()
            if not target_lang or target_lang == source_lang:
                return segments

            texts = [(seg.get("text") or "").strip() for seg in segments]
            translated_texts = translator.translate_batch(texts, target_lang=target_lang)
            translated_segments = copy.deepcopy(segments)
            for idx, seg in enumerate(translated_segments):
                if idx < len(translated_texts):
                    seg["text"] = translated_texts[idx]
            return translated_segments
        
        for i, file_data in enumerate(files):
            if worker_obj.is_stop_requested():
                return False
            file_path = file_data['path']
            target_format = (file_data.get('format') or "").lower()
                
            c_hex = ["#4DA6FF", "#FFB74D", "#9CCC65", "#BA68C8", "#FF8A65"][i % 5]
            worker_obj.log.emit(
                f"<br><span style='color:{c_hex}; font-size:14px; font-weight:bold;'>"
                f"🚀 Задача {i+1}/{total}: {display_name_for_input(file_path)}"
                f"{f' ({target_format})' if target_format else ''}</span>"
            )
            worker_obj.status_update.emit(i, "Обработка...")
            
            temp_dir_ctx = None
            try:
                task_downloader = downloader
                if file_path.startswith("http"):
                    temp_dir_ctx = tempfile.TemporaryDirectory(prefix="voxpaperai-media-")
                    task_downloader = Downloader(temp_dir_ctx.name)

                download_progress_state = {"bucket": -1}

                def download_progress_callback(percent, eta_str=""):
                    global_p = int((i / total * 100) + (percent / total))
                    worker_obj.progress.emit(global_p)
                    bucket = int(percent // 10)
                    if bucket > download_progress_state["bucket"]:
                        download_progress_state["bucket"] = bucket
                        worker_obj.log.emit(f"⬇️ Скачивание: {percent}%")
                    if eta_str:
                        worker_obj.status_update.emit(i, f"Скачивание... ({eta_str})")

                # 1. СКАЧИВАНИЕ ВИДЕО
                if action == "Скачать ВИДЕО":
                    worker_obj.status_update.emit(i, "Этап 1/2: скачивание")
                    if file_path.startswith("http"):
                         worker_obj.log.emit(f"🌐 Скачивание видео: {file_path}")
                         out_file, _ = task_downloader.download(file_path, video_only=True, worker_obj=worker_obj, progress_callback=download_progress_callback)
                         out_file = copy_result_to_output(out_file)
                         worker_obj.log.emit(f"✅ Видео скачано: {os.path.basename(out_file)}")
                         worker_obj.status_update.emit(i, "Этап 2/2: сохранение")
                         worker_obj.file_result.emit(i, out_file)
                         worker_obj.status_update.emit(i, "Готово")
                    else:
                         worker_obj.log.emit("⚠️ Это локальный файл, скачивание не требуется.")
                         worker_obj.status_update.emit(i, "Пропущено")

                # 2. СКАЧИВАНИЕ АУДИО
                elif action == "Скачать АУДИО":
                    worker_obj.status_update.emit(i, "Этап 1/2: скачивание")
                    if file_path.startswith("http"):
                         worker_obj.log.emit(f"🌐 Скачивание аудио: {file_path}")
                         out_file, _ = task_downloader.download(file_path, audio_only=True, worker_obj=worker_obj, progress_callback=download_progress_callback)
                         actual_ext = os.path.splitext(out_file)[1].lower().lstrip(".")

                         if target_format and target_format not in {"-", actual_ext}:
                             from src.utils.fs import find_ffmpeg_executable

                             ffmpeg_path = find_ffmpeg_executable()
                             if not ffmpeg_path:
                                 raise RuntimeError(
                                     f"Выбран формат '{target_format}', но ffmpeg не найден. "
                                     f"Сейчас можно сохранить только исходный аудиопоток '{actual_ext}'."
                                 )

                             worker_obj.log.emit(f"🔄 Конвертация аудио: {actual_ext} -> {target_format}")
                             out_file = converter.convert_media(
                                 out_file,
                                 target_format,
                                 temp_dir_ctx.name if temp_dir_ctx is not None else config['output_dir'],
                                 worker_obj=worker_obj,
                             )
                             out_file = copy_result_to_output(out_file)
                         elif temp_dir_ctx is not None:
                             out_file = copy_result_to_output(out_file)

                         worker_obj.log.emit(f"✅ Аудио скачано: {os.path.basename(out_file)}")
                         worker_obj.status_update.emit(i, "Этап 2/2: сохранение")
                         worker_obj.file_result.emit(i, out_file)
                         worker_obj.status_update.emit(i, "Готово")
                    else:
                         worker_obj.log.emit("⚠️ Это локальный файл. Если нужно извлечь аудио, используйте Конвертер.")
                         worker_obj.status_update.emit(i, "Пропущено")

                # 3. ОЧИСТКА АУДИО
                elif action == "🎧 Очистить аудио":
                    worker_obj.status_update.emit(i, "Этап 1/2: подготовка")
                    worker_obj.log.emit("🎧 Очистка аудио от шумов...")
                    
                    target_path = file_path
                    if file_path.startswith("http"):
                        worker_obj.log.emit("📥 Сначала скачиваем аудио...")
                        target_path, _ = task_downloader.download(file_path, audio_only=True, worker_obj=worker_obj, progress_callback=download_progress_callback)
                        
                    if worker_obj.is_stop_requested(): return False
                    
                    out_name = os.path.splitext(os.path.basename(target_path))[0] + "_enhanced.wav"
                    out_file = os.path.join(config['output_dir'], out_name)
                    
                    def prog_cb(percent, eta_str=""):
                        global_p = int((i / total * 100) + (percent / total))
                        worker_obj.progress.emit(global_p)
                        if eta_str:
                            worker_obj.status_update.emit(i, f"Очистка... ({eta_str})")
                            
                    res_path = converter.enhance_audio(target_path, out_file, progress_callback=prog_cb, worker_obj=worker_obj)
                    worker_obj.log.emit(f"✅ Аудио очищено: {os.path.basename(res_path)}")
                    worker_obj.status_update.emit(i, "Этап 2/2: сохранение")
                    worker_obj.file_result.emit(i, res_path)
                    worker_obj.status_update.emit(i, "Готово")

                # 4. ВШИВАНИЕ СУБТИТРОВ
                elif action == "🎥 Вшить субтитры":
                    worker_obj.status_update.emit(i, "Этап 1/4: подготовка")
                    target_video = file_path
                    target_srt = None
                    subtitle_segments = None
                    subtitle_source_lang = None
                    
                    if file_path.startswith("http"):
                        worker_obj.log.emit("📥 Скачиваем видео и субтитры...")
                        worker_obj.status_update.emit(i, "Этап 2/4: субтитры")
                        # Download video first
                        target_video, _ = task_downloader.download(file_path, video_only=True, worker_obj=worker_obj, progress_callback=download_progress_callback)
                        if worker_obj.is_stop_requested(): return False
                        
                        # Try to download subtitles
                        try:
                            sub_lang = config['sub_lang']
                            subs_info = task_downloader.list_subtitles(file_path)
                            subtitle_choice = task_downloader.choose_subtitle_track(
                                subs_info,
                                sub_lang,
                                fallback_langs=[lang for lang in ["en", "ru", "uk"] if lang != sub_lang],
                            )
                            is_auto = False
                            actual_lang = None
                            if subtitle_choice:
                                actual_lang = subtitle_choice["lang"]
                                is_auto = subtitle_choice["auto"]

                            if actual_lang:
                                worker_obj.log.emit(
                                    f"📜 Найдены субтитры ({actual_lang}). "
                                    f"Причина выбора: {subtitle_choice['reason']}. Скачиваем..."
                                )
                                try:
                                    target_srt = task_downloader.download_subtitles(
                                        file_path,
                                        actual_lang,
                                        auto=is_auto,
                                        is_vtt=False,
                                        worker_obj=worker_obj,
                                        allow_auto_fallback=True,
                                    )
                                    if target_srt and os.path.exists(target_srt):
                                        worker_obj.log.emit(f"✅ Субтитры скачаны: {os.path.basename(target_srt)}")
                                        subtitle_segments = parse_subtitle_segments(target_srt)
                                        subtitle_source_lang = actual_lang
                                    else:
                                        actual_lang = None
                                except Exception as sub_error:
                                    worker_obj.log.emit(f"⚠️ Не удалось скачать готовые субтитры: {sub_error}")
                                    actual_lang = None

                            if not actual_lang:
                                worker_obj.log.emit("⚠️ Готовые субтитры не найдены. Запускаем ИИ-генерацию (Whisper)...")
                                worker_obj.status_update.emit(i, "Этап 2/4: распознавание")
                                
                                engine = WhisperEngine(
                                    model_name=config['model'],
                                    device=config['device'],
                                    num_threads=config.get('cpu_threads', 'Auto'),
                                )
                                
                                def progress_callback(percent, eta_str=""):
                                    global_p = int((i / total * 100) + (percent / total * 0.5))
                                    worker_obj.progress.emit(global_p)
                                    if eta_str:
                                        worker_obj.status_update.emit(i, f"Распознавание... ({eta_str})")
                                        
                                result = engine.transcribe(
                                    target_video,
                                    language=config['video_lang'],
                                    progress_callback=progress_callback,
                                    log_callback=worker_obj.log.emit,
                                    worker_obj=worker_obj,
                                )
                                
                                temp_root = temp_dir_ctx.name if temp_dir_ctx is not None else tempfile.gettempdir()
                                target_srt = os.path.join(temp_root, f"{os.path.splitext(os.path.basename(target_video))[0]}_ai_temp.srt")
                                subtitle_segments = result['segments']
                                subtitle_source_lang = config['video_lang']
                                worker_obj.log.emit(f"✅ ИИ-субтитры сгенерированы!")

                        except Exception as e:
                            worker_obj.log.emit(f"⚠️ Ошибка поиска субтитров: {e}")
                            worker_obj.log.emit("⚠️ Переключаюсь на ИИ-генерацию субтитров...")
                            worker_obj.status_update.emit(i, "Этап 2/4: распознавание")
                            engine = WhisperEngine(
                                model_name=config['model'],
                                device=config['device'],
                                num_threads=config.get('cpu_threads', 'Auto'),
                            )

                            def progress_callback(percent, eta_str=""):
                                global_p = int((i / total * 100) + (percent / total * 0.5))
                                worker_obj.progress.emit(global_p)
                                if eta_str:
                                    worker_obj.status_update.emit(i, f"Распознавание... ({eta_str})")

                            result = engine.transcribe(
                                target_video,
                                language=config['video_lang'],
                                progress_callback=progress_callback,
                                log_callback=worker_obj.log.emit,
                                worker_obj=worker_obj,
                            )

                            temp_root = temp_dir_ctx.name if temp_dir_ctx is not None else tempfile.gettempdir()
                            target_srt = os.path.join(temp_root, f"{os.path.splitext(os.path.basename(target_video))[0]}_ai_temp.srt")
                            subtitle_segments = result['segments']
                            subtitle_source_lang = config['video_lang']
                            worker_obj.log.emit(f"✅ ИИ-субтитры сгенерированы!")
                            
                    else:
                        # Local file
                        video_exts = {'.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv'}
                        if os.path.splitext(file_path)[1].lower() not in video_exts:
                            worker_obj.log.emit(f"⚠️ Это не видеофайл: {os.path.basename(file_path)}")
                            worker_obj.status_update.emit(i, "Пропущено")
                            continue
                            
                        # Look for SRT file with same name
                        base_name = os.path.splitext(file_path)[0]
                        candidate_srt = base_name + ".srt"
                        if os.path.exists(candidate_srt):
                            target_srt = candidate_srt
                            worker_obj.log.emit(f"📜 Найден локальный SRT: {os.path.basename(target_srt)}")
                        else:
                            worker_obj.log.emit("⚠️ Локальный SRT не найден. Запускаем ИИ-генерацию (Whisper)...")
                            worker_obj.status_update.emit(i, "Этап 2/4: распознавание")
                            
                            engine = WhisperEngine(
                                model_name=config['model'],
                                device=config['device'],
                                num_threads=config.get('cpu_threads', 'Auto'),
                            )
                            
                            def progress_callback(percent, eta_str=""):
                                global_p = int((i / total * 100) + (percent / total * 0.5))
                                worker_obj.progress.emit(global_p)
                                if eta_str:
                                    worker_obj.status_update.emit(i, f"Распознавание... ({eta_str})")
                                    
                            result = engine.transcribe(
                                target_video,
                                language=config['video_lang'],
                                progress_callback=progress_callback,
                                log_callback=worker_obj.log.emit,
                                worker_obj=worker_obj,
                            )
                            
                            temp_root = temp_dir_ctx.name if temp_dir_ctx is not None else tempfile.gettempdir()
                            target_srt = os.path.join(temp_root, f"{os.path.splitext(os.path.basename(target_video))[0]}_ai_temp.srt")
                            subtitle_segments = result['segments']
                            subtitle_source_lang = config['video_lang']
                            worker_obj.log.emit(f"✅ ИИ-субтитры сгенерированы!")
                            
                    if worker_obj.is_stop_requested(): return False
                            
                    if target_video and target_srt:
                        if subtitle_segments is None and target_srt and os.path.exists(target_srt):
                            subtitle_segments = parse_subtitle_segments(target_srt)
                        if subtitle_segments is not None and not subtitle_segments:
                            raise RuntimeError("Не удалось прочитать ни одной реплики из файла субтитров")
                        if subtitle_segments:
                            desired_sub_lang = (config.get('sub_lang') or "").strip().lower()
                            subtitle_segments = maybe_translate_segments(
                                subtitle_segments,
                                subtitle_source_lang or config.get('video_lang'),
                                desired_sub_lang,
                            )
                            write_segments_to_srt(subtitle_segments, target_srt)
                            if desired_sub_lang and desired_sub_lang != (subtitle_source_lang or "").strip().lower():
                                worker_obj.status_update.emit(i, "Этап 3/4: перевод субтитров")
                                worker_obj.log.emit(f"🌍 Субтитры переведены на '{desired_sub_lang}'.")
                        worker_obj.log.emit("🎥 Начинаем вшивание (это займет время!)...")
                        worker_obj.status_update.emit(i, "Этап 4/4: вшивание")
                        out_name = os.path.splitext(os.path.basename(target_video))[0] + "_hardsub.mp4"
                        out_file = os.path.join(config['output_dir'], out_name)
                        
                        def prog_cb(percent, eta_str=""):
                            global_p = int((i / total * 100) + (percent / total))
                            worker_obj.progress.emit(global_p)
                            if eta_str:
                                worker_obj.status_update.emit(i, f"Вшивание... ({eta_str})")
                                
                        res_path = converter.hardsub_video(target_video, target_srt, out_file, progress_callback=prog_cb, worker_obj=worker_obj)
                        worker_obj.log.emit(f"✅ Готово: {os.path.basename(res_path)}")
                        worker_obj.file_result.emit(i, res_path)
                        worker_obj.status_update.emit(i, "Готово")
                        
                        # Cleanup downloaded youtube subtitles or temporary AI subtitles
                        if file_path.startswith("http") and target_srt != file_path:
                            try: os.remove(target_srt)
                            except: pass
                        elif target_srt and target_srt.endswith("_ai_temp.srt"):
                            try: os.remove(target_srt)
                            except: pass
                    else:
                        raise RuntimeError("Не удалось подготовить видео или субтитры для вшивания")

                summary["success"] += 1
                worker_obj.progress.emit(int((i + 1) / total * 100))
                
            except Exception as e:
                summary["errors"] += 1
                worker_obj.log.emit(f"⚠️ Ошибка: {e}")
                worker_obj.log.emit(traceback.format_exc())
                worker_obj.status_update.emit(i, "Ошибка")
            finally:
                if temp_dir_ctx is not None:
                    try:
                        temp_dir_ctx.cleanup()
                    except Exception:
                        pass
            
        return summary
