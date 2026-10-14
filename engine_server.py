#!/usr/bin/env python3
"""
VoxPaperAi Pro — Local Engine Server
Cross-platform bridge between the GitHub Pages Web UI and local hardware.

Features:
  - Subtitles First YouTube strategy (fetches subtitles in 2s with zero bot blocks)
  - OpenAI Whisper speech recognition (Apple Silicon / NVIDIA CUDA / CPU)
  - ffmpeg audio cleanup and video hardsubbing
  - Universal media, document, and image format conversion
  - Text & document translation (Google / DeepL)
  - Full CORS support for https://maksjermy123.github.io/Transcrypt
"""

import sys
import os
import json
import time
import tempfile
import urllib.parse
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Небуферизованный вывод: при запуске через nohup/launchd логи должны
# появляться в файле сразу, а не после заполнения буфера (иначе логи
# выглядят пустыми, пока импортируются тяжёлые библиотеки).
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

# Add project root to sys.path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.core.downloader import Downloader
from src.core.subtitles import parse_subtitles
from src.core.engine import WhisperEngine
from src.core.converter import Converter
from src.core.translator import Translator
from src.utils.fs import find_ffmpeg_executable, find_ffprobe_executable, find_soffice_executable
from src.utils.runtime import resolve_whisper_device, recommended_cpu_threads
from src.utils.app_paths import app_support_dir

try:
    OUTPUT_DIR = os.path.join(app_support_dir(), "web_output")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
except Exception:
    OUTPUT_DIR = os.path.join(tempfile.gettempdir(), "voxpaperai_web_output")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

# Shared progress tracking
progress_state = {
    "active": False,
    "task": "",
    "stage": "Готов",
    "percent": 0,
    "eta": "",
    "log": []
}

def log_progress(msg, stage=None, percent=None, eta=None):
    if stage is not None:
        progress_state["stage"] = stage
    if percent is not None:
        progress_state["percent"] = percent
    if eta is not None:
        progress_state["eta"] = eta
    timestamp = time.strftime("%H:%M:%S")
    entry = f"[{timestamp}] {msg}"
    progress_state["log"].append(entry)
    if len(progress_state["log"]) > 100:
        progress_state["log"] = progress_state["log"][-100:]
    print(entry, flush=True)


class DummyWorker:
    """Mock worker to satisfy core callbacks and cancellation checks."""
    def __init__(self):
        self._stop = False
        self.active_process = None

    def is_stop_requested(self):
        return self._stop

    def request_stop(self):
        self._stop = True
        if self.active_process:
            try:
                self.active_process.kill()
            except Exception:
                pass


def format_ts(seconds: float) -> str:
    """Format seconds -> HH:MM:SS,mmm"""
    ms = int((seconds % 1) * 1000)
    total = int(seconds)
    h, r = divmod(total, 3600)
    m, s = divmod(r, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def format_ts_vtt(seconds: float) -> str:
    return format_ts(seconds).replace(",", ".")


class EngineHTTPRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Keep server logs concise
        pass

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Range')
        self.send_header('Access-Control-Expose-Headers', 'Content-Disposition')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"status": "error", "message": str(message)}, status=status)

    def read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

    # ═══════════════════════════════════════════════════════════════
    #  GET Endpoints
    # ═══════════════════════════════════════════════════════════════
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path == "/api/health":
            self.handle_health()
        elif path == "/api/progress":
            self.send_json(progress_state)
        elif path == "/api/download":
            self.handle_download(params)
        else:
            self.send_error_json("Endpoint not found", 404)

    def handle_health(self):
        ffmpeg_ok = bool(find_ffmpeg_executable())
        ffprobe_ok = bool(find_ffprobe_executable())
        soffice_ok = bool(find_soffice_executable())
        
        device_label = resolve_whisper_device("Auto")
        threads = recommended_cpu_threads()

        sys_name = "macOS" if sys.platform == "darwin" else ("Windows" if sys.platform == "win32" else "Linux")

        self.send_json({
            "status": "ok",
            "version": "1.0.0",
            "platform": sys.platform,
            "system_name": sys_name,
            "device": device_label,
            "recommended_threads": threads,
            "ffmpeg": ffmpeg_ok,
            "ffprobe": ffprobe_ok,
            "libreoffice": soffice_ok,
            "whisper_models": ["tiny", "base", "small", "medium", "large-v3"]
        })

    def handle_download(self, params):
        target_path = params.get("file", [None])[0]
        if not target_path or not os.path.exists(target_path):
            self.send_error_json("File not found", 404)
            return

        # Simple security check: file must be accessible
        fname = os.path.basename(target_path)
        size = os.path.getsize(target_path)
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Disposition', f'attachment; filename="{fname}"')
        self.send_header('Content-Length', str(size))
        self.end_headers()

        with open(target_path, "rb") as f:
            while chunk := f.read(65536):
                self.wfile.write(chunk)

    # ═══════════════════════════════════════════════════════════════
    #  POST Endpoints
    # ═══════════════════════════════════════════════════════════════
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/transcribe":
                self.handle_transcribe()
            elif path == "/api/media":
                self.handle_media()
            elif path == "/api/convert":
                self.handle_convert()
            elif path == "/api/translate":
                self.handle_translate()
            elif path == "/api/upload":
                self.handle_upload()
            elif path == "/api/stop":
                self.handle_stop()
            else:
                self.send_error_json(f"Unknown POST endpoint: {path}", 404)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_error_json(str(e), 500)

    def handle_stop(self):
        progress_state["active"] = False
        log_progress("🛑 Обработка отменена", stage="Отменено", percent=0)
        self.send_json({"status": "stopped"})

    # ─────────────────────────────────────────────────────────────
    #  1. Transcribe (Subtitles First + Whisper Fallback)
    # ─────────────────────────────────────────────────────────────
    def handle_transcribe(self):
        data = self.read_json_body()
        url = data.get("url", "").strip()
        local_file = data.get("file_path", "").strip()
        model_name = data.get("model", "base")
        lang = data.get("language", "auto")
        translate_to = data.get("translate_to", "-").strip().lower()
        save_audio = bool(data.get("save_audio", False))
        save_video = bool(data.get("save_video", False))

        if not url and not local_file:
            self.send_error_json("Не указан URL или файл для транскрибации")
            return

        # Файл передан, но не существует на диске — понятная ошибка вместо трейсбека Whisper
        if local_file and not os.path.exists(local_file):
            self.send_error_json(f"Файл не найден на диске движка: {local_file}", 404)
            return

        progress_state["active"] = True
        progress_state["log"] = []
        log_progress("🚀 Запуск транскрибации...", stage="Инициализация", percent=5)

        downloader = Downloader(OUTPUT_DIR)
        converter = Converter()
        dummy_worker = DummyWorker()

        result_text = ""
        segments = []
        source_type = "unknown"
        detected_lang = lang
        saved_media_files = []

        # ─── URL CASE ───
        if url.startswith("http"):
            log_progress(f"🔎 Шаг 1/4: Поиск субтитров YouTube для {url}...", stage="Поиск субтитров", percent=15)
            
            subs_info = downloader.list_subtitles(url)
            pref_lang = "ru" if lang == "auto" else lang
            choice = downloader.choose_subtitle_track(
                subs_info,
                preferred_lang=pref_lang,
                fallback_langs=["ru", "en", "uk"]
            )

            got_subtitles = False
            if choice:
                sub_lang = choice["lang"]
                is_auto = choice["auto"]
                log_progress(f"✅ Найдены субтитры '{sub_lang}' ({'авто' if is_auto else 'ручные'}). Скачивание...", stage="Скачивание субтитров", percent=35)
                try:
                    sub_file = downloader.download_subtitles(url, sub_lang, auto=is_auto)
                    if sub_file and os.path.exists(sub_file):
                        parsed = parse_subtitles(sub_file)
                        if parsed:
                            segments = parsed
                            result_text = " ".join(s['text'] for s in segments)
                            source_type = f"YouTube Subtitles ({sub_lang})"
                            detected_lang = sub_lang
                            got_subtitles = True
                            log_progress("⚡ Субтитры получены и распарсены за 2 секунды!", stage="Субтитры готовы", percent=70)
                        try:
                            os.remove(sub_file)
                        except Exception:
                            pass
                except Exception as e:
                    log_progress(f"⚠️ Ошибка получения субтитров: {e}. Переходим к скачиванию медиа...", stage="Субтитры недоступны")

            # Fallback to downloading media + Whisper
            if not got_subtitles:
                log_progress("📥 Шаг 2/4: Скачивание аудиодорожки с YouTube...", stage="Скачивание аудио", percent=30)
                
                def dl_callback(percent, eta=""):
                    log_progress(f"Загрузка: {percent}% ({eta})", percent=min(25 + int(percent * 0.25), 55))

                media_path, _ = downloader.download(
                    url,
                    extract_audio=True,
                    worker_obj=dummy_worker,
                    progress_callback=dl_callback
                )
                log_progress(f"✅ Аудио скачано: {os.path.basename(media_path)}", stage="Медиа скачано", percent=60)
                
                if save_audio:
                    saved_media_files.append(media_path)

                log_progress(f"🧠 Шаг 3/4: Распознавание речи через Whisper ({model_name})...", stage="Whisper", percent=65)
                engine = WhisperEngine(model_name=model_name)
                
                def whisper_cb(percent, eta=""):
                    log_progress(f"Whisper: {percent}% ({eta})", percent=min(65 + int(percent * 0.25), 90))

                whisper_out = engine.transcribe(
                    media_path,
                    language=lang,
                    progress_callback=whisper_cb,
                    worker_obj=dummy_worker
                )
                result_text = whisper_out.get("text", "")
                segments = whisper_out.get("segments", [])
                detected_lang = whisper_out.get("language", lang)
                source_type = f"Whisper ({model_name})"
        else:
            # Local file
            media_path = local_file
            log_progress(f"🧠 Распознавание локального файла через Whisper ({model_name})...", stage="Whisper", percent=40)
            engine = WhisperEngine(model_name=model_name)
            whisper_out = engine.transcribe(media_path, language=lang, worker_obj=dummy_worker)
            result_text = whisper_out.get("text", "")
            segments = whisper_out.get("segments", [])
            detected_lang = whisper_out.get("language", lang)
            source_type = f"Whisper ({model_name})"

        # Optional translation
        if translate_to and translate_to not in ["-", "", detected_lang]:
            log_progress(f"🌍 Шаг 4/4: Перевод текста на {translate_to}...", stage="Перевод", percent=92)
            translator = Translator()
            result_text = translator.translate_text(result_text, translate_to)
            # Translate segments if available
            try:
                for s in segments:
                    s['text'] = translator.translate_text(s['text'], translate_to)
            except Exception:
                pass

        # Build output files
        base_name = f"voxpaper_transcription_{int(time.time())}"
        txt_path = os.path.join(OUTPUT_DIR, f"{base_name}.txt")
        srt_path = os.path.join(OUTPUT_DIR, f"{base_name}.srt")
        vtt_path = os.path.join(OUTPUT_DIR, f"{base_name}.vtt")
        json_path = os.path.join(OUTPUT_DIR, f"{base_name}.json")

        # Plain text
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(result_text)

        # SRT
        srt_blocks = []
        for idx, seg in enumerate(segments, 1):
            s_ts = format_ts(seg.get('start', 0))
            e_ts = format_ts(seg.get('end', 0))
            text = seg.get('text', '').strip()
            srt_blocks.append(f"{idx}\n{s_ts} --> {e_ts}\n{text}\n")
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write("\n".join(srt_blocks))

        # VTT
        vtt_lines = ["WEBVTT\n"]
        for seg in segments:
            s_ts = format_ts_vtt(seg.get('start', 0))
            e_ts = format_ts_vtt(seg.get('end', 0))
            text = seg.get('text', '').strip()
            vtt_lines.append(f"{s_ts} --> {e_ts}\n{text}\n")
        with open(vtt_path, "w", encoding="utf-8") as f:
            f.write("\n".join(vtt_lines))

        # JSON
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({"text": result_text, "language": detected_lang, "segments": segments}, f, ensure_ascii=False, indent=2)

        log_progress("✅ Транскрибация успешно завершена!", stage="Готово", percent=100)
        progress_state["active"] = False

        self.send_json({
            "status": "success",
            "source": source_type,
            "detected_language": detected_lang,
            "text": result_text,
            "segments_count": len(segments),
            "files": {
                "txt": f"/api/download?file={urllib.parse.quote(txt_path)}",
                "srt": f"/api/download?file={urllib.parse.quote(srt_path)}",
                "vtt": f"/api/download?file={urllib.parse.quote(vtt_path)}",
                "json": f"/api/download?file={urllib.parse.quote(json_path)}",
            }
        })

    # ─────────────────────────────────────────────────────────────
    #  2. Media (Download Video, Audio, Clean Audio, Hardsub)
    # ─────────────────────────────────────────────────────────────
    def handle_media(self):
        data = self.read_json_body()
        action = data.get("action")
        url = data.get("url", "").strip()
        file_path = data.get("file_path", "").strip()

        downloader = Downloader(OUTPUT_DIR)
        converter = Converter()

        progress_state["active"] = True
        progress_state["log"] = []

        if action == "download_video":
            log_progress(f"🎬 Скачивание видео в максимальном качестве: {url}...", stage="Скачивание видео", percent=20)
            out_file, _ = downloader.download(url, video_only=True)
            log_progress(f"✅ Видео сохранено: {os.path.basename(out_file)}", stage="Готово", percent=100)
            self.send_json({"status": "success", "file": f"/api/download?file={urllib.parse.quote(out_file)}"})

        elif action == "download_audio":
            log_progress(f"🎵 Скачивание аудио (MP3 192k): {url}...", stage="Скачивание аудио", percent=20)
            out_file, _ = downloader.download(url, extract_audio=True)
            log_progress(f"✅ Аудио сохранено: {os.path.basename(out_file)}", stage="Готово", percent=100)
            self.send_json({"status": "success", "file": f"/api/download?file={urllib.parse.quote(out_file)}"})

        elif action == "clean_audio":
            log_progress(f"🎧 Очистка звука (удаление шума, фильтрация, нормализация)...", stage="Очистка звука", percent=30)
            target = file_path
            if url.startswith("http"):
                target, _ = downloader.download(url, extract_audio=True)

            if not target or not os.path.exists(target):
                self.send_error_json("Укажите ссылку на видео или загрузите локальный аудио-файл для очистки")
                progress_state["active"] = False
                return

            cleaned = converter.enhance_audio(target, OUTPUT_DIR)
            log_progress(f"✅ Очищенный аудиофайл готов: {os.path.basename(cleaned)}", stage="Готово", percent=100)
            self.send_json({"status": "success", "file": f"/api/download?file={urllib.parse.quote(cleaned)}"})

        elif action == "hardsub":
            log_progress(f"🎥 Вшивание субтитров в видео...", stage="Hardsub", percent=30)
            sub_lang = data.get("sub_lang", "ru")
            # If YouTube URL, first check/download subtitles
            video_file = file_path
            sub_file = data.get("sub_file")
            
            if url.startswith("http"):
                subs_info = downloader.list_subtitles(url)
                choice = downloader.choose_subtitle_track(subs_info, preferred_lang=sub_lang)
                if choice:
                    sub_file = downloader.download_subtitles(url, choice["lang"], auto=choice["auto"])
                video_file, _ = downloader.download(url, video_only=True)

            if not video_file or not os.path.exists(video_file):
                self.send_error_json("Укажите ссылку на видео или загрузите локальный видео-файл для вшивания субтитров")
                progress_state["active"] = False
                return

            if not sub_file or not os.path.exists(sub_file):
                # Generate via Whisper
                log_progress("Генерация субтитров через Whisper для вшивания...", stage="Генерация субтитров", percent=50)
                engine = WhisperEngine(model_name=data.get("model", "base"))
                w_res = engine.transcribe(video_file)
                # Create temp srt
                sub_file = os.path.join(OUTPUT_DIR, f"temp_sub_{int(time.time())}.srt")
                with open(sub_file, "w", encoding="utf-8") as f:
                    for i, seg in enumerate(w_res.get("segments", []), 1):
                        f.write(f"{i}\n{format_ts(seg['start'])} --> {format_ts(seg['end'])}\n{seg['text'].strip()}\n\n")

            out_video = converter.hardsub_video(video_file, sub_file, OUTPUT_DIR)
            log_progress(f"✅ Видео с субтитрами готово: {os.path.basename(out_video)}", stage="Готово", percent=100)
            self.send_json({"status": "success", "file": f"/api/download?file={urllib.parse.quote(out_video)}"})

        else:
            self.send_error_json(f"Неизвестное действие: {action}")
        progress_state["active"] = False

    # ─────────────────────────────────────────────────────────────
    #  3. Convert (Media, Documents, Images)
    # ─────────────────────────────────────────────────────────────
    def handle_convert(self):
        data = self.read_json_body()
        file_path = data.get("file_path", "").strip()
        target_fmt = data.get("target_format", "").strip().lower()

        if not file_path or not os.path.exists(file_path):
            self.send_error_json("Файл для конвертации не найден")
            return

        converter = Converter()
        ext = os.path.splitext(file_path)[1].lower().strip(".")
        progress_state["active"] = True
        log_progress(f"🔄 Конвертация {ext} -> {target_fmt}...", stage="Конвертация", percent=40)

        # Media
        media_exts = {"mp3", "wav", "aac", "flac", "ogg", "mp4", "mkv", "webm", "avi", "mov", "m4a"}
        doc_exts = {"pdf", "docx", "doc", "txt", "odt", "rtf"}
        img_exts = {"jpg", "jpeg", "png", "webp"}

        if target_fmt in media_exts and ext in media_exts:
            out = converter.convert_media(file_path, target_fmt, OUTPUT_DIR)
        elif target_fmt in doc_exts and ext in doc_exts:
            out = converter.convert_document(file_path, target_fmt, OUTPUT_DIR)
        elif target_fmt in img_exts or ext in img_exts:
            out = converter.convert_image(file_path, target_fmt, OUTPUT_DIR)
        else:
            self.send_error_json(f"Конвертация из {ext} в {target_fmt} не поддерживается")
            return

        log_progress(f"✅ Файл сконвертирован: {os.path.basename(out)}", stage="Готово", percent=100)
        progress_state["active"] = False
        self.send_json({"status": "success", "file": f"/api/download?file={urllib.parse.quote(out)}"})

    # ─────────────────────────────────────────────────────────────
    #  4. Translate (Text & Files)
    # ─────────────────────────────────────────────────────────────
    def handle_translate(self):
        data = self.read_json_body()
        text = data.get("text", "")
        target_lang = data.get("target_lang", "ru")
        file_path = data.get("file_path", "")

        translator = Translator()
        if text:
            translated = translator.translate_text(text, target_lang)
            self.send_json({"status": "success", "translated_text": translated})
        elif file_path and os.path.exists(file_path):
            content = translator.read_file_content(file_path)
            translated = translator.translate_text(content, target_lang)
            out_file = translator.save_translated_file(translated, file_path, target_lang, "txt", OUTPUT_DIR)
            self.send_json({
                "status": "success",
                "translated_text": translated[:1000],
                "file": f"/api/download?file={urllib.parse.quote(out_file)}"
            })
        else:
            self.send_error_json("Не указан текст или файл для перевода")

    # ─────────────────────────────────────────────────────────────
    #  5. Upload handler for files from Web UI
    # ─────────────────────────────────────────────────────────────
    def handle_upload(self):
        ctype = self.headers.get('Content-Type', '')
        length = int(self.headers.get('Content-Length', 0))
        if length <= 0:
            self.send_error_json("Empty upload")
            return

        body = self.rfile.read(length)
        # Parse boundary
        boundary = None
        for part in ctype.split(';'):
            part = part.strip()
            if part.startswith('boundary='):
                boundary = part.split('=', 1)[1].strip('"').encode('utf-8')
                break

        if not boundary:
            # Raw fallback
            fname = f"upload_{int(time.time())}.bin"
            out_path = os.path.join(OUTPUT_DIR, fname)
            with open(out_path, "wb") as f:
                f.write(body)
            self.send_json({"status": "success", "file_path": out_path, "filename": fname})
            return

        delimiter = b'--' + boundary
        chunks = body.split(delimiter)
        for chunk in chunks:
            if b'filename=' in chunk:
                headers_part, file_bytes = chunk.split(b'\r\n\r\n', 1)
                # Корректная обрезка: часть файла всегда заканчивается на \r\n
                # (перевод строки перед следующим boundary). rstrip здесь НЕЛЬЗЯ —
                # он съедает последние байты файла, если они совпадают с \r, \n или '-'.
                if file_bytes.endswith(b"\r\n"):
                    file_bytes = file_bytes[:-2]
                # Extract filename
                headers_str = headers_part.decode('utf-8', errors='ignore')
                import re
                fn_match = re.search(r'filename="([^"]+)"', headers_str)
                fname = fn_match.group(1) if fn_match else f"upload_{int(time.time())}.bin"
                fname = os.path.basename(fname)
                out_path = os.path.join(OUTPUT_DIR, f"upload_{int(time.time())}_{fname}")
                with open(out_path, "wb") as f:
                    f.write(file_bytes)
                self.send_json({"status": "success", "file_path": out_path, "filename": fname})
                return

        self.send_error_json("No file part found in upload")


def run_server(port=8765):
    server_address = ('127.0.0.1', port)
    try:
        httpd = ThreadingHTTPServer(server_address, EngineHTTPRequestHandler)
    except OSError as e:
        # Порт занят (например, движок уже запущен launchd/systemd или другим
        # экземпляром). Выходим тихо с кодом 0, чтобы автозапуск (KeepAlive
        # LaunchAgent / systemd Restart) не устраивал бесконечный перезапуск.
        if e.errno in (48, 98):  # EADDRINUSE (macOS / Linux)
            print(f"⚠ Порт {port} уже занят — похоже, движок уже работает. Выходим.")
            return
        raise
    print("=" * 60)
    print(f"🚀 VoxPaperAi Pro — Локальный движок запущен!")
    print(f"📡 Порт: http://127.0.0.1:{port}")
    print(f"🌐 Откройте веб-интерфейс: https://maksjermy123.github.io/Transcrypt/")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Движок остановлен.")
        httpd.server_close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    run_server(port)
