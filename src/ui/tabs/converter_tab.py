from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, QComboBox, 
                             QPushButton, QProgressBar, QTextBrowser, QGroupBox, QLineEdit, QFileDialog, QMessageBox)
from PyQt6.QtCore import QThread
from src.ui.widgets.file_list import FileListWidget
from src.core.worker import TaskWorker
import logging
import os

class ConverterTab(QWidget):
    def __init__(self):
        super().__init__()
        self.logger = logging.getLogger(__name__)
        self._task_token = None
        self._task_queued = False
        self.init_ui()
        
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        # File List
        self.file_list = FileListWidget()
        layout.addWidget(self.file_list)
        
        # Buttons
        btn_layout = QHBoxLayout()
        self.btn_start = QPushButton("НАЧАТЬ КОНВЕРТАЦИЮ")
        self.btn_start.setObjectName("successButton")
        self.btn_start.clicked.connect(self.start_processing)
        btn_layout.addWidget(self.btn_start)
        
        layout.addLayout(btn_layout)
        
        # Progress
        self.progress_bar = QProgressBar()
        layout.addWidget(self.progress_bar)

        self.queue_status_label = QLabel("Готов к работе")
        self.queue_status_label.setStyleSheet("color: #6B7280;")
        layout.addWidget(self.queue_status_label)
        
        # Output Folder
        folder_group = QGroupBox("Папка сохранения")
        folder_layout = QHBoxLayout(folder_group)
        
        self.line_output_dir = QLineEdit()
        folder_layout.addWidget(self.line_output_dir)
        
        self.btn_browse = QPushButton("Обзор...")
        self.btn_browse.clicked.connect(self.browse_output_dir)
        folder_layout.addWidget(self.btn_browse)
        
        layout.addWidget(folder_group)

        # Log
        self.log_text = QTextBrowser()
        self.log_text.setOpenExternalLinks(False)
        self.log_text.anchorClicked.connect(self.on_link_clicked)
        self.log_text.setMaximumHeight(100)
        layout.addWidget(self.log_text)
        
        from src.utils.processing_guard import processing_notifier
        processing_notifier().state_changed.connect(self._refresh_processing_status)
        self.load_settings()
        self._refresh_processing_status()

    def browse_output_dir(self):
        dir_path = QFileDialog.getExistingDirectory(self, "Выберите папку для сохранения", self.line_output_dir.text())
        if dir_path:
            self.line_output_dir.setText(dir_path)

    def load_settings(self):
        from src.utils.config import load_config
        config = load_config()
        self.line_output_dir.setText(config.get("converter_output_dir", os.path.join(os.getcwd(), "converted_output")))

    def save_settings(self):
        from src.utils.config import load_config, save_config
        config = load_config()
        config["converter_output_dir"] = self.line_output_dir.text()
        save_config(config)

    def on_link_clicked(self, url):
        from PyQt6.QtGui import QDesktopServices
        from PyQt6.QtCore import QUrl
        
        scheme = url.scheme()
        if scheme == 'file':
            QDesktopServices.openUrl(url)
        elif scheme == 'folder':
            folder_path = url.path()
            QDesktopServices.openUrl(QUrl.fromLocalFile(folder_path))

    def log(self, message):
        if isinstance(message, tuple):
            text, link = message
            if link.startswith("folder:"):
                path = link.replace("folder:", "")
                html = f'{text} <a href="folder:{path}" style="color: #2196F3; text-decoration: none;">[📂 Открыть папку]</a>'
                self.log_text.append(html)
            else:
                self.log_text.append(str(text))
        else:
            self.log_text.append(str(message))
        
        sb = self.log_text.verticalScrollBar()
        sb.setValue(sb.maximum())

    def _refresh_processing_status(self, snapshot=None):
        from src.utils.processing_guard import processing_snapshot
        snapshot = snapshot or processing_snapshot()
        active_label = snapshot.get("active_label")
        queue = snapshot.get("queue") or []
        queue_pos = next((idx + 1 for idx, item in enumerate(queue) if item.get("token") == self._task_token), None)

        if hasattr(self, "worker") and self.worker and self.worker.isRunning():
            self.queue_status_label.setText("Выполняется: Конвертация")
        elif self._task_queued and queue_pos is not None:
            lead = active_label or "предыдущая задача"
            self.queue_status_label.setText(f"В очереди #{queue_pos}: ждёт после «{lead}»")
        elif active_label:
            self.queue_status_label.setText(f"Сейчас выполняется: {active_label}")
        else:
            self.queue_status_label.setText("Готов к работе")

    def _notify(self, message: str, level: str = "info"):
        main_window = self.window()
        if hasattr(main_window, "show_notification"):
            main_window.show_notification(message, level=level)
        else:
            QMessageBox.information(self, "VoxPaperAi", message)

    def start_processing(self):
        from src.utils.processing_guard import active_processing_label, schedule_processing
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("converter_start_clicked", queue_len=len(self.file_list.files))
        except Exception:
            pass
        files_data = []
        # Gather files and their formats
        for i, f in enumerate(self.file_list.files):
            if f['status'] == 'Готово':
                continue
                
            path = f['path']
            # Get format from row widget
            fmt = self.file_list.get_file_format(i)
            if not fmt or fmt == "-":
                fmt = "mp3" # Default fallback
            
            files_data.append({'path': path, 'format': fmt, 'row_index': i})
            
        if not files_data:
            self.log("Нет файлов для обработки.")
            return

        if self._task_queued:
            self._notify("Эта задача уже стоит в очереди.", "warning")
            return
        if hasattr(self, 'worker') and self.worker and self.worker.isRunning():
            self._notify("Конвертация уже выполняется.", "warning")
            return
            
        # Save current output dir
        self.save_settings()
        
        # Config
        config = {
            'output_dir': self.line_output_dir.text().strip()
        }
        
        if not config['output_dir']:
            reply = QMessageBox.question(self, "Папка сохранения",
                                         "Папка сохранения не выбрана. Артефакты будут сохранены рядом с исходными файлами. Продолжить?",
                                         QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
            if reply == QMessageBox.StandardButton.No:
                return
            config['output_dir'] = None
            self.line_output_dir.setPlaceholderText("По умолчанию: рядом с исходным файлом")
        
        def _start_from_queue():
            self._task_queued = False
            self.log(f"Начинаем конвертацию {len(files_data)} файлов...")
            self.btn_start.setEnabled(False)
            self.progress_bar.setValue(0)
            self.worker = TaskWorker(self.process_task, files_data, config)
            self.worker.log.connect(self.log)
            self.worker.progress.connect(self.progress_bar.setValue)
            self.worker.status_update.connect(self.file_list.update_status)
            self.worker.file_result.connect(self.file_list.set_file_result)
            self.worker.finished.connect(self.on_finished)
            self.worker.error.connect(self.on_error)
            self.worker.start()

        scheduled = schedule_processing("Конвертация", _start_from_queue)
        self._task_token = scheduled["token"]
        if not scheduled["started"]:
            self._task_queued = True
            self.btn_start.setEnabled(False)
            busy = scheduled["active_label"] or active_processing_label() or "другая задача"
            self.log(f"⏳ Конвертация поставлена в очередь ({scheduled['position']}). Сначала завершится: {busy}.")
            self._notify(f"Сейчас выполняется: {busy}. Конвертация поставлена в очередь и стартует автоматически.", "info")
        self._refresh_processing_status()

    def stop_processing(self):
        if hasattr(self, 'worker') and self.worker.isRunning():
            self.worker.request_stop()
            self.log("🛑 Остановка (может занять несколько секунд)...")
            self.btn_start.setEnabled(True)
            self.progress_bar.setValue(0)

    def on_finished(self, result):
        from src.utils.processing_guard import release_processing
        release_processing(self._task_token)
        self._task_token = None
        errors = int(result.get("errors", 0)) if isinstance(result, dict) else 0
        success = int(result.get("success", 0)) if isinstance(result, dict) else 0
        total = int(result.get("total", 0)) if isinstance(result, dict) else 0
        if errors:
            self.log(f"⚠️ Конвертация завершена с ошибками: успешно {success}/{total}, ошибок: {errors}.")
            self._notify(f"Конвертация завершена с ошибками: {success}/{total} успешно.", "warning")
        else:
            self.log("🏁 Конвертация завершена.")
        self.btn_start.setEnabled(True)
        self.progress_bar.setValue(100)
        self._refresh_processing_status()
        
    def on_error(self, error_msg):
        from src.utils.processing_guard import release_processing
        release_processing(self._task_token)
        self._task_token = None
        self.log(f"❌ Системная ошибка: {error_msg}")
        self.btn_start.setEnabled(True)
        self._refresh_processing_status()

    def process_task(self, worker_obj, files_data, config):
        from src.core.converter import Converter
        import os
        
        converter = Converter()
        total = len(files_data)
        summary = {"total": total, "success": 0, "errors": 0}
        
        for i, item in enumerate(files_data):
            path = item['path']
            target_fmt = item['format']
            row_index = item.get('row_index', i)
            c_hex = ["#4DA6FF", "#FFB74D", "#9CCC65", "#BA68C8", "#FF8A65"][i % 5]
            worker_obj.log.emit(
                f"<br><span style='color:{c_hex}; font-size:14px; font-weight:bold;'>"
                f"🚀 Задача {i+1}/{total}: {os.path.basename(path)} → {target_fmt}</span>"
            )
            
            worker_obj.log.emit(f"🔄 Конвертация {os.path.basename(path)} -> {target_fmt}")
            worker_obj.status_update.emit(row_index, "Конвертация...")
            
            try:
                def conv_progress(percent, eta_str=""):
                    overall_p = int((i / total * 100) + (percent / total))
                    worker_obj.progress.emit(overall_p)
                    if eta_str:
                        worker_obj.status_update.emit(row_index, f"Конвертация... ({eta_str})")

                # Use unified convert method (handles both media and docs)
                output_path = converter.convert(path, target_fmt, config['output_dir'], progress_callback=conv_progress, worker_obj=worker_obj)
                output_file = output_path 
                
                worker_obj.log.emit(f"✅ Готово: {os.path.basename(output_file)}")
                worker_obj.file_result.emit(row_index, output_file)
                worker_obj.status_update.emit(row_index, "Готово")
                
                # Emit Open Folder button (keep log for overall status)
                worker_obj.log.emit(("📂 Файл готов:", f"folder:{os.path.dirname(output_file)}"))
                
                progress = int((i + 1) / total * 100)
                summary["success"] += 1
                worker_obj.progress.emit(progress)
                
            except Exception as e:
                summary["errors"] += 1
                worker_obj.log.emit(f"⚠️ Ошибка: {e}")
                worker_obj.status_update.emit(row_index, "Ошибка")
                
        return summary
