import os
import sys
from pathlib import Path

APP_NAME = "VoxPaperAi"
APP_DISPLAY_NAME = "VoxPaperAi Pro"


def is_windows() -> bool:
    return sys.platform.startswith("win")


def is_macos() -> bool:
    return sys.platform == "darwin"


def home_dir() -> Path:
    return Path.home()


def _env_path(name: str) -> Path | None:
    value = os.environ.get(name)
    if value:
        return Path(value)
    return None


def app_support_dir() -> str:
    if is_windows():
        base = _env_path("LOCALAPPDATA") or (home_dir() / "AppData" / "Local")
        return str(base / APP_NAME)
    if is_macos():
        return str(home_dir() / "Library" / "Application Support" / APP_NAME)
    base = _env_path("XDG_DATA_HOME") or (home_dir() / ".local" / "share")
    return str(base / APP_NAME)


def app_config_dir() -> str:
    if is_windows():
        base = _env_path("APPDATA") or (home_dir() / "AppData" / "Roaming")
        return str(base / APP_NAME)
    if is_macos():
        return app_support_dir()
    base = _env_path("XDG_CONFIG_HOME") or (home_dir() / ".config")
    return str(base / APP_NAME)


def config_file_path() -> str:
    return os.path.join(app_config_dir(), "config.json")


def legacy_config_file_path() -> str:
    return str(home_dir() / ".voxpaperai_config.json")


def logs_dir() -> str:
    return os.path.join(app_support_dir(), "logs")


def models_dir() -> str:
    return os.path.join(app_support_dir(), "models")


def libs_dir() -> str:
    return os.path.join(app_support_dir(), "libs")


def runtime_dir() -> str:
    return os.path.join(app_support_dir(), "runtime")


def runtime_bin_dir() -> str:
    return os.path.join(runtime_dir(), "bin")


def ffmpeg_binary_name() -> str:
    return "ffmpeg.exe" if is_windows() else "ffmpeg"


def ffprobe_binary_name() -> str:
    return "ffprobe.exe" if is_windows() else "ffprobe"


def user_documents_dir() -> str:
    if is_windows():
        profile = _env_path("USERPROFILE") or home_dir()
        return str(profile / "Documents")
    return str(home_dir() / "Documents")


def default_output_dir(name: str) -> str:
    return os.path.join(user_documents_dir(), APP_DISPLAY_NAME, name)


def cyrillic_font_candidates() -> list[str]:
    candidates: list[str] = []
    if is_windows():
        win_dir = os.environ.get("WINDIR", r"C:\Windows")
        candidates.extend(
            [
                os.path.join(win_dir, "Fonts", "arial.ttf"),
                os.path.join(win_dir, "Fonts", "ARIAL.TTF"),
                os.path.join(win_dir, "Fonts", "segoeui.ttf"),
                os.path.join(win_dir, "Fonts", "calibri.ttf"),
            ]
        )
    elif is_macos():
        candidates.extend(
            [
                "/Library/Fonts/Arial.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                os.path.expanduser("~/Library/Fonts/Arial.ttf"),
            ]
        )

    candidates.extend(
        [
            "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
            "/usr/share/fonts/truetype/arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
        ]
    )
    return candidates
