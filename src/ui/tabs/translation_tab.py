from PyQt6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, QComboBox, 
                             QPushButton, QTextEdit, QTextBrowser, QSplitter, QGroupBox, QFileDialog, 
                             QProgressBar, QMessageBox, QApplication)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from src.ui.widgets.file_list import FileListWidget
from src.core.translator import Translator
from src.utils.config import load_config, save_config
from src.utils.fs import find_soffice_executable
import os
import shutil
import traceback

class TranslationWorker(QThread):
    progress = pyqtSignal(int)
    log = pyqtSignal(str)
    status_update = pyqtSignal(int, str) # Index, Status Text
    file_result = pyqtSignal(int, str)   # index, result_path
    finished = pyqtSignal(dict)
    
    def __init__(self, items, output_dir, provider, api_key, pdf_mode):
        super().__init__()
        self.items = items
        self.output_dir = output_dir
        self.translator = Translator()
        self.provider = provider
        self.api_key = api_key
        self.pdf_mode = pdf_mode
        self._is_running = True
        self._summary = {"total": len(items), "success": 0, "errors": 0, "messages": []}
        
    def run(self):
        total = len(self.items)
        for i, item in enumerate(self.items):
            if not self._is_running: break
            
            path = item['path']
            target_lang = item['lang']
            out_fmt = item['format']
            out_dir = self.output_dir or os.path.dirname(path)
            
            self.log.emit(f"🔄 Перевод {os.path.basename(path)} на {target_lang}...")
            self.status_update.emit(i, "Перевод...")
            
            try:
                ext = os.path.splitext(path)[1].lower()
                
                # PDF/DOCX: LAYOUT vs FAST
                if ext in ['.pdf', '.docx', '.doc'] and out_fmt in ["pdf", "docx"]:
                    out_name = f"TRANS_{target_lang.upper()}_{os.path.basename(path)}"
                    out_name = os.path.splitext(out_name)[0] + f".{out_fmt}"
                    out_path = os.path.join(out_dir, out_name)

                    def prog_callback(percent, eta_str=""):
                        overall_p = int((i / total * 100) + (percent / total))
                        self.progress.emit(overall_p)
                        if eta_str:
                            self.status_update.emit(i, f"Перевод... ({eta_str})")

                    layout_failed = False
                    layout_error = None
                    
                    if self.pdf_mode == "LAYOUT":
                        try:
                            out_path = self.translator.translate_document_with_formatting(
                                path,
                                out_path,
                                target_lang,
                                progress_callback=prog_callback,
                                provider=self.provider,
                                api_key=self.api_key,
                            )
                            self.log.emit(f"✅ Сохранено (LAYOUT с разметкой): {os.path.basename(out_path)}")
                            self.file_result.emit(i, out_path)
                            self.status_update.emit(i, "Готово")
                            self._summary["success"] += 1
                            continue
                        except Exception as e:
                            layout_error = str(e)
                            layout_failed = True
                            self.log.emit(f"⚠️ LAYOUT режим не удалось ({layout_error})")
                            self.log.emit("ℹ️ Переключаюсь на FAST режим (только текст, разметка/фото/графики будут потеряны)...")

                    # FAST path (text-only) - используется когда LAYOUT выбран но не работает ИЛИ когда FAST выбран изначально
                    text = self.translator.read_file_content(path)
                    if not text:
                        raise RuntimeError("Пустой файл или не удалось извлечь текст.")

                    translated_text = self.translator.translate_text(
                        text,
                        target_lang,
                        progress_callback=prog_callback,
                        provider=self.provider,
                        api_key=self.api_key,
                    )
                    out_path = self.translator.save_translated_file(translated_text, path, target_lang, out_fmt, out_dir)
                    
                    if layout_failed:
                        self.log.emit(f"✅ Сохранено (FAST, без разметки): {os.path.basename(out_path)}")
                    else:
                        self.log.emit(f"✅ Сохранено (FAST): {os.path.basename(out_path)}")
                    
                    self.file_result.emit(i, out_path)
                    self.status_update.emit(i, "Готово")
                    self._summary["success"] += 1
                    continue

                # Read text for standard TXT files
                text = self.translator.read_file_content(path)
                if not text:
                    self.log.emit(f"❌ Ошибка: пустой файл или не удалось прочитать {os.path.basename(path)}")
                    self.status_update.emit(i, "Ошибка")
                    continue
                
                # Translate
                def trans_progress(percent, eta_str=""):
                    overall_p = int((i / total * 100) + (percent / total))
                    self.progress.emit(overall_p)
                    if eta_str:
                        self.status_update.emit(i, f"Перевод... ({eta_str})")

                translated_text = self.translator.translate_text(
                    text,
                    target_lang,
                    progress_callback=trans_progress,
                    provider=self.provider,
                    api_key=self.api_key,
                )
                
                # Save
                out_path = self.translator.save_translated_file(translated_text, path, target_lang, out_fmt, out_dir)
                self.log.emit(f"✅ Сохранено: {os.path.basename(out_path)}")
                self.file_result.emit(i, out_path)
                self.status_update.emit(i, "Готово")
                self._summary["success"] += 1
                
            except Exception as e:
                self._summary["errors"] += 1
                self._summary["messages"].append(f"{os.path.basename(path)}: {e}")
                self.log.emit(f"❌ Ошибка перевода {os.path.basename(path)}: {e}")
                self.log.emit(traceback.format_exc().strip())
                self.status_update.emit(i, "Ошибка")
            
            self.progress.emit(int((i + 1) / total * 100))
            
        self.finished.emit(dict(self._summary))
        
    def stop(self):
        self._is_running = False

class TranslationTab(QWidget):
    def __init__(self):
        super().__init__()
        self.translator = Translator()
        self._task_token = None
        self._task_queued = False
        self.init_ui()
        
    def init_ui(self):
        layout = QVBoxLayout(self)
        
        # Splitter (Vertical)
        splitter = QSplitter(Qt.Orientation.Vertical)
        
        # === 1. Text Translation Section ===
        text_widget = QGroupBox("1. Перевод текста (Google / DeepL)")
        text_layout = QVBoxLayout(text_widget)
        
        # Horizontal Splitter for In/Out
        h_splitter = QSplitter(Qt.Orientation.Horizontal)
        
        # LEFT (Input)
        left_widget = QWidget()
        left_layout = QVBoxLayout(left_widget)
        left_layout.setContentsMargins(0,0,0,0)
        
        l_top = QHBoxLayout()
        l_top.addWidget(QLabel("Исходный текст (Авто):"))
        btn_clear = QPushButton("Очистить")
        btn_clear.clicked.connect(self.clear_text)
        l_top.addWidget(btn_clear)
        left_layout.addLayout(l_top)
        
        self.txt_in = QTextEdit()
        left_layout.addWidget(self.txt_in)
        
        h_splitter.addWidget(left_widget)
        
        # RIGHT (Output)
        right_widget = QWidget()
        right_layout = QVBoxLayout(right_widget)
        right_layout.setContentsMargins(0,0,0,0)
        
        r_top = QHBoxLayout()
        r_top.addWidget(QLabel("Перевод:"))

        r_top.addWidget(QLabel("Провайдер:"))
        self.combo_provider = QComboBox()
        self.combo_provider.addItems(["Google", "DeepL"])
        self.combo_provider.currentTextChanged.connect(self.save_provider)
        r_top.addWidget(self.combo_provider)
        
        # Language Selector
        self.combo_lang_text = QComboBox()
        self.combo_lang_text.addItems(["ru", "en", "uk", "es", "de", "fr", "it", "pl"])
        r_top.addWidget(QLabel("Язык:"))
        r_top.addWidget(self.combo_lang_text)
        
        btn_copy = QPushButton("Копировать")
        btn_copy.clicked.connect(self.copy_result)
        r_top.addWidget(btn_copy)
        
        right_layout.addLayout(r_top)
        
        self.txt_out = QTextEdit()
        right_layout.addWidget(self.txt_out)
        
        h_splitter.addWidget(right_widget)
        
        text_layout.addWidget(h_splitter)
        
        # Translate Button
        self.btn_trans_text = QPushButton("▶️ ПЕРЕВЕСТИ ТЕКСТ")
        self.btn_trans_text.clicked.connect(self.translate_text)
        text_layout.addWidget(self.btn_trans_text)
        
        splitter.addWidget(text_widget)
        
        # === 2. File Translation Section ===
        file_widget = QGroupBox("2. Перевод файлов (Text/Docx/PDF)")
        file_layout = QVBoxLayout(file_widget)
        
        # Controls
        f_controls = QHBoxLayout()
        
        btn_add = QPushButton("➕ Добавить файл(ы)")
        btn_add.clicked.connect(self.add_files)
        f_controls.addWidget(btn_add)
        
        f_controls.addStretch()
        
        f_controls.addWidget(QLabel("Папка вывода:"))
        self.out_dir_display = QLabel("По умолчанию (рядом с файлом)")
        f_controls.addWidget(self.out_dir_display)
        
        btn_browse = QPushButton("📁 Папка сохранения")
        btn_browse.setMinimumWidth(150)
        btn_browse.setStyleSheet("padding: 5px; font-weight: bold;")
        btn_browse.clicked.connect(self.browse_output)
        f_controls.addWidget(btn_browse)
        
        btn_clear_list = QPushButton("🗑 Очистить")
        btn_clear_list.clicked.connect(self.clear_list)
        f_controls.addWidget(btn_clear_list)

        f_controls.addWidget(QLabel("PDF режим:"))
        self.combo_pdf_mode = QComboBox()
        self.combo_pdf_mode.addItems(["LAYOUT", "FAST"])
        self.combo_pdf_mode.setToolTip("LAYOUT: PDF→DOCX→перевод→DOCX→PDF (с разметкой). FAST: только текст.")
        self.combo_pdf_mode.currentTextChanged.connect(self.save_pdf_mode)
        f_controls.addWidget(self.combo_pdf_mode)
        
        file_layout.addLayout(f_controls)
        
        # List
        self.file_list = FileListWidget()
        self.file_list.show_language_column(True) # Show per-file language
        # We also need file formats options for output
        self.file_list.set_format_options(["docx", "pdf", "txt"])
        self.file_list.set_allowed_extensions([".txt", ".docx", ".doc", ".pdf"])
        self.file_list.files_rejected.connect(self.on_files_rejected)
        
        file_layout.addWidget(self.file_list)
        
        # Bottom Controls
        b_controls = QVBoxLayout()
        
        self.status_label = QLabel("Готов к работе")
        b_controls.addWidget(self.status_label)
        self.queue_status_label = QLabel("Готов к работе")
        self.queue_status_label.setStyleSheet("color: #6B7280;")
        b_controls.addWidget(self.queue_status_label)
        
        self.progress_bar = QProgressBar()
        b_controls.addWidget(self.progress_bar)

        self.log_area = QTextBrowser()
        self.log_area.setMaximumHeight(180)
        self.log_area.setReadOnly(True)
        b_controls.addWidget(self.log_area)
        
        self.btn_start_file_trans = QPushButton("▶️ НАЧАТЬ ПЕРЕВОД ФАЙЛОВ")
        self.btn_start_file_trans.clicked.connect(self.start_file_translation)
        b_controls.addWidget(self.btn_start_file_trans)
        
        file_layout.addLayout(b_controls)
        
        splitter.addWidget(file_widget)
        
        layout.addWidget(splitter)
        
        self.output_dir = None
        self.worker = None
        self.load_provider()
        self.load_pdf_mode()
        from src.utils.processing_guard import processing_notifier
        processing_notifier().state_changed.connect(self._refresh_processing_status)
        self._refresh_processing_status()

    def _can_export_docx_to_pdf(self) -> bool:
        try:
            import docx2pdf  # noqa: F401

            return True
        except Exception:
            pass
        return bool(find_soffice_executable())

    def _has_pdf2docx(self) -> bool:
        try:
            import pdf2docx  # noqa: F401

            return True
        except Exception:
            return False

    def load_pdf_mode(self):
        cfg = load_config()
        self.combo_pdf_mode.setCurrentText(cfg.get("translation_pdf_mode", "LAYOUT"))

    def save_pdf_mode(self, mode: str):
        cfg = load_config()
        cfg["translation_pdf_mode"] = mode
        save_config(cfg)

    def load_provider(self):
        cfg = load_config()
        self.combo_provider.setCurrentText(cfg.get("translation_provider", "Google"))

    def save_provider(self, provider: str):
        cfg = load_config()
        cfg["translation_provider"] = provider
        save_config(cfg)

    # --- Text Logic ---
    def clear_text(self):
        self.txt_in.clear()
        self.txt_out.clear()
        
    def copy_result(self):
        clipboard = QApplication.clipboard()
        clipboard.setText(self.txt_out.toPlainText())
        
    def translate_text(self):
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write(
                "translation_text_start",
                provider=self.combo_provider.currentText(),
                target=self.combo_lang_text.currentText(),
                in_len=len(self.txt_in.toPlainText() or ""),
            )
        except Exception:
            pass
        text = self.txt_in.toPlainText()
        if not text:
            return
        
        target = self.combo_lang_text.currentText()
        cfg = load_config()
        provider = self.combo_provider.currentText()
        api_key = cfg.get("deepl_api_key", "")
        self.btn_trans_text.setEnabled(False)
        self.txt_out.setText("Перевод...")
        
        self.text_worker = TextTransWorker(text, target, provider, api_key)
        self.text_worker.result.connect(self.on_text_trans_finished)
        self.text_worker.start()
        
    def on_text_trans_finished(self, text):
        self.txt_out.setText(text)
        self.btn_trans_text.setEnabled(True)

    # --- File Logic ---
    def add_files(self):
        paths, _ = QFileDialog.getOpenFileNames(self, "Выберите файлы", "", "Documents (*.txt *.docx *.doc *.pdf *.odt *.rtf);;All Files (*)")
        supported_exts = {".txt", ".docx", ".doc", ".pdf"}
        
        rejected = []
        for p in paths:
            ext = os.path.splitext(p)[1].lower()
            if ext not in supported_exts:
                rejected.append(p)
                continue
                
            self.file_list.add_file(p)
            
        if rejected:
            self.on_files_rejected(rejected)
            
    def on_files_rejected(self, rejected_paths):
        files_str = "\n".join([os.path.basename(p) for p in rejected_paths[:3]])
        if len(rejected_paths) > 3:
            files_str += f"\n...и еще {len(rejected_paths) - 3} файл(ов)"
            
        QMessageBox.warning(
            self, 
            "Формат не поддерживается напрямую", 
            f"Следующие файлы не могут быть переведены напрямую:\n{files_str}\n\n"
            "Движок Переводчика работает только с текстом. Пожалуйста, сначала перейдите во вкладку «Конвертер» "
            "и преобразуйте их в формат .docx или .pdf, а затем загрузите сюда для перевода."
        )

    def browse_output(self):
        d = QFileDialog.getExistingDirectory(self, "Выберите папку для сохранения переводов")
        if d:
            self.output_dir = d
            self.out_dir_display.setText(d)
            
    def clear_list(self):
        self.file_list.clear()

    def start_file_translation(self):
        from src.utils.processing_guard import active_processing_label, schedule_processing
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write(
                "translation_files_start",
                provider=self.combo_provider.currentText(),
                pdf_mode=self.combo_pdf_mode.currentText(),
                queue_len=len(self.file_list.files),
                output_dir=self.output_dir,
            )
        except Exception:
            pass
        files = self.file_list.files 
        count = len(files)
        if count == 0:
            return

        if self._task_queued:
            self._notify("Эта задача уже стоит в очереди.", "warning")
            return
        if hasattr(self, "worker") and self.worker and self.worker.isRunning():
            self._notify("Перевод уже выполняется.", "warning")
            return
            
        items = []
        for i, f in enumerate(files):
            path = f['path']
            # Get format
            fmt = self.file_list.get_file_format(i)
            # Get language (Per file)
            target_lang = self.file_list.get_file_language(i)
            if not target_lang:
                target_lang = "ru" # Fallback
            
            items.append({'path': path, 'lang': target_lang, 'format': fmt})

        pdf_mode = self.combo_pdf_mode.currentText()

        has_pdf_layout_job = any(
            os.path.splitext(it["path"])[1].lower() == ".pdf" and it.get("format") in {"pdf", "docx"}
            for it in items
        )
        has_pdf_to_pdf_layout_job = any(
            os.path.splitext(it["path"])[1].lower() == ".pdf" and it.get("format") == "pdf"
            for it in items
        )

        if pdf_mode == "LAYOUT" and has_pdf_layout_job and not self._has_pdf2docx():
            reply = QMessageBox.question(
                self,
                "PDF LAYOUT: нет pdf2docx",
                "Для режима LAYOUT при переводе PDF нужна библиотека pdf2docx.\n\n"
                "Переключиться на FAST (только текст) автоматически?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No | QMessageBox.StandardButton.Cancel,
            )
            if reply == QMessageBox.StandardButton.Cancel:
                return
            if reply == QMessageBox.StandardButton.Yes:
                pdf_mode = "FAST"
                self.combo_pdf_mode.setCurrentText("FAST")

        if pdf_mode == "LAYOUT" and has_pdf_to_pdf_layout_job:
            QMessageBox.information(
                self,
                "PDF → PDF (LAYOUT)",
                "Режим LAYOUT использует цепочку:\n"
                "PDF → DOCX → перевод → DOCX → PDF.\n\n"
                "Для последнего шага нужен Word (docx2pdf) или LibreOffice (soffice).",
            )
            if not self._can_export_docx_to_pdf():
                reply = QMessageBox.question(
                    self,
                    "PDF → PDF: нет конвертера",
                    "Не найден Word (docx2pdf) или LibreOffice (soffice) для финального шага DOCX→PDF.\n\n"
                    "Переключиться на FAST (только текст) автоматически?",
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No | QMessageBox.StandardButton.Cancel,
                )
                if reply == QMessageBox.StandardButton.Cancel:
                    return
                if reply == QMessageBox.StandardButton.Yes:
                    pdf_mode = "FAST"
                    self.combo_pdf_mode.setCurrentText("FAST")
            
        # Ensure output dir is set or ask
        if not self.output_dir:
             reply = QMessageBox.question(self, "Папка сохранения", 
                                        "Папка сохранения не выбрана. Файлы будут сохранены рядом с исходными. Продолжить?",
                                        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No)
             if reply == QMessageBox.StandardButton.No:
                 return
             self.output_dir = None

        cfg = load_config()
        provider = self.combo_provider.currentText()
        api_key = cfg.get("deepl_api_key", "")

        def _start_from_queue():
            self._task_queued = False
            self.worker = TranslationWorker(items, self.output_dir, provider, api_key, pdf_mode)
            self.worker.log.connect(self.update_log)
            self.worker.status_update.connect(self.file_list.update_status) 
            self.worker.file_result.connect(self.file_list.set_file_result)
            self.worker.progress.connect(self.progress_bar.setValue)
            self.worker.finished.connect(self.on_file_trans_finished)
            self.btn_start_file_trans.setEnabled(False)
            self.status_label.setText("Запуск...")
            self.worker.start()

        scheduled = schedule_processing("Перевод", _start_from_queue)
        self._task_token = scheduled["token"]
        if not scheduled["started"]:
            self._task_queued = True
            self.btn_start_file_trans.setEnabled(False)
            busy = scheduled["active_label"] or active_processing_label() or "другая задача"
            self.status_label.setText(f"В очереди: сначала {busy}")
            self._notify(f"Сейчас выполняется: {busy}. Перевод поставлен в очередь и запустится автоматически.", "info")
        self._refresh_processing_status()
        
    def update_log(self, msg):
        self.status_label.setText(msg)
        self.log_area.append(msg)

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
            self.queue_status_label.setText("Выполняется: Перевод")
        elif self._task_queued and queue_pos is not None:
            lead = active_label or "предыдущая задача"
            self.queue_status_label.setText(f"В очереди #{queue_pos}: ждёт после «{lead}»")
        elif active_label:
            self.queue_status_label.setText(f"Сейчас выполняется: {active_label}")
        else:
            self.queue_status_label.setText("Готов к работе")
        
    def on_file_trans_finished(self, summary: dict):
        from src.utils.processing_guard import release_processing
        release_processing(self._task_token)
        self._task_token = None
        success = int((summary or {}).get("success", 0))
        errors = int((summary or {}).get("errors", 0))
        total = int((summary or {}).get("total", 0))

        if errors and success:
            self.status_label.setText(f"Завершено с ошибками: {success}/{total} успешно")
        elif errors:
            self.status_label.setText("Перевод завершился с ошибками")
        else:
            self.status_label.setText("Готово!")
        self.btn_start_file_trans.setEnabled(True)
        self._refresh_processing_status()
        if errors and success:
            QMessageBox.warning(
                self,
                "Перевод завершён частично",
                f"Успешно: {success} из {total}\nОшибок: {errors}\n\nПодробности смотрите в журнале ниже.",
            )
        elif errors:
            QMessageBox.warning(
                self,
                "Перевод завершён с ошибками",
                f"Не удалось обработать {errors} файл(ов).\n\nПодробности смотрите в журнале ниже.",
            )
        else:
            QMessageBox.information(self, "Готово", "Пакетный перевод завершен")

class TextTransWorker(QThread):
    result = pyqtSignal(str)
    def __init__(self, text, lang, provider, api_key):
        super().__init__()
        self.text = text
        self.lang = lang
        self.provider = provider
        self.api_key = api_key
        self.translator = Translator()
    def run(self):
        try:
            res = self.translator.translate_text(self.text, self.lang, provider=self.provider, api_key=self.api_key)
            self.result.emit(res)
        except Exception as e:
            self.result.emit(f"Ошибка: {e}")
