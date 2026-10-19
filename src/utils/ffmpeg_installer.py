import argparse
import os
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

from src.utils.app_paths import ffmpeg_binary_name, ffprobe_binary_name, is_macos, runtime_bin_dir
from src.utils.fs import find_ffmpeg_executable, find_ffprobe_executable
from src.utils.winproc import no_window_kwargs

APP_NAME = "VoxPaperAi"
INTEL_FFMPEG_URL = "https://evermeet.cx/ffmpeg/getrelease/zip"
INTEL_FFPROBE_URL = "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"
ARM64_FFMPEG_URL = "https://www.osxexperts.net/ffmpeg81arm.zip"
ARM64_FFPROBE_URL = "https://www.osxexperts.net/ffprobe81arm.zip"


def get_runtime_bin_dir() -> str:
    return runtime_bin_dir()


def _download_file(url: str, dest: str):
    # Use the default verified SSL context. The old unverified context exposed
    # the binary download to MITM; keep verification on like everywhere else.
    with urllib.request.urlopen(url) as response:
        with open(dest, "wb") as f:
            while True:
                chunk = response.read(8192)
                if not chunk:
                    break
                f.write(chunk)


def _find_ffmpeg_member(zf: zipfile.ZipFile) -> str | None:
    for name in zf.namelist():
        normalized = name.rstrip("/")
        if normalized.endswith("/ffmpeg") or normalized == "ffmpeg":
            return name
    return None


def _find_binary_member(zf: zipfile.ZipFile, binary_name: str) -> str | None:
    for name in zf.namelist():
        normalized = name.rstrip("/")
        if normalized.endswith(f"/{binary_name}") or normalized == binary_name:
            return name
    return None


def _is_usable_binary(path: str) -> bool:
    if not path or not os.path.exists(path):
        return False
    try:
        result = subprocess.run(
            [path, "-version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8", errors="replace",  # без encoding Windows читает CP1251 ('charmap')
            timeout=5,
            **no_window_kwargs(),
        )
        return result.returncode == 0
    except Exception:
        return False


def _select_binary_urls() -> tuple[str, str]:
    if not is_macos():
        raise RuntimeError(
            "Автозагрузка FFmpeg сейчас подготовлена только для macOS. "
            "Для Windows сборки ffmpeg.exe и ffprobe.exe должны быть включены в пакет заранее."
        )
    machine = (os.uname().machine or "").lower()
    if machine == "arm64":
        return ARM64_FFMPEG_URL, ARM64_FFPROBE_URL
    return INTEL_FFMPEG_URL, INTEL_FFPROBE_URL


def _install_binary(binary_name: str, url: str, runtime_bin: str, status_callback=None) -> str:
    if status_callback:
        status_callback(f"Downloading {binary_name} runtime...")

    with tempfile.TemporaryDirectory(prefix=f"voxpaperai-{binary_name}-") as tmp_dir:
        archive_path = os.path.join(tmp_dir, f"{binary_name}.zip")
        _download_file(url, archive_path)

        if status_callback:
            status_callback(f"Extracting {binary_name}...")

        with zipfile.ZipFile(archive_path, "r") as zf:
            member = _find_binary_member(zf, binary_name)
            if not member:
                raise RuntimeError(f"{binary_name} archive format is unexpected: executable not found")
            extracted_path = zf.extract(member, tmp_dir)

        final_path = os.path.join(runtime_bin, binary_name)
        os.replace(extracted_path, final_path)
        current_mode = os.stat(final_path).st_mode
        os.chmod(final_path, current_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        # Apple Silicon may require ad-hoc signing for downloaded binaries.
        try:
            subprocess.run(["xattr", "-cr", final_path], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **no_window_kwargs())
            subprocess.run(["codesign", "-s", "-", final_path], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **no_window_kwargs())
        except Exception:
            pass

    if not _is_usable_binary(final_path):
        raise RuntimeError(f"Installed {binary_name} is not executable on this Mac: {final_path}")
    return final_path


def install_ffmpeg(status_callback=None) -> str:
    existing = find_ffmpeg_executable()
    existing_probe = find_ffprobe_executable()
    if existing and existing_probe:
        if status_callback:
            status_callback(f"FFmpeg already available: {existing}")
        return existing

    runtime_bin = get_runtime_bin_dir()
    os.makedirs(runtime_bin, exist_ok=True)
    ffmpeg_url, ffprobe_url = _select_binary_urls()

    final_ffmpeg = _install_binary(ffmpeg_binary_name().replace(".exe", ""), ffmpeg_url, runtime_bin, status_callback=status_callback)
    final_ffprobe = _install_binary(ffprobe_binary_name().replace(".exe", ""), ffprobe_url, runtime_bin, status_callback=status_callback)

    if status_callback:
        status_callback(f"FFmpeg installed to: {final_ffmpeg}")
        status_callback(f"FFprobe installed to: {final_ffprobe}")
    return final_ffmpeg


def ensure_ffmpeg(status_callback=None) -> str:
    existing = find_ffmpeg_executable()
    if existing:
        if status_callback:
            status_callback(f"FFmpeg found: {existing}")
        return existing
    return install_ffmpeg(status_callback=status_callback)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ensure", action="store_true")
    args = parser.parse_args()

    if not args.ensure:
        parser.print_help()
        return 0

    def _status(msg: str):
        print(msg, flush=True)

    path = ensure_ffmpeg(status_callback=_status)
    print(path, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
