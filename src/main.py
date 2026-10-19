import sys
import os

# Windowed-сборка PyInstaller (console=False): sys.stdin/stdout/stderr равны
# None (документация PyInstaller: «std streams are unavailable and set to
# None»). Любой код, пишущий в stderr, падает с AttributeError:
# 'NoneType' object has no attribute 'write' — реальный кейс: мгновенный сбой
# «скачивания моделей Whisper» в Настройках, потому что whisper._download
# использует tqdm (tqdm#1593). Подменяем отсутствующие потоки на /dev/null —
# вывод невидим (консоли всё равно нет), зато библиотеки работают.
if getattr(sys, "frozen", False):
    try:
        if sys.stdout is None:
            sys.stdout = open(os.devnull, "w", encoding="utf-8")
        if sys.stderr is None:
            sys.stderr = open(os.devnull, "w", encoding="utf-8")
        if sys.stdin is None:
            sys.stdin = open(os.devnull, "r", encoding="utf-8")
    except Exception:
        pass

from src.utils.config import load_config
from src.utils.runtime import parse_thread_setting
from src.utils.app_paths import app_support_dir, libs_dir, runtime_bin_dir, is_macos

startup_threads = parse_thread_setting(load_config().get("cpu_threads", "Auto"))

# NOTE: SSL verification is no longer disabled globally. Whisper model
# downloads use a scoped unverified context (see engine.py / whisper_runner.py)
# only where macOS certificate issues break them; all other HTTPS traffic
# keeps full certificate verification.

# OPTIMIZATION: Set environment variables before torch/numpy initialize worker pools.
os.environ.setdefault("OMP_NUM_THREADS", str(startup_threads))
os.environ.setdefault("MKL_NUM_THREADS", str(startup_threads))
os.environ.setdefault("OPENBLAS_NUM_THREADS", str(startup_threads))
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", str(startup_threads))
os.environ.setdefault("NUMEXPR_NUM_THREADS", str(startup_threads))

# PyTorch загружается до PyQt6 (порядок важен). На Windows DLL-инициализация
# может упасть (WinError 1114 при загрузке c10.dll — pytorch#166628, а также
# старые VC++ Redistributable на системе). Раньше это крашило приложение с
# нечитаемым трейсбеком ДО появления окна — теперь ловим сбой и показываем
# понятный диалог с решением (см. _show_torch_error_dialog в main()).
torch_error: Exception | None = None
try:
    import torch
except Exception as _torch_exc:  # noqa: BLE001 — намеренно широкий захват
    torch = None  # type: ignore[assignment]
    torch_error = _torch_exc
    print(f"WARNING: PyTorch failed to load: {_torch_exc!r}")

if torch is not None:
    # Monkeypatch torch.load to fix "Weights only load failed" with newer PyTorch
    # This must be done before any other torch/whisper imports
    original_load = torch.load
    def safe_load(*args, **kwargs):
        if 'weights_only' not in kwargs:
            kwargs['weights_only'] = False
        return original_load(*args, **kwargs)
    torch.load = safe_load

# Monkeypatch whisper.audio.mel_filters to fix missing assets in PyInstaller bundle
# The issue is that whisper looks for assets relative to its __file__ (in Frameworks),
# but PyInstaller puts datas in Resources.
if torch is not None:
    try:
        import whisper.audio
        import numpy as np

        original_mel_filters = whisper.audio.mel_filters

        def patched_mel_filters(device, n_mels: int):
            # Try default path first
            default_path = os.path.join(os.path.dirname(whisper.audio.__file__), "assets", "mel_filters.npz")
            if os.path.exists(default_path):
                return original_mel_filters(device, n_mels)

            # Try PyInstaller Resources path
            if getattr(sys, 'frozen', False):
                if hasattr(sys, '_MEIPASS'):
                    # One-file
                    resource_path = os.path.join(sys._MEIPASS, "whisper", "assets", "mel_filters.npz")
                else:
                    # One-dir (macOS .app)
                    # sys.executable is in Contents/MacOS/
                    # Resources is in Contents/Resources/
                    base_dir = os.path.dirname(sys.executable)
                    resource_path = os.path.abspath(os.path.join(base_dir, "../Resources/whisper/assets/mel_filters.npz"))

                if os.path.exists(resource_path):
                    print(f"Loading whisper assets from: {resource_path}")
                    with np.load(resource_path, allow_pickle=False) as f:
                        return torch.from_numpy(f[f"mel_{n_mels}"]).to(device)

            # Fallback to original (will likely fail)
            return original_mel_filters(device, n_mels)

        whisper.audio.mel_filters = patched_mel_filters
        print("Monkeypatched whisper.audio.mel_filters")
    except Exception as e:
        print(f"Failed to monkeypatch whisper: {e}")


# --- Library Overlay for Frozen App Updates ---
# Allow loading updated libraries (e.g., yt-dlp) from user directory
# This must happen before any imports from src that might use them
if getattr(sys, 'frozen', False):
    try:
        overlay_libs_dir = libs_dir()
        if os.path.exists(overlay_libs_dir):
            sys.path.insert(0, overlay_libs_dir) # Highest priority
            print(f"Loaded custom libraries from: {overlay_libs_dir}")
    except Exception as e:
        print(f"Failed to load custom libraries: {e}")

# Add project root to sys.path to allow imports from src
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Frozen helper entrypoint: run Whisper worker logic without booting the GUI again.
if getattr(sys, "frozen", False) and len(sys.argv) > 1 and sys.argv[1] == "--whisper-runner":
    from src.core.whisper_runner import main as whisper_runner_main

    sys.argv = [sys.argv[0], *sys.argv[2:]]
    raise SystemExit(whisper_runner_main())

# Ensure bootstrapper-installed ffmpeg is in PATH (non-frozen portable installs)
try:
    runtime_bin = runtime_bin_dir()
    ffmpeg_name = "ffmpeg.exe" if sys.platform.startswith("win") else "ffmpeg"
    if os.path.exists(os.path.join(runtime_bin, ffmpeg_name)):
        os.environ["PATH"] += os.pathsep + runtime_bin
except Exception:
    pass

# Ensure bundled ffmpeg is in PATH
if getattr(sys, 'frozen', False):
    # If running as a PyInstaller bundle
    if hasattr(sys, '_MEIPASS'):
        # One-file mode
        bundle_dir = sys._MEIPASS
        resource_dir = sys._MEIPASS
    else:
        bundle_dir = os.path.dirname(sys.executable)
        resource_dir = (
            os.path.abspath(os.path.join(bundle_dir, '../Resources'))
            if is_macos()
            else bundle_dir
        )
        if resource_dir != bundle_dir:
            os.environ["PATH"] += os.pathsep + resource_dir
        
    os.environ["PATH"] += os.pathsep + bundle_dir
    print(f"Updated PATH with bundle dirs: {bundle_dir}")

    # Ensure Qt can locate macOS platform plugins like libqcocoa.dylib in the bundle.
    qt_plugins_root = os.path.join(resource_dir, "PyQt6", "Qt6", "plugins")
    qt_platforms_root = os.path.join(qt_plugins_root, "platforms")
    if os.path.isdir(qt_plugins_root):
        os.environ["QT_PLUGIN_PATH"] = qt_plugins_root
    if os.path.isdir(qt_platforms_root):
        os.environ["QT_QPA_PLATFORM_PLUGIN_PATH"] = qt_platforms_root
    print(f"Qt plugin path: {os.environ.get('QT_PLUGIN_PATH', '')}")
    print(f"Qt platform plugin path: {os.environ.get('QT_QPA_PLATFORM_PLUGIN_PATH', '')}")

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import Qt
from src.ui.main_window import MainWindow
from src.ui.widgets.disclaimer_dialog import DisclaimerDialog
from src.utils.logger import setup_logger
from src.utils.event_log import get_event_log
from src.utils.config import save_config


def bundled_path(*parts: str) -> str:
    """Resolve resource paths for both dev mode and PyInstaller bundles."""
    if getattr(sys, "frozen", False):
        if hasattr(sys, "_MEIPASS"):
            base_dir = sys._MEIPASS
        else:
            base_dir = os.path.abspath(os.path.join(os.path.dirname(sys.executable), "../Resources"))
        return os.path.join(base_dir, *parts)
    return os.path.join(os.path.dirname(__file__), *parts)


def _install_ui_event_logging(app: QApplication):
    import logging
    from PyQt6.QtCore import QObject, QEvent
    from PyQt6.QtWidgets import QPushButton, QToolButton, QComboBox, QLineEdit, QTextEdit

    ev = get_event_log()
    logging.info(f"Event log: {ev.path}")
    ev.write("app_start", pid=os.getpid())

    class EventFilter(QObject):
        def eventFilter(self, obj, event):
            try:
                et = event.type()

                if et == QEvent.Type.MouseButtonRelease:
                    if isinstance(obj, (QPushButton, QToolButton)):
                        name = obj.objectName() or ""
                        try:
                            text = obj.text()
                        except Exception:
                            text = ""
                        ev.write(
                            "ui_click",
                            widget=obj.__class__.__name__,
                            object_name=name,
                            text=text,
                            enabled=bool(obj.isEnabled()),
                        )

                elif et == QEvent.Type.KeyPress:
                    key = getattr(event, "key", lambda: None)()
                    modifiers = int(getattr(event, "modifiers", lambda: 0)())
                    if key is not None:
                        ev.write("ui_keypress", key=int(key), modifiers=modifiers, widget=obj.__class__.__name__)

                elif et == QEvent.Type.FocusOut:
                    if isinstance(obj, (QLineEdit,)):
                        name = obj.objectName() or ""
                        val = obj.text()
                        if "key" in name.lower() or "api" in name.lower():
                            val = "***"
                        ev.write("ui_edit", widget="QLineEdit", object_name=name, value=val[:200])
                    elif isinstance(obj, (QComboBox,)):
                        ev.write("ui_select", widget="QComboBox", object_name=obj.objectName() or "", value=obj.currentText())
                    elif isinstance(obj, (QTextEdit,)):
                        ev.write("ui_text", widget="QTextEdit", object_name=obj.objectName() or "", length=len(obj.toPlainText() or ""))

            except Exception:
                pass
            return super().eventFilter(obj, event)

    f = EventFilter()
    app.installEventFilter(f)
    app._vox_event_filter = f

def exception_hook(exctype, value, traceback):
    import logging
    logging.error("Uncaught exception", exc_info=(exctype, value, traceback))
    try:
        get_event_log().write("uncaught_exception", exctype=str(exctype), value=str(value))
    except Exception:
        pass
    sys.__excepthook__(exctype, value, traceback)


def _theme_qss_path(app: QApplication) -> str:
    assets_dir = bundled_path("ui", "assets")
    scheme = app.styleHints().colorScheme()
    if scheme == Qt.ColorScheme.Light:
        light_path = os.path.join(assets_dir, "style_light.qss")
        if os.path.exists(light_path):
            return light_path
    return os.path.join(assets_dir, "style.qss")


def _show_torch_error_dialog(exc: Exception):
    """Понятный диалог вместо нечитаемого трейсбека, если PyTorch не загрузился.

    Типичный кейс — Windows: WinError 1114 при инициализации c10.dll
    (конфликт версий PyTorch либо старый/отсутствующий VC++ Redistributable).
    Даём пользователю действия: установить VC++ Redistributable, проверить
    версию Windows, обновить сборку — с кнопками, открывающими нужные ссылки.
    """
    from PyQt6.QtCore import QUrl, QDesktopServices
    from PyQt6.QtWidgets import QMessageBox

    text = (
        "Не удалось загрузить PyTorch — компонент, необходимый для транскрибации.\n\n"
        "Что делать:\n"
        "1. Установите Microsoft Visual C++ Redistributable 2015–2022 (x64) и перезагрузите компьютер.\n"
        "2. Проверьте версию Windows: поддерживаются Windows 10/11 (64-бит); Windows 7/8 — нет.\n"
        "3. Скачайте свежую сборку программы — в новых версиях ошибка может быть уже исправлена.\n"
        "4. Если не помогло — добавьте папку программы в исключения антивируса и распакуйте архив заново."
    )
    box = QMessageBox(QMessageBox.Icon.Critical, "VoxPaperAi Pro — ошибка запуска", text)
    box.setDetailedText(repr(exc))
    vc_btn = box.addButton(
        "Открыть страницу Visual C++ Redistributable",
        QMessageBox.ButtonRole.ActionRole,
    )
    dl_btn = box.addButton(
        "Открыть страницу загрузок программы",
        QMessageBox.ButtonRole.ActionRole,
    )
    box.addButton(QMessageBox.StandardButton.Close)
    box.exec()
    if box.clickedButton() is vc_btn:
        QDesktopServices.openUrl(QUrl("https://aka.ms/vs/17/release/vc_redist.x64.exe"))
    elif box.clickedButton() is dl_btn:
        QDesktopServices.openUrl(QUrl("https://github.com/maksjermy123/Transcrypt/releases/latest"))


def _apply_theme(app: QApplication):
    qss_path = _theme_qss_path(app)
    if os.path.exists(qss_path):
        with open(qss_path, "r", encoding="utf-8") as f:
            app.setStyleSheet(f.read())

def main():
    # Setup logging
    setup_logger()
    sys.excepthook = exception_hook
    
    # Create Application
    app = QApplication(sys.argv)
    app.setApplicationName("VoxPaperAi Pro")
    app.setOrganizationName("VoxPaperAi")

    # PyTorch не загрузился при старте — объясняем пользователю, что делать,
    # вместо нечитаемого трейсбека из консоли/диалога PyInstaller.
    if torch_error is not None:
        _show_torch_error_dialog(torch_error)
        sys.exit(1)

    # NOTE: Global UI/event telemetry caused native PyQt crashes on macOS in clipboard/window-state paths.
    # Keep the function in codebase for future debugging, but do not install it in runtime builds.
    # _install_ui_event_logging(app)
    
    # Apply Icon
    import PyQt6.QtGui as QtGui
    logo_path = bundled_path("ui", "assets", "logo.png")
    if os.path.exists(logo_path):
        app.setWindowIcon(QtGui.QIcon(logo_path))
        
    # Apply theme based on current system appearance
    _apply_theme(app)
    try:
        app.styleHints().colorSchemeChanged.connect(lambda *_: _apply_theme(app))
    except Exception:
        pass
    try:
        app.applicationStateChanged.connect(lambda *_: _apply_theme(app))
    except Exception:
        pass

    runtime_config = load_config()
    if not runtime_config.get("disclaimer_accepted", False):
        dialog = DisclaimerDialog()
        _apply_theme(app)
        if dialog.exec() != int(dialog.DialogCode.Accepted):
            sys.exit(0)
        runtime_config["disclaimer_accepted"] = True
        save_config(runtime_config)
    
    # Create Main Window
    window = MainWindow()
    window.show()
    
    # Run Event Loop
    sys.exit(app.exec())

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    main()
