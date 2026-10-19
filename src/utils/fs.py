import os
import re
import subprocess
from urllib.parse import urlparse

from src.utils.app_paths import (
    ffmpeg_binary_name,
    ffprobe_binary_name,
    is_windows,
    runtime_bin_dir,
)
from src.utils.winproc import no_window_kwargs

# ─── Кэш найденных исполняемых файлов ─────────────────────────────
# /api/health вызывается сайтом каждые ~30 секунд, и раньше каждый вызов
# заново запускал «ffmpeg -version» как дочерний процесс: на Windows это
# (а) мигало чёрными консольными окнами (движок работает под pythonw),
# (б) занимало 0.5-2 сек — health-опрос не успевал за таймаут сайта, и
# индикатор «Движок online» мигал. Теперь положительный результат кэшируется
# (с дешёвой проверкой os.path.exists), а повторные пробы не запускаются.
# Отрицательный результат НЕ кэшируется: если пользователь поставит ffmpeg
# позже, движок должен найти его без перезапуска.
_exe_cache: dict[str, str] = {}


def _cached_executable(key: str, finder):
    """Кэш-обёртка вокруг find_*_executable: положительный результат запоминается."""
    cached = _exe_cache.get(key)
    if cached:
        try:
            if os.path.exists(cached):
                return cached
        except Exception:
            pass
    found = finder()
    if found:
        _exe_cache[key] = found
    return found

def safe_filename(name):
    """Sanitizes a filename."""
    return re.sub(r'[\\/*?:"<>|]', "", name)

def safe_artifact_part(name: str, max_len: int = 90) -> str:
    """Human-friendly filename part that keeps readable unicode text."""
    try:
        value = str(name or "").strip()
    except Exception:
        value = ""

    if not value:
        return "item"

    cleaned = []
    for ch in value:
        if ch in '<>:"/\\|?*\0' or ord(ch) < 32:
            cleaned.append(" ")
        elif ch.isalnum() or ch in (" ", "-", "_", ".", ",", "(", ")", "[", "]", "#"):
            cleaned.append(ch)
        else:
            cleaned.append(" ")

    value = re.sub(r"\s+", " ", "".join(cleaned)).strip().rstrip(" .")
    if not value:
        value = "item"
    if max_len and len(value) > max_len:
        value = value[:max_len].rstrip(" .")
    return value

def url_site_tag(url: str) -> str:
    try:
        host = (urlparse(url or "").netloc or "").lower()
    except Exception:
        host = ""

    if "youtube." in host or "youtu.be" in host:
        return "YT"
    if "vk.com" in host or "vkvideo." in host:
        return "VK"
    if "rutube." in host:
        return "RT"
    if host:
        parts = host.split(":")[0].split(".")
        return parts[-2].upper() if len(parts) >= 2 else host.upper()
    return "URL"

def artifact_label_from_info(info: dict | None, url: str) -> str:
    info = info or {}
    try:
        title = (info.get("title") or "").strip()
        uploader = (
            info.get("uploader")
            or info.get("channel")
            or info.get("uploader_id")
            or ""
        ).strip()
        tag = url_site_tag(url)
        if uploader and title:
            return f"{tag} {uploader} - {title}"
        if uploader:
            return f"{tag} {uploader}"
        if title:
            return f"{tag} {title}"
        return tag
    except Exception:
        return url_site_tag(url)

def unique_path(path: str) -> str:
    """Returns a non-colliding path by appending numeric suffixes."""
    if not path or not os.path.exists(path):
        return path

    base, ext = os.path.splitext(path)
    counter = 1
    candidate = path
    while os.path.exists(candidate):
        candidate = f"{base}_{counter}{ext}"
        counter += 1
    return candidate

def find_soffice_executable() -> str | None:
    """Finds LibreOffice soffice on common system locations (с кэшем)."""
    return _cached_executable("soffice", _find_soffice_uncached)


def _find_soffice_uncached() -> str | None:
    import shutil

    candidates = [
        shutil.which("soffice"),
        shutil.which("soffice.exe"),
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        os.path.expanduser("~/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        "/usr/local/bin/soffice",
        "/opt/homebrew/bin/soffice",
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "LibreOffice", "program", "soffice.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "LibreOffice", "program", "soffice.exe"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None

def find_ffmpeg_executable() -> str | None:
    """Finds ffmpeg binary in common install/runtime locations (с кэшем)."""
    return _cached_executable("ffmpeg", _find_ffmpeg_uncached)


def _find_ffmpeg_uncached() -> str | None:
    import shutil

    def _is_usable(path: str) -> bool:
        if not path or not os.path.exists(path):
            return False
        try:
            result = subprocess.run(
                [path, "-version"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=5,
                **no_window_kwargs(),  # без этого — чёрное окно при каждой пробе
            )
            return result.returncode == 0
        except Exception:
            return False

    candidates = [
        shutil.which("ffmpeg"),
        shutil.which("ffmpeg.exe"),
        os.path.join(runtime_bin_dir(), ffmpeg_binary_name()),
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        r"C:\ffmpeg\bin\ffmpeg.exe",
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "ffmpeg", "bin", "ffmpeg.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "ffmpeg", "bin", "ffmpeg.exe"),
    ]
    for path in candidates:
        if _is_usable(path):
            return path
    return None

def find_ffprobe_executable() -> str | None:
    """Finds ffprobe binary in common install/runtime locations (с кэшем)."""
    return _cached_executable("ffprobe", _find_ffprobe_uncached)


def _find_ffprobe_uncached() -> str | None:
    import shutil

    ffmpeg = find_ffmpeg_executable()
    sibling = os.path.join(os.path.dirname(ffmpeg), ffprobe_binary_name()) if ffmpeg else None
    candidates = [
        sibling,
        shutil.which("ffprobe"),
        shutil.which("ffprobe.exe"),
        os.path.join(runtime_bin_dir(), ffprobe_binary_name()),
        "/opt/homebrew/bin/ffprobe",
        "/usr/local/bin/ffprobe",
        r"C:\ffmpeg\bin\ffprobe.exe",
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "ffmpeg", "bin", "ffprobe.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "ffmpeg", "bin", "ffprobe.exe"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            try:
                result = subprocess.run(
                    [path, "-version"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=5,
                    **no_window_kwargs(),  # без этого — чёрное окно при каждой пробе
                )
                if result.returncode == 0:
                    return path
            except Exception:
                pass
    return None

def find_deno_executable() -> str | None:
    """Finds deno binary — JS-рантайм решателя EJS в yt-dlp (нужен для PO Token).

    В portable-сборке deno лежит РЯДОМ с exe приложения (release.yml, шаг
    «Bundle deno»); yt-dlp ищет его в dirname(sys.executable) и в PATH.
    Здесь тот же порядок (+ venv-пути для dev-режима). С кэшем: проба
    «deno --version» — запуск процесса, при каждом вызове недёшев.
    """
    return _cached_executable("deno", _find_deno_uncached)


def parse_deno_version(output: str) -> str:
    """'deno 2.9.7 (release, x86_64-pc-windows-msvc)' → '2.9.7'.

    Пустая строка — если версию разобрать не удалось.
    """
    try:
        first = (output or "").strip().splitlines()
        if not first:
            return ""
        parts = first[0].strip().split()
        # Ожидаем: ["deno", "2.9.7", "(release, ..."]
        if len(parts) >= 2 and parts[0].lower().startswith("deno"):
            return parts[1]
        return ""
    except Exception:
        return ""


def _deno_binary_works(path: str) -> bool:
    try:
        result = subprocess.run(
            [path, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=4,
            **no_window_kwargs(),  # без этого — чёрное окно при каждой пробе
        )
        return result.returncode == 0 and "deno" in (result.stdout or "").lower()
    except Exception:
        return False


def _find_deno_uncached() -> str | None:
    import shutil
    import sys

    exe_name = "deno.exe" if is_windows() else "deno"
    candidates: list[str | None] = [
        shutil.which("deno"),
        shutil.which(exe_name),
    ]
    try:
        # Корень portable-сборки: рядом с исполняемым файлом приложения
        exe_dir = os.path.dirname(os.path.abspath(sys.executable))
        candidates.append(os.path.join(exe_dir, exe_name))
    except Exception:
        pass
    try:
        # Dev-режим: deno из pip-пакета живёт в venv (Scripts/bin)
        venv_root = os.path.dirname(os.path.dirname(os.path.abspath(sys.executable)))
        candidates.append(os.path.join(venv_root, "Scripts", exe_name))
        candidates.append(os.path.join(venv_root, "bin", exe_name))
    except Exception:
        pass

    for path in candidates:
        if path and os.path.isfile(path) and _deno_binary_works(path):
            return path
    return None


def deno_version(path: str) -> str:
    """Версия deno по пути ('2.9.7') или '' — если определить не удалось."""
    try:
        result = subprocess.run(
            [path, "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=4,
            **no_window_kwargs(),
        )
        return parse_deno_version(result.stdout or "")
    except Exception:
        return ""

def get_audio_duration(file_path: str) -> float | None:
    """Returns media duration in seconds via ffprobe (reliable JSON output).

    Falls back to None if ffprobe is unavailable or the file is unreadable.
    """
    import json

    probe = find_ffprobe_executable()
    if not probe:
        return None
    try:
        result = subprocess.run(
            [
                probe,
                "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "json",
                normalize_path(file_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            **no_window_kwargs(),
        )
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout or "{}")
        duration = float(data.get("format", {}).get("duration", 0) or 0)
        return duration if duration > 0 else None
    except Exception:
        return None

def ensure_dir(path):
    """Ensures a directory exists."""
    os.makedirs(path, exist_ok=True)
    return path

def normalize_path(path):
    """
    Returns absolute path with user expansion.
    Handles potential unicode issues by ensuring absolute path.
    """
    if not path:
        return path
    return os.path.abspath(os.path.expanduser(path))
