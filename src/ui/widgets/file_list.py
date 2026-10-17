from PyQt6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QTableWidget,
    QTableWidgetItem,
    QPushButton,
    QHeaderView,
    QAbstractItemView,
    QApplication,
    QToolButton,
    QStyle,
    QComboBox,
    QLabel,
)
from PyQt6.QtGui import QIcon
from PyQt6.QtGui import QColor
from PyQt6.QtGui import QKeySequence
from PyQt6.QtCore import Qt, pyqtSignal
import os

class FileListWidget(QWidget):
    files_dropped = pyqtSignal(list) # Emits list of file paths
    files_rejected = pyqtSignal(list) # Emits list of rejected file paths (due to ext)
    urls_rejected = pyqtSignal(list) # Emits list of messages: ссылки «не на видео», отклонённые при вставке
    
    def __init__(self):
        super().__init__()
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        
        self.table = QTableWidget()
        self.table.setColumnCount(6) # Increased to 6
        self.table.setHorizontalHeaderLabels(["#", "Файл", "Язык", "Формат", "Статус", "Действия"])
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        self.table.setColumnWidth(2, 110)
        self.table.setColumnWidth(3, 110)
        self.table.setColumnWidth(5, 280)
        self.table.verticalHeader().setDefaultSectionSize(40)
        self.table.verticalHeader().setVisible(False)
        self.table.setShowGrid(False)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setWordWrap(False)
        
        # Hide Language column by default
        self.table.setColumnHidden(2, True)
        
        # Drag & Drop
        self.setAcceptDrops(True)
        self.table.setAcceptDrops(True)
        self.table.dragEnterEvent = self.dragEnterEvent
        self.table.dragMoveEvent = self.dragMoveEvent
        self.table.dropEvent = self.dropEvent
        
        self.layout.addWidget(self.table)
        
        self.files = [] # List of dicts: {'path': ..., 'status': ..., 'format': ...}
        self.default_formats = []
        self.force_formats = None # If set, overrides all logic
        self.allowed_extensions = None # If set, filters out other extensions

        # Дуальный выбор языков в строке (транскрибация): [исходный] → [перевод]
        self.dual_language = False
        self.source_langs = ["auto", "ru", "en", "uk", "es", "de", "fr", "it", "pl"]
        self.target_langs = ["-", "ru", "en", "uk", "es", "de", "fr", "it", "pl"]
        self.default_source_lang = "auto"
        self.default_target_lang = "-"

    def set_dual_language_mode(self, enabled: bool):
        """Включает в колонке «Язык» два селекта напротив каждой записи:
        исходный язык → язык перевода (как в веб-версии)."""
        self.dual_language = bool(enabled)
        header = "Язык: исх → перевод" if self.dual_language else "Язык"
        self.table.setHorizontalHeaderItem(2, QTableWidgetItem(header))
        self.table.setColumnWidth(2, 230 if self.dual_language else 110)
        if self.dual_language:
            self.show_language_column(True)

    def set_language_defaults(self, source: str, target: str):
        """Значения по умолчанию для НОВЫХ строк (последние использованные)."""
        if source:
            self.default_source_lang = source
        if target:
            self.default_target_lang = target

    def _formats_for_path(self, path: str):
        if self.force_formats:
            return list(self.force_formats)

        is_url = path.startswith("http")
        ext = "" if is_url else os.path.splitext(path)[1].lower()

        audio_exts = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.alac', '.wma']
        video_exts = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv']
        img_exts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif']
        doc_exts = ['.pdf', '.docx', '.doc', '.txt', '.odt', '.rtf', '.rtfd']

        if is_url:
            return ["mp3", "mp4", "wav", "mkv", "avi"]
        if ext in audio_exts:
            return ["mp3", "wav", "m4a", "flac", "aac", "ogg"]
        if ext in video_exts:
            return ["mp4", "mkv", "avi", "mov", "mp3", "wav"]
        if ext in img_exts:
            return ["jpg", "png", "webp", "pdf", "gif"]
        if ext in doc_exts:
            return ["docx", "odt", "pdf", "txt", "rtf"]
        return list(self.default_formats or [])

    def _populate_format_combo(self, combo, path: str, selected: str | None = None):
        formats = self._formats_for_path(path)
        combo.blockSignals(True)
        combo.clear()
        if formats:
            combo.addItems(formats)
            selected = (selected or "").strip().lower()
            idx = combo.findText(selected, Qt.MatchFlag.MatchFixedString) if selected else -1
            combo.setCurrentIndex(idx if idx >= 0 else 0)
            combo.setEnabled(True)
        else:
            combo.addItem("-")
            combo.setEnabled(False)
        combo.blockSignals(False)

    def _icon_or_text(self, icon: QIcon, fallback_text: str) -> tuple[QIcon | None, str]:
        if not icon.isNull():
            return icon, ""
        return None, fallback_text

    def _status_palette(self, status: str):
        value = (status or "").strip().lower()
        if "ошиб" in value:
            return QColor("#5E1B2A"), QColor("#FFD9E1")
        if "готов" in value:
            return QColor("#173F31"), QColor("#DDF8E8")
        if "очеред" in value:
            return QColor("#173563"), QColor("#DCEBFF")
        if any(token in value for token in ["обработ", "скачив", "распознав", "перевод", "конвертац", "вшиван", "очистк", "запуск", "сохранен"]):
            return QColor("#4A3515"), QColor("#FFF2D8")
        if "пропущ" in value:
            return QColor("#253142"), QColor("#D9E3F0")
        return QColor("#1F2B3B"), QColor("#C8D4E6")

    def _apply_status_style(self, row: int, status: str):
        item = self.table.item(row, 4)
        if item is None:
            item = QTableWidgetItem(status)
            self.table.setItem(row, 4, item)
        bg, fg = self._status_palette(status)
        item.setText(status)
        item.setBackground(bg)
        item.setForeground(fg)
        item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)

    def set_allowed_extensions(self, exts):
        """Pass a set or list of allowed lower-case extensions, e.g., {'.txt', '.pdf'}"""
        self.allowed_extensions = set(ext for ext in exts)

    def set_format_options(self, options):
        self.default_formats = options

    def set_override_formats(self, formats):
        """Forces these formats for ALL added files regardless of type."""
        self.force_formats = formats
        self.refresh_format_options()

    def refresh_format_options(self):
        for row, file_info in enumerate(self.files):
            combo = self.table.cellWidget(row, 3)
            if combo is None:
                continue
            current = combo.currentText() if hasattr(combo, "currentText") else None
            self._populate_format_combo(combo, file_info['path'], current)

    def show_language_column(self, visible=True):
        self.table.setColumnHidden(2, not visible)

    def add_file(self, path):
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("filelist_add_attempt", path=str(path))
        except Exception:
            pass

        if self.allowed_extensions:
            ext = os.path.splitext(path)[1].lower()
            if ext not in self.allowed_extensions:
                # Discard file silently, or maybe we let the parent handle the warning
                # Better yet, return False to indicate rejection
                try:
                    from src.utils.event_log import get_event_log

                    get_event_log().write("filelist_rejected_ext", path=str(path), ext=str(ext))
                except Exception:
                    pass
                return False
                
        if any(f['path'] == path for f in self.files):
            try:
                from src.utils.event_log import get_event_log

                get_event_log().write("filelist_duplicate", path=str(path))
            except Exception:
                pass
            return False # Duplicate
            
        row = self.table.rowCount()
        self.table.insertRow(row)
        
        # 0: Index
        self.table.setItem(row, 0, QTableWidgetItem(str(row + 1)))
        
        # 1: Filename
        name = os.path.basename(path)
        self.table.setItem(row, 1, QTableWidgetItem(name))
        
        # 2: Language — один селект или пара «исходный → перевод» напротив записи
        if self.dual_language:
            container = QWidget()
            h = QHBoxLayout(container)
            h.setContentsMargins(2, 0, 2, 0)
            h.setSpacing(3)
            src_combo = QComboBox()
            src_combo.addItems(self.source_langs)
            si = src_combo.findText(self.default_source_lang, Qt.MatchFlag.MatchFixedString)
            src_combo.setCurrentIndex(si if si >= 0 else 0)
            src_combo.setToolTip(
                "Исходный язык этой записи: на нём звучит речь «auto» — определить автоматически"
            )
            tgt_combo = QComboBox()
            tgt_combo.addItems(self.target_langs)
            ti = tgt_combo.findText(self.default_target_lang, Qt.MatchFlag.MatchFixedString)
            tgt_combo.setCurrentIndex(ti if ti >= 0 else 0)
            tgt_combo.setToolTip("Перевод для этой записи: «-» — без перевода")
            h.addWidget(src_combo)
            h.addWidget(QLabel("→"))
            h.addWidget(tgt_combo)
            self.table.setCellWidget(row, 2, container)
        else:
            lang_combo = QComboBox()
            # Common languages
            lang_combo.addItems(["ru", "en", "uk", "es", "de", "fr", "it", "pl"])
            self.table.setCellWidget(row, 2, lang_combo)
        
        # 3: Format (ComboBox)
        combo = QComboBox()
        
        self._populate_format_combo(combo, path)
            
        self.table.setCellWidget(row, 3, combo)
        
        # 4: Status
        self.table.setItem(row, 4, QTableWidgetItem("Ожидание"))
        self._apply_status_style(row, "Ожидание")
        
        # 5: Actions (Open Folder, Copy, Delete)
        action_widget = QWidget()
        action_layout = QHBoxLayout(action_widget)
        action_layout.setContentsMargins(0, 0, 0, 0)
        action_layout.setSpacing(5)
        
        # Btn Open Folder
        btn_open = QToolButton()
        open_icon, open_text = self._icon_or_text(
            QApplication.style().standardIcon(QStyle.StandardPixmap.SP_DirOpenIcon),
            "Open",
        )
        if open_icon:
            btn_open.setIcon(open_icon)
        if open_text:
            btn_open.setText(open_text)
        btn_open.setToolTip("Открыть папку с файлом")
        btn_open.setAutoRaise(True)
        btn_open.setFixedSize(32, 28)
        btn_open.setEnabled(False) # Enabled when result ready
        action_layout.addWidget(btn_open)
        
        # Btn Copy
        btn_copy = QToolButton()
        copy_icon = QIcon.fromTheme("edit-copy")
        copy_icon, copy_text = self._icon_or_text(copy_icon, "Copy")
        if copy_icon:
            btn_copy.setIcon(copy_icon)
        if copy_text:
            btn_copy.setText(copy_text)
        btn_copy.setToolTip("Скопировать путь/содержимое")
        btn_copy.setAutoRaise(True)
        btn_copy.setFixedSize(32, 28)
        btn_copy.setEnabled(False) 
        action_layout.addWidget(btn_copy)
        
        # Btn Delete
        btn_del = QToolButton()
        del_icon, del_text = self._icon_or_text(
            QApplication.style().standardIcon(QStyle.StandardPixmap.SP_TrashIcon),
            "Del",
        )
        if del_icon:
            btn_del.setIcon(del_icon)
        if del_text:
            btn_del.setText(del_text)
        btn_del.setToolTip("Удалить из списка")
        btn_del.setAutoRaise(True)
        btn_del.setFixedSize(32, 28)
        btn_del.clicked.connect(lambda checked, r=row: self.remove_file(r))
        action_layout.addWidget(btn_del)

        self.table.setCellWidget(row, 5, action_widget)
        
        # Store widgets and empty result path
        self.files.append({
            'path': path, 
            'status': 'waiting', 
            'widget_row': row,
            'result_path': None,
            'btn_open': btn_open,
            'btn_copy': btn_copy,
        })
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("filelist_added", path=str(path), row=int(row))
        except Exception:
            pass

    def remove_file(self, row):
        try:
            from src.utils.event_log import get_event_log

            p = self.files[row]["path"] if 0 <= row < len(self.files) else None
            get_event_log().write("filelist_remove", row=int(row), path=p)
        except Exception:
            pass
        self.table.removeRow(row)
        if row < len(self.files):
            self.files.pop(row)
        
        # Re-index
        for i in range(self.table.rowCount()):
            self.table.setItem(i, 0, QTableWidgetItem(str(i + 1)))
            
            # Update delete button callback (and we need to access the widget inside cell widget)
            w = self.table.cellWidget(i, 5)
            if w:
                layout = w.layout()
                if layout:
                    btn_del = None
                    for item_idx in range(layout.count()):
                        widget = layout.itemAt(item_idx).widget()
                        if widget and getattr(widget, "toolTip", lambda: "")() == "Удалить из списка":
                            btn_del = widget
                            break
                    if btn_del:
                        try:
                            btn_del.clicked.disconnect()
                        except:
                            pass
                        btn_del.clicked.connect(lambda checked, r=i: self.remove_file(r))
            
            if i < len(self.files):
                self.files[i]['widget_row'] = i

    def remove_by_path(self, path: str) -> bool:
        """Remove first matching row by original path/URL."""
        for idx, f in enumerate(list(self.files)):
            if f.get("path") == path:
                self.remove_file(idx)
                return True
        return False

    def set_file_result(self, index, result_path):
        """Called when processing finishes for a file."""
        if 0 <= index < len(self.files):
            f = self.files[index]
            f['result_path'] = result_path
            f['status'] = 'Готово'
            self._apply_status_style(index, "Готово")
            
            # Enable buttons
            if result_path and os.path.exists(result_path):
                f['btn_open'].setEnabled(True)
                f['btn_copy'].setEnabled(True)
                
                # Connect slots (disconnect first to be safe)
                try:
                    f['btn_open'].clicked.disconnect()
                    f['btn_copy'].clicked.disconnect()
                except:
                    pass
                    
                f['btn_open'].clicked.connect(lambda checked, p=result_path: self.open_file_folder(p))
                f['btn_copy'].clicked.connect(lambda checked, p=result_path: self.copy_file_content(p))

    def open_file_folder(self, path):
        import subprocess, sys
        folder = os.path.dirname(path)
        if os.path.exists(folder):
            if sys.platform == "win32":
                os.startfile(folder)
            elif sys.platform == "darwin":
                subprocess.run(["open", folder])
            else:
                subprocess.run(["xdg-open", folder])

    def copy_file_content(self, path):
        clipboard = QApplication.clipboard()
        ext = os.path.splitext(path)[1].lower()
        if ext in ['.txt', '.json', '.srt', '.vtt', '.xml', '.log', '.csv']:
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    clipboard.setText(content)
            except:
                clipboard.setText(path)
        else:
            clipboard.setText(path)

    def clear(self):
        self.table.setRowCount(0)
        self.files.clear()

    def update_status(self, index, status):
        if 0 <= index < self.table.rowCount():
            self._apply_status_style(index, status)
            self.files[index]['status'] = status
            if "ошиб" not in (status or "").lower():
                self.clear_retry_action(index)

    def set_action_button(self, index, text, callback):
        if 0 <= index < self.table.rowCount():
            btn = QPushButton(text)
            btn.clicked.connect(callback)
            self.table.setCellWidget(index, 5, btn)

    def set_retry_action(self, index, callback):
        """Add one retry action to a failed row without replacing its other actions."""
        if not (0 <= index < self.table.rowCount()):
            return
        container = self.table.cellWidget(index, 5)
        layout = container.layout() if container else None
        if layout is None:
            return
        for item_index in range(layout.count()):
            widget = layout.itemAt(item_index).widget()
            if widget and widget.objectName() == "retryTaskButton":
                return
        button = QPushButton("Повторить")
        button.setObjectName("retryTaskButton")
        button.setToolTip("Повторить обработку этой задачи")
        button.clicked.connect(callback)
        layout.insertWidget(0, button)

    def clear_retry_action(self, index):
        if not (0 <= index < self.table.rowCount()):
            return
        container = self.table.cellWidget(index, 5)
        layout = container.layout() if container else None
        if layout is None:
            return
        for item_index in range(layout.count() - 1, -1, -1):
            widget = layout.itemAt(item_index).widget()
            if widget and widget.objectName() == "retryTaskButton":
                layout.takeAt(item_index)
                widget.deleteLater()

    def get_file_format(self, index):
        if 0 <= index < self.table.rowCount():
            combo = self.table.cellWidget(index, 3)
            if combo:
                return combo.currentText()
        return None

    def get_files(self):
        """Returns a list of file paths currently in the list."""
        return [f['path'] for f in self.files]

    def get_file_language(self, index):
        """Исходный язык записи (первый селект в дуальном режиме)."""
        if 0 <= index < self.table.rowCount():
            cell = self.table.cellWidget(index, 2)
            if cell is None:
                return None
            if self.dual_language:
                combo = cell.findChild(QComboBox)
                return combo.currentText() if combo else None
            if hasattr(cell, "currentText"):
                return cell.currentText()
        return None

    def get_file_target_language(self, index):
        """Язык перевода записи (второй селект в дуальном режиме)."""
        if not self.dual_language:
            return None
        if 0 <= index < self.table.rowCount():
            cell = self.table.cellWidget(index, 2)
            if cell is not None:
                combos = cell.findChildren(QComboBox)
                if len(combos) >= 2:
                    return combos[1].currentText()
        return None

    # Drag & Drop Handlers
    def dragEnterEvent(self, event):
        if event.mimeData().hasUrls():
            event.accept()
        else:
            event.ignore()

    def dragMoveEvent(self, event):
        if event.mimeData().hasUrls():
            event.accept()
        else:
            event.ignore()

    def dropEvent(self, event):
        files = []
        rejected_files = []
        for url in event.mimeData().urls():
            path = url.toLocalFile()
            if os.path.isfile(path):
                if self.add_file(path) is False and self.allowed_extensions:
                    # Check if it was rejected due to extension (not duplicate)
                    ext = os.path.splitext(path)[1].lower()
                    if ext not in self.allowed_extensions:
                        rejected_files.append(path)
                else:
                    files.append(path)
        
        # If any files were rejected and we have allowed exts, maybe emit a signal?
        # A simple QMessageBox here is easiest, but FileListWidget is generic.
        # Let parent handle it via a new signal: files_rejected
        if rejected_files and hasattr(self, 'files_rejected'):
            self.files_rejected.emit(rejected_files)
            
        if files:
            self.files_dropped.emit(files)
            event.accept()
        else:
            event.ignore()

    def keyPressEvent(self, event):
        # Handle Cmd+V (Paste)
        if event.matches(QKeySequence.StandardKey.Paste):
            self.paste_from_clipboard()
        # Handle Delete/Backspace
        elif event.key() in (Qt.Key.Key_Delete, Qt.Key.Key_Backspace):
            self.remove_selected()
        else:
            super().keyPressEvent(event)

    def paste_from_clipboard(self):
        clipboard = QApplication.clipboard()
        text = clipboard.text().strip()
        if text:
            try:
                from src.utils.event_log import get_event_log

                get_event_log().write("paste_from_clipboard", length=len(text), sample=text[:120])
            except Exception:
                pass
            # Ссылки — в любом месте вставленного текста, не только в начале строки.
            # КАЖДАЯ ссылка ПЕРЕД добавлением проверяется классификатором:
            # страницы каналов/студий/плейлистов/профилей отклоняются с объяснением,
            # чтобы не ждать ошибку yt-dlp после старта.
            from src.utils.url_checker import extract_urls_from_text, filter_video_urls

            urls, rejected = filter_video_urls(extract_urls_from_text(text))
            added = 0
            for url in urls:
                if self.add_file(url) is not False:
                    added += 1
            if rejected:
                self.urls_rejected.emit(rejected)
            if added:
                try:
                    from src.utils.event_log import get_event_log

                    get_event_log().write("paste_urls_added", added=int(added), rejected=len(rejected))
                except Exception:
                    pass
    
    def remove_selected(self):
        rows = sorted(set(index.row() for index in self.table.selectedIndexes()), reverse=True)
        for row in rows:
            self.remove_file(row)
