import argparse
import io
import json
import os
import ssl
import sys
import time

import torch
import whisper
from src.utils.fs import find_ffmpeg_executable
from src.utils.runtime import apply_runtime_thread_limits, parse_thread_setting
from src.utils.app_paths import models_dir, runtime_bin_dir

# NOTE: SSL verification stays enabled globally. Whisper model downloads on
# macOS may hit certificate issues; whisper.load_model uses urllib internally,
# so we only relax it for the download call below via a scoped context.


# Monkeypatch torch.load to fix "Weights only load failed" with newer PyTorch
original_load = torch.load


def safe_load(*args, **kwargs):
    if "weights_only" not in kwargs:
        kwargs["weights_only"] = False
    return original_load(*args, **kwargs)


torch.load = safe_load


def _get_audio_duration_seconds(file_path: str) -> float | None:
    from src.utils.fs import get_audio_duration
    return get_audio_duration(file_path)


class _ProgressCapture(io.StringIO):
    def __init__(self, total_duration: float | None):
        super().__init__()
        self.total_duration = total_duration
        self.last_percent = 0
        self.start_time = time.time()

    def write(self, text):
        import re

        if not text:
            return 0
        # Whisper prints: [00:00.000 --> 00:30.000] ...
        match = re.search(r"-->\s*(?:(\d+):)?(\d{2}):(\d{2})\.(\d+)", text)
        if match and self.total_duration:
            hours = int(match.group(1)) if match.group(1) else 0
            mins = int(match.group(2))
            secs = int(match.group(3))
            frac = match.group(4)
            frac_len = len(frac)
            frac_val = int(frac) / (10**frac_len)
            current_seconds = hours * 3600 + mins * 60 + secs + frac_val
            percent = int((current_seconds / self.total_duration) * 100)

            elapsed = time.time() - self.start_time
            eta_str = ""
            if current_seconds > 0 and elapsed > 0:
                speed = current_seconds / elapsed
                remaining = self.total_duration - current_seconds
                if speed > 0:
                    eta_seconds = remaining / speed
                    if eta_seconds > 60:
                        eta_str = f"Осталось: ~{int(eta_seconds//60)} мин. {int(eta_seconds%60)} сек."
                    else:
                        eta_str = f"Осталось: ~{int(eta_seconds)} сек."

            if percent > self.last_percent:
                self.last_percent = percent
                if percent > 99:
                    percent = 99
                sys.__stderr__.write(f"PROGRESS {percent} {eta_str}\n")
                sys.__stderr__.flush()

        return len(text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--threads", default="Auto")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    audio_path = os.path.abspath(os.path.expanduser(args.audio))
    if not os.path.exists(audio_path):
        raise SystemExit(f"Audio not found: {audio_path}")

    ffmpeg_path = find_ffmpeg_executable()
    if not ffmpeg_path:
        raise SystemExit(
            "FFmpeg not found. Install ffmpeg or place it in "
            f"{runtime_bin_dir()}"
        )
    os.environ["PATH"] = os.path.dirname(ffmpeg_path) + os.pathsep + os.environ.get("PATH", "")

    cache_dir = models_dir()
    os.makedirs(cache_dir, exist_ok=True)
    effective_threads = apply_runtime_thread_limits(parse_thread_setting(args.threads))

    sys.__stderr__.write(
        f"⏳ Whisper subprocess: loading model '{args.model}' (threads={effective_threads})...\n"
    )
    sys.__stderr__.flush()
    sys.__stderr__.write(
        f"🧵 Runtime thread limits | pid={os.getpid()} | "
        f"OMP={os.environ.get('OMP_NUM_THREADS')} | "
        f"MKL={os.environ.get('MKL_NUM_THREADS')} | "
        f"OPENBLAS={os.environ.get('OPENBLAS_NUM_THREADS')} | "
        f"VECLIB={os.environ.get('VECLIB_MAXIMUM_THREADS')} | "
        f"NUMEXPR={os.environ.get('NUMEXPR_NUM_THREADS')}\n"
    )
    sys.__stderr__.flush()
    # Scoped SSL relaxation: only during model download (whisper uses urllib,
    # which fails on macOS with missing certs). Restored right after.
    _orig_https = ssl._create_default_https_context
    ssl._create_default_https_context = ssl._create_unverified_context
    try:
        model = whisper.load_model(args.model, device=args.device, download_root=cache_dir)
    finally:
        ssl._create_default_https_context = _orig_https

    options = {"fp16": False}
    if args.language and args.language != "auto":
        options["language"] = args.language

    duration = _get_audio_duration_seconds(audio_path)
    options["verbose"] = True

    capture = _ProgressCapture(duration)
    original_stdout = sys.stdout
    try:
        sys.stdout = capture
        result = model.transcribe(audio_path, **options)
    finally:
        sys.stdout = original_stdout

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    sys.__stderr__.write("PROGRESS 99 Завершение...\n")
    sys.__stderr__.flush()


if __name__ == "__main__":
    main()
