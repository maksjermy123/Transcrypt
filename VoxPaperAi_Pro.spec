# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
import sys

import PyQt6
from PyInstaller.utils.hooks import collect_data_files

# Иконка исполняемого файла: macOS — .icns, Windows/Linux — .ico
# (PyInstaller на Windows принимает только .ico/.exe/.dll).
ICON_ICNS = "resources/icon.icns"
ICON_ICO = "resources/icon.ico"
ICON = ICON_ICNS if sys.platform == "darwin" else ICON_ICO

whisper_datas = collect_data_files("whisper", includes=["assets/*"])
docx_datas = collect_data_files("docx", includes=["templates/**/*", "templates/*"])
pyqt6_root = Path(PyQt6.__file__).resolve().parent
pyqt6_plugins_root = pyqt6_root / "Qt6" / "plugins"

qt_plugin_datas = []
for folder in ("platforms", "styles", "imageformats", "iconengines"):
    source = pyqt6_plugins_root / folder
    if source.exists():
        qt_plugin_datas.append((str(source), f"PyQt6/Qt6/plugins/{folder}"))

a = Analysis(
    ["src/main.py"],
    pathex=[],
    binaries=[],
    datas=[
        ("src/ui/assets", "ui/assets"),
        ("VERSION", "."),
        ("LICENSE", "."),
        ("DISCLAIMER.txt", "."),
        *qt_plugin_datas,
        *whisper_datas,
        *docx_datas,
    ],
    hiddenimports=[
        "PyQt6",
        "PyQt6.QtCore",
        "PyQt6.QtGui",
        "PyQt6.QtWidgets",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="VoxPaperAi Pro",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="VoxPaperAi Pro",
)

app = BUNDLE(
    coll,
    name="VoxPaperAi Pro.app",
    icon="resources/icon.icns",
    bundle_identifier="com.voxpaperai.pro",
    info_plist={
        "CFBundleDisplayName": "VoxPaperAi Pro",
        "CFBundleName": "VoxPaperAi Pro",
        "CFBundleShortVersionString": "1.0.0",
        "NSHighResolutionCapable": True,
    },
)
