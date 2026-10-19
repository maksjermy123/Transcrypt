import torch
import whisper
import logging
import os
from src.utils.fs import find_ffmpeg_executable
from src.utils.runtime import apply_runtime_thread_limits, parse_thread_setting
from src.utils.app_paths import models_dir, runtime_bin_dir
from src.utils.winproc import no_window_kwargs

# NOTE: torch.load monkeypatch (weights_only fix) is applied in src/main.py
# and src/core/whisper_runner.py — no need to duplicate it here.

class WhisperEngine:
    def __init__(self, model_name="base", device="cpu", num_threads="Auto"):
        self.logger = logging.getLogger(__name__)
        self.model_name = model_name
        self.device = device
        self.num_threads = parse_thread_setting(num_threads)
        self.model = None

    def load_model(self, log_callback=None):
        if self.model is None:
            effective_threads = apply_runtime_thread_limits(self.num_threads)
            # Check if model exists in cache
            cache_dir = models_dir()
            os.makedirs(cache_dir, exist_ok=True)

            is_downloading = False
            possible_path = os.path.join(cache_dir, f"{self.model_name}.pt")

            msg_check = f"🔍 Проверка модели '{self.model_name}' в {cache_dir}..."
            self.logger.info(msg_check)
            if log_callback: log_callback(msg_check)
            
            if not os.path.exists(possible_path):
                 msg_dl = f"📥 Модель '{self.model_name}' не найдена в кэше. Начинаю скачивание..."
                 self.logger.info(msg_dl)
                 if log_callback: log_callback(msg_dl)
                 is_downloading = True
            
            msg_load = f"⏳ Загрузка модели Whisper: '{self.model_name}' на устройстве '{self.device}'..."
            self.logger.info(msg_load)
            if log_callback: log_callback(msg_load)
            msg_threads = f"🧵 CPU потоки Whisper: {effective_threads}"
            self.logger.info(msg_threads)
            if log_callback: log_callback(msg_threads)
            
            try:
                # Force download_root to ensure we use the same directory as SettingsTab
                # Scoped SSL relaxation only for the model download call (macOS certs).
                import ssl as _ssl
                _orig = _ssl._create_default_https_context
                _ssl._create_default_https_context = _ssl._create_unverified_context
                try:
                    self.model = whisper.load_model(self.model_name, device=self.device, download_root=cache_dir)
                finally:
                    _ssl._create_default_https_context = _orig
                if is_downloading:
                     msg_ok = f"✅ Модель '{self.model_name}' успешно скачана и загружена из {cache_dir}."
                     self.logger.info(msg_ok)
                     if log_callback: log_callback(msg_ok)
                else:
                     msg_ok = f"✅ Модель '{self.model_name}' успешно загружена из {cache_dir}."
                     self.logger.info(msg_ok)
                     if log_callback: log_callback(msg_ok)
            except Exception as e:
                self.logger.error(f"❌ Ошибка загрузки модели: {e}")
                import traceback
                self.logger.error(traceback.format_exc())
                raise

    def get_audio_duration(self, file_path):
        from src.utils.fs import get_audio_duration as _duration
        return _duration(file_path)

    def transcribe(self, audio_path, language=None, progress_callback=None, log_callback=None, worker_obj=None):
        try:
            from src.utils.fs import normalize_path
            audio_path = normalize_path(audio_path)
            ffmpeg_path = find_ffmpeg_executable()
            if not ffmpeg_path:
                raise RuntimeError(
                    "FFmpeg не найден. Для транскрибации нужен ffmpeg. "
                    f"Установите ffmpeg или добавьте его в PATH/{runtime_bin_dir()}."
                )

            # If we have a worker object, run in a subprocess so STOP can kill immediately.
            if worker_obj is not None:
                return self._transcribe_subprocess(
                    audio_path,
                    language=language,
                    progress_callback=progress_callback,
                    log_callback=log_callback,
                    worker_obj=worker_obj,
                )
            
            self.load_model(log_callback=log_callback)
            self.logger.info(f"🎤 Начало транскрибации: {os.path.basename(audio_path)} (Path: {audio_path})")
            
            if not os.path.exists(audio_path):
                raise FileNotFoundError(f"Audio file not found at: {audio_path}")
                
            options = {"fp16": False}
            if language and language != "auto":
                options["language"] = language
            
            # If progress callback is provided, we need to capture stdout
            if progress_callback:
                duration = self.get_audio_duration(audio_path)
                options["verbose"] = True # Enable verbose to get progress
                
                import sys
                import io
                import re
                
                # Custom stdout to capture progress
                class ProgressCapture(io.StringIO):
                    def __init__(self, callback, total_duration):
                        super().__init__()
                        self.callback = callback
                        self.total_duration = total_duration
                        self.last_percent = 0
                        import time
                        self.start_time = time.time()
                        
                    def write(self, text):
                        # Whisper prints: [00:00.000 --> 00:30.000] Text
                        # We want the second timestamp
                        import time
                        # Support optional hours: "--> 01:23:45.678" or "--> 23:45.678"
                        match = re.search(r"-->\s*(?:(\d+):)?(\d{2}):(\d{2})\.(\d+)", text)
                        if match and self.total_duration:
                            hours = int(match.group(1)) if match.group(1) else 0
                            mins, secs, millis = map(int, match.group(2, 3, 4))
                            
                            frac_len = len(match.group(4))
                            frac_val = millis / (10 ** frac_len)
                            
                            current_seconds = hours * 3600 + mins * 60 + secs + frac_val
                            percent = int((current_seconds / self.total_duration) * 100)
                            
                            elapsed_time = time.time() - self.start_time
                            eta_str = ""
                            if current_seconds > 0 and elapsed_time > 0:
                                speed = current_seconds / elapsed_time
                                remaining_seconds = self.total_duration - current_seconds
                                if speed > 0:
                                    eta_seconds = remaining_seconds / speed
                                    if eta_seconds > 60:
                                        eta_str = f"Осталось: ~{int(eta_seconds//60)} мин. {int(eta_seconds%60)} сек."
                                    else:
                                        eta_str = f"Осталось: ~{int(eta_seconds)} сек."
                            
                            # Only emit if percent changed or we want to update ETA frequently. 
                            # Let's emit whenever we get a new match to keep ETA fresh, 
                            # but UI might flicker. Let's rely on percent change for now, or every 1%.
                            if percent > self.last_percent:
                                self.last_percent = percent
                                # Cap at 99% until done
                                if percent < 100:
                                    try:
                                        self.callback(percent, eta_str)
                                    except TypeError:
                                        self.callback(percent) # Fallback if callback doesn't support 2 args
                        
                        # Also print to real stdout/stderr if needed, or just ignore
                        # sys.__stdout__.write(text) 
                        
                capture = ProgressCapture(progress_callback, duration)
                original_stdout = sys.stdout
                try:
                    sys.stdout = capture
                    result = self.model.transcribe(audio_path, **options)
                finally:
                    sys.stdout = original_stdout
                    
            else:
                result = self.model.transcribe(audio_path, **options)
                
            self.logger.info("✅ Транскрибация завершена успешно.")
            return result
        except Exception as e:
            self.logger.error(f"❌ Ошибка во время транскрибации: {e}")
            import traceback
            self.logger.error(traceback.format_exc())
            raise

    def _transcribe_subprocess(self, audio_path, language=None, progress_callback=None, log_callback=None, worker_obj=None):
        import json
        import subprocess
        import sys
        import tempfile
        import threading

        # Model loading/downloading happens inside the subprocess so STOP can interrupt it.

        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        out_file = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
        out_file.close()

        lang_arg = language if language else "auto"
        device_arg = self.device if self.device else "cpu"
        thread_arg = str(self.num_threads)

        if getattr(sys, "frozen", False):
            cmd = [
                sys.executable,
                "--whisper-runner",
                "--audio",
                audio_path,
                "--model",
                self.model_name,
                "--device",
                device_arg,
                "--threads",
                thread_arg,
                "--language",
                lang_arg,
                "--out",
                out_file.name,
            ]
        else:
            cmd = [
                sys.executable,
                "-m",
                "src.core.whisper_runner",
                "--audio",
                audio_path,
                "--model",
                self.model_name,
                "--device",
                device_arg,
                "--threads",
                thread_arg,
                "--language",
                lang_arg,
                "--out",
                out_file.name,
            ]

        env = os.environ.copy()
        env["PYTHONPATH"] = (env.get("PYTHONPATH", "") + os.pathsep + project_root).strip(os.pathsep)
        # UTF-8 в канале ребёнка: без этого на Windows ребёнок пишет в stderr
        # в CP1251, а родитель читает UTF-8 — кириллица в логах ломается.
        env["PYTHONIOENCODING"] = "utf-8"
        ffmpeg_path = find_ffmpeg_executable()
        if ffmpeg_path:
            env["PATH"] = os.path.dirname(ffmpeg_path) + os.pathsep + env.get("PATH", "")
        for name in (
            "OMP_NUM_THREADS",
            "MKL_NUM_THREADS",
            "OPENBLAS_NUM_THREADS",
            "VECLIB_MAXIMUM_THREADS",
            "NUMEXPR_NUM_THREADS",
        ):
            env[name] = thread_arg

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8", errors="replace",  # без encoding Windows читает CP1251 ('charmap') и падает на кириллице
            cwd=project_root,
            env=env,
            bufsize=1,
            **no_window_kwargs(),  # без окна: иначе на Windows чёрная консоль на всю транскрипцию
        )

        if worker_obj is not None:
            worker_obj.active_process = process

        if log_callback:
            log_callback(
                f"🧵 Whisper subprocess PID={process.pid} | device={device_arg} | threads={thread_arg} | "
                f"OMP={env.get('OMP_NUM_THREADS')} MKL={env.get('MKL_NUM_THREADS')} "
                f"OPENBLAS={env.get('OPENBLAS_NUM_THREADS')} VECLIB={env.get('VECLIB_MAXIMUM_THREADS')}"
            )

        stop_event = threading.Event()

        def stderr_reader():
            try:
                for line in process.stderr:
                    if stop_event.is_set():
                        break
                    line = (line or "").rstrip("\n")
                    if not line:
                        continue
                    if line.startswith("PROGRESS "):
                        # PROGRESS <percent> <eta...>
                        parts = line.split(" ", 2)
                        if len(parts) >= 2 and progress_callback:
                            try:
                                percent = int(parts[1])
                            except Exception:
                                continue
                            eta_str = parts[2] if len(parts) >= 3 else ""
                            try:
                                progress_callback(percent, eta_str)
                            except TypeError:
                                progress_callback(percent)
                        continue
                    if log_callback:
                        log_callback(line)
            except Exception:
                pass

        t = threading.Thread(target=stderr_reader, daemon=True)
        t.start()

        try:
            rc = process.wait()
            stop_event.set()
            try:
                t.join(timeout=0.3)
            except Exception:
                pass

            if worker_obj is not None:
                worker_obj.active_process = None

            if worker_obj is not None and hasattr(worker_obj, "is_stop_requested") and worker_obj.is_stop_requested():
                raise RuntimeError("Транскрибация прервана пользователем")

            if rc != 0:
                raise RuntimeError(f"Whisper subprocess failed (code {rc})")

            with open(out_file.name, "r", encoding="utf-8") as f:
                return json.load(f)
        finally:
            try:
                if worker_obj is not None:
                    worker_obj.active_process = None
            except Exception:
                pass
            try:
                os.remove(out_file.name)
            except Exception:
                pass
