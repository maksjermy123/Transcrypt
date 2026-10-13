from PyQt6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QGroupBox,
    QComboBox,
    QGridLayout,
    QMessageBox,
    QScrollArea,
)
from PyQt6.QtCore import QThread, pyqtSignal
import os
import shlex
import sys

from src.utils.runtime import recommended_cpu_threads, resolve_whisper_device
from src.utils.fs import find_ffmpeg_executable, find_ffprobe_executable, find_soffice_executable
from src.utils.config import CONFIG_FILE
from src.utils.app_paths import app_support_dir, is_windows, models_dir


class ModelDownloader(QThread):
    finished = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(self, model_name):
        super().__init__()
        self.model_name = model_name

    def run(self):
        try:
            import ssl
            import whisper

            cache_dir = models_dir()
            os.makedirs(cache_dir, exist_ok=True)
            # macOS installations behind a corporate/self-signed certificate
            # chain can fail while Whisper fetches an official model. Keep this
            # relaxation strictly inside that download call and restore normal
            # HTTPS verification immediately afterwards.
            original_https_context = ssl._create_default_https_context
            ssl._create_default_https_context = ssl._create_unverified_context
            try:
                whisper.load_model(self.model_name, download_root=cache_dir)
            finally:
                ssl._create_default_https_context = original_https_context
            self.finished.emit(self.model_name)
        except Exception as e:
            self.error.emit(str(e))


class YtDlpDownloader(QThread):
    finished = pyqtSignal(bool, str)

    def run(self):
        from src.core.model_manager import ModelManager

        manager = ModelManager()
        try:
            if getattr(sys, "frozen", False):
                success = manager.update_ytdlp_frozen()
                msg = (
                    "Обновление загружено!\n\nДля завершения установки необходимо ПЕРЕЗАПУСТИТЬ приложение."
                    if success
                    else "Не удалось обновить yt-dlp. Проверьте лог."
                )
            else:
                success = manager.update_ytdlp()
                msg = "yt-dlp успешно обновлен!" if success else "Не удалось обновить yt-dlp. Проверьте лог."

            self.finished.emit(success, msg)
        except Exception as e:
            self.finished.emit(False, str(e))


class SettingsTab(QWidget):
    def __init__(self):
        super().__init__()
        self.downloaders = {}
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
        layout.setSpacing(10)

        top_row = QHBoxLayout()

        device_group = QGroupBox("Устройство обработки (Whisper)")
        device_layout = QHBoxLayout(device_group)
        device_layout.addWidget(QLabel("Устройство:"))
        self.combo_device = QComboBox()
        self.combo_device.addItems(["Auto", "CPU", "GPU"])
        self.combo_device.currentTextChanged.connect(self.save_settings)
        device_layout.addWidget(self.combo_device)

        device_layout.addSpacing(16)
        device_layout.addWidget(QLabel("CPU потоки:"))
        self.combo_cpu_threads = QComboBox()
        self.combo_cpu_threads.addItem("Auto")
        cpu_total = int(os.cpu_count() or 1)
        for value in range(1, min(cpu_total, 16) + 1):
            self.combo_cpu_threads.addItem(str(value))
        self.combo_cpu_threads.setToolTip(
            f"Auto сейчас рекомендует {recommended_cpu_threads(cpu_total)} поток(а/ов) для вашего CPU."
        )
        self.combo_cpu_threads.currentTextChanged.connect(self.save_settings)
        device_layout.addWidget(self.combo_cpu_threads)
        top_row.addWidget(device_group, 2)

        translation_group = QGroupBox("Перевод")
        translation_layout = QHBoxLayout(translation_group)
        translation_layout.addWidget(QLabel("Провайдер:"))
        self.combo_translation_provider = QComboBox()
        self.combo_translation_provider.addItems(["Google", "DeepL"])
        self.combo_translation_provider.currentTextChanged.connect(self.on_translation_provider_changed)
        translation_layout.addWidget(self.combo_translation_provider)

        self.line_deepl_key = QLineEdit()
        self.line_deepl_key.setPlaceholderText("DeepL API key")
        self.line_deepl_key.setEchoMode(QLineEdit.EchoMode.Password)
        self.line_deepl_key.textChanged.connect(self.save_settings)
        translation_layout.addWidget(self.line_deepl_key)
        top_row.addWidget(translation_group, 1)
        layout.addLayout(top_row)

        diagnostics_group = QGroupBox("Диагностика среды")
        diagnostics_layout = QGridLayout(diagnostics_group)
        diagnostics_layout.setHorizontalSpacing(10)
        diagnostics_layout.setVerticalSpacing(6)
        diagnostics_layout.addWidget(QLabel("FFmpeg:"), 0, 0)
        self.lbl_diag_ffmpeg = QLabel("Проверка...")
        diagnostics_layout.addWidget(self.lbl_diag_ffmpeg, 0, 1)
        diagnostics_layout.addWidget(QLabel("FFprobe:"), 0, 2)
        self.lbl_diag_ffprobe = QLabel("Проверка...")
        diagnostics_layout.addWidget(self.lbl_diag_ffprobe, 0, 3)
        diagnostics_layout.addWidget(QLabel("LibreOffice:"), 1, 0)
        self.lbl_diag_soffice = QLabel("Проверка...")
        diagnostics_layout.addWidget(self.lbl_diag_soffice, 1, 1)
        diagnostics_layout.addWidget(QLabel("Устройство:"), 1, 2)
        self.lbl_diag_device = QLabel("Проверка...")
        diagnostics_layout.addWidget(self.lbl_diag_device, 1, 3)
        diagnostics_layout.addWidget(QLabel("Потоки Whisper:"), 2, 0)
        self.lbl_diag_threads = QLabel("Проверка...")
        diagnostics_layout.addWidget(self.lbl_diag_threads, 2, 1, 1, 3)
        layout.addWidget(diagnostics_group)

        update_group = QGroupBox("Обновления")
        update_layout = QHBoxLayout(update_group)
        self.btn_update_ytdlp = QPushButton("Обновить загрузчик (yt-dlp)")
        if getattr(sys, "frozen", False):
            self.btn_update_ytdlp.setToolTip("Скачать последнюю версию yt-dlp (требуется перезапуск)")
        else:
            self.btn_update_ytdlp.setToolTip("Обновить yt-dlp через pip")
        self.btn_update_ytdlp.clicked.connect(self.update_ytdlp)
        update_layout.addWidget(self.btn_update_ytdlp)
        layout.addWidget(update_group)

        model_group = QGroupBox("Управление моделями (Whisper)")
        self.model_group = model_group
        model_layout = QGridLayout(model_group)
        model_layout.setColumnStretch(1, 1)

        self.models = ["tiny", "base", "small", "medium", "large"]
        self.model_widgets = {}

        model_layout.addWidget(QLabel("<b>Модель</b>"), 0, 0)
        model_layout.addWidget(QLabel("<b>Статус</b>"), 0, 1)
        model_layout.addWidget(QLabel("<b>Действия</b>"), 0, 2, 1, 2)

        for i, model_name in enumerate(self.models):
            row = i + 1
            lbl_name = QLabel(model_name)
            lbl_name.setStyleSheet("font-size: 14px; font-weight: bold;")
            model_layout.addWidget(lbl_name, row, 0)

            lbl_status = QLabel("Проверка...")
            model_layout.addWidget(lbl_status, row, 1)

            btn_download = QPushButton("Загрузить")
            btn_download.clicked.connect(lambda checked, m=model_name: self.download_model(m))
            model_layout.addWidget(btn_download, row, 2)

            btn_delete = QPushButton("Удалить")
            btn_delete.setStyleSheet("background-color: #DC3B4C; color: white; font-weight: bold;")
            btn_delete.clicked.connect(lambda checked, m=model_name: self.delete_model(m))
            model_layout.addWidget(btn_delete, row, 3)

            self.model_widgets[model_name] = {
                "status": lbl_status,
                "btn_download": btn_download,
                "btn_delete": btn_delete,
            }

        layout.addWidget(model_group)

        danger_group = QGroupBox("Удаление программы")
        danger_layout = QHBoxLayout(danger_group)
        btn_reset = QPushButton("Удалить приложение и все данные")
        btn_reset.setStyleSheet("background-color: #DC3B4C; color: white; font-weight: bold;")
        btn_reset.clicked.connect(self.reset_application)
        danger_layout.addWidget(btn_reset)
        layout.addWidget(danger_group)

        layout.addStretch()

        self.load_settings()
        self.refresh_all_statuses()
        self.refresh_diagnostics()

    def get_cache_dir(self):
        return models_dir()

    def load_settings(self):
        from src.utils.config import load_config

        config = load_config()
        self.combo_device.setCurrentText(config.get("device", "Auto"))
        self.combo_cpu_threads.setCurrentText(str(config.get("cpu_threads", "Auto")))
        self.combo_translation_provider.setCurrentText(config.get("translation_provider", "Google"))
        self.line_deepl_key.setText(config.get("deepl_api_key", ""))
        self.on_translation_provider_changed(self.combo_translation_provider.currentText())
        self.refresh_diagnostics()

    def save_settings(self):
        from src.utils.config import load_config, save_config

        config = load_config()
        config["device"] = self.combo_device.currentText()
        config["cpu_threads"] = self.combo_cpu_threads.currentText()
        config["translation_provider"] = self.combo_translation_provider.currentText()
        config["deepl_api_key"] = self.line_deepl_key.text()
        save_config(config)
        self.refresh_diagnostics()

    def _set_diag_label(self, label: QLabel, ok: bool, text: str):
        color = "#16A34A" if ok else "#6B7280"
        label.setText(text)
        label.setStyleSheet(f"color: {color}; font-weight: 600;")

    def refresh_diagnostics(self):
        ffmpeg_path = find_ffmpeg_executable()
        ffprobe_path = find_ffprobe_executable()
        soffice_path = find_soffice_executable()
        cpu_total = int(os.cpu_count() or 1)
        thread_choice = self.combo_cpu_threads.currentText() if hasattr(self, "combo_cpu_threads") else "Auto"
        if (thread_choice or "Auto") == "Auto":
            threads_text = f"Auto -> {recommended_cpu_threads(cpu_total)} поток(а/ов) из {cpu_total}"
        else:
            threads_text = f"Ручной режим -> {thread_choice} поток(а/ов) из {cpu_total}"

        device = self.combo_device.currentText() if hasattr(self, "combo_device") else "Auto"
        resolved_device = resolve_whisper_device(device)

        self._set_diag_label(self.lbl_diag_ffmpeg, bool(ffmpeg_path), "найден" if ffmpeg_path else "не найден")
        self._set_diag_label(self.lbl_diag_ffprobe, bool(ffprobe_path), "найден" if ffprobe_path else "не найден")
        self._set_diag_label(self.lbl_diag_soffice, bool(soffice_path), "найден" if soffice_path else "не найден")
        self._set_diag_label(self.lbl_diag_device, True, f"{device} -> {resolved_device}")
        self._set_diag_label(self.lbl_diag_threads, True, threads_text)

    def on_translation_provider_changed(self, provider: str):
        is_deepl = provider == "DeepL"
        self.line_deepl_key.setVisible(is_deepl)
        self.save_settings()

    def refresh_all_statuses(self):
        for model in self.models:
            self.update_model_status(model)
        self.update_cache_size()

    def update_cache_size(self):
        """Shows total size of downloaded Whisper models in the group header."""
        cache_dir = self.get_cache_dir()
        total = 0
        try:
            for entry in os.listdir(cache_dir):
                p = os.path.join(cache_dir, entry)
                if os.path.isfile(p):
                    total += os.path.getsize(p)
        except Exception:
            pass
        size_str = f"{total / (1024 ** 3):.2f} ГБ" if total >= 1024 ** 3 else f"{total / (1024 ** 2):.1f} МБ"
        self.model_group.setTitle(f"Управление моделями (Whisper) — кэш: {size_str}")

    def update_model_status(self, model_name):
        widgets = self.model_widgets[model_name]
        path = os.path.join(self.get_cache_dir(), f"{model_name}.pt")
        exists = os.path.exists(path)

        if exists:
            widgets["status"].setText("✅ Загружена")
            widgets["status"].setStyleSheet("color: green; font-weight: bold;")
            widgets["btn_download"].setEnabled(False)
            widgets["btn_download"].setText("Загружено")
            widgets["btn_delete"].setEnabled(True)
        else:
            widgets["status"].setText("❌ Не найдена")
            widgets["status"].setStyleSheet("color: gray;")
            widgets["btn_download"].setEnabled(True)
            widgets["btn_download"].setText("Загрузить")
            widgets["btn_delete"].setEnabled(False)

    def download_model(self, model_name):
        widgets = self.model_widgets[model_name]
        widgets["status"].setText("⏳ Скачивание...")
        widgets["status"].setStyleSheet("color: orange; font-weight: bold;")
        widgets["btn_download"].setEnabled(False)
        widgets["btn_delete"].setEnabled(False)

        downloader = ModelDownloader(model_name)
        downloader.finished.connect(self.on_download_finished)
        downloader.error.connect(self.on_download_error)

        self.downloaders[model_name] = downloader
        downloader.start()

    def on_download_finished(self, model_name):
        if model_name in self.downloaders:
            del self.downloaders[model_name]
        self.update_model_status(model_name)
        self.update_cache_size()
        QMessageBox.information(self, "Успех", f"Модель {model_name} успешно загружена!")

    def on_download_error(self, error_msg):
        QMessageBox.critical(self, "Ошибка", f"Ошибка скачивания: {error_msg}")
        self.refresh_all_statuses()

    def delete_model(self, model_name):
        confirm = QMessageBox.question(
            self,
            "Подтверждение",
            f"Вы уверены, что хотите удалить модель '{model_name}'?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )
        if confirm == QMessageBox.StandardButton.Yes:
            path = os.path.join(self.get_cache_dir(), f"{model_name}.pt")
            try:
                if os.path.exists(path):
                    os.remove(path)
                self.update_model_status(model_name)
                self.update_cache_size()
            except Exception as e:
                QMessageBox.critical(self, "Ошибка", f"Не удалось удалить: {e}")

    def update_ytdlp(self):
        reply = QMessageBox.question(
            self,
            "Обновление",
            "Запустить обновление yt-dlp? Это может занять время.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )

        if reply == QMessageBox.StandardButton.Yes:
            self.btn_update_ytdlp.setEnabled(False)
            self.btn_update_ytdlp.setText("Идет обновление...")

            self.ytdlp_thread = YtDlpDownloader()
            self.ytdlp_thread.finished.connect(self.on_ytdlp_updated)
            self.ytdlp_thread.start()

    def on_ytdlp_updated(self, success, msg):
        self.btn_update_ytdlp.setEnabled(True)
        self.btn_update_ytdlp.setText("Обновить загрузчик (yt-dlp)")

        if success:
            QMessageBox.information(self, "Успех", msg)
        else:
            QMessageBox.critical(self, "Ошибка", msg)

    def reset_application(self):
        app_support = app_support_dir()
        app_bundle = None
        if getattr(sys, "frozen", False):
            if is_windows():
                app_bundle = os.path.abspath(os.path.dirname(sys.executable))
            else:
                app_bundle = os.path.abspath(os.path.join(os.path.dirname(sys.executable), "..", ".."))

        details = (
            "Вы собираетесь удалить:\n"
            "- данные приложения\n"
            "- скачанные runtime-компоненты\n"
            "- модели Whisper\n"
            "- настройки и пользовательский конфиг\n"
            "- обновления и локальные библиотеки\n"
        )
        if app_bundle and (app_bundle.endswith(".app") or is_windows()):
            details += f"- сам пакет приложения:\n  {app_bundle}\n"
        else:
            details += "- сам пакет приложения удалить автоматически не получится в этом режиме\n"

        confirm = QMessageBox.warning(
            self,
            "ОПАСНО: Полное удаление",
            details
            + f"\nТакже будет удалён файл конфига:\n  {CONFIG_FILE}\n"
            + "\nПриложение будет закрыто, а удаление выполнится сразу после выхода.\n\n"
            + "Продолжить?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
        )

        if confirm == QMessageBox.StandardButton.Yes:
            from PyQt6.QtWidgets import QApplication

            second_confirm = QMessageBox.warning(
                self,
                "Последнее подтверждение",
                "Это действие необратимо.\n\nБудут удалены настройки и данные приложения.\n\nТочно удалить всё?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            )
            if second_confirm != QMessageBox.StandardButton.Yes:
                return

            targets = [app_support]
            if os.path.exists(CONFIG_FILE):
                targets.append(CONFIG_FILE)
            if app_bundle and (app_bundle.endswith(".app") or is_windows()):
                targets.append(app_bundle)

            try:
                import subprocess

                if is_windows():
                    delete_lines = [
                        "@echo off",
                        "ping 127.0.0.1 -n 4 > nul",
                    ]
                    for path in targets:
                        if not path:
                            continue
                        normalized = os.path.normpath(path)
                        if os.path.isdir(normalized):
                            delete_lines.append(f'rmdir /s /q "{normalized}"')
                        else:
                            delete_lines.append(f'del /f /q "{normalized}"')
                    script_path = os.path.join(os.environ.get("TEMP", app_support), "voxpaperai-uninstall.cmd")
                    with open(script_path, "w", encoding="utf-8") as f:
                        f.write("\n".join(delete_lines) + "\n")
                    subprocess.Popen(
                        ["cmd.exe", "/c", script_path],
                        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
                        | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                    )
                else:
                    quoted_targets = " ".join(shlex.quote(path) for path in targets if path)
                    cmd = f"sleep 2 && rm -rf {quoted_targets}"
                    subprocess.Popen(["/bin/sh", "-c", cmd])
                if app_bundle and (app_bundle.endswith(".app") or is_windows()):
                    QMessageBox.information(
                        self,
                        "Удаление",
                        "Приложение и его данные поставлены на удаление.\n\n"
                        "После закрытия программа удалит свой пакет и папку данных автоматически.",
                    )
                else:
                    QMessageBox.information(
                        self,
                        "Удаление",
                        "Данные приложения поставлены на удаление.\n\n"
                        "Если вы работаете не из собранного .app, сам пакет программы удалите вручную.",
                    )
                QApplication.quit()
            except Exception as e:
                QMessageBox.critical(self, "Ошибка", f"Не удалось запустить очистку: {e}")

    def showEvent(self, event):
        super().showEvent(event)
        self.refresh_all_statuses()
        self.refresh_diagnostics()
