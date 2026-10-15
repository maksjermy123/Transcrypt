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
import uuid
import threading
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


# ═══════════════════════════════════════════════════════════════
#  Фоновые задачи (Job API, движок >= 1.1.0; очередь — >= 1.2.0)
#
#  Задача выполняется в отдельном потоке и переживает закрытие
#  вкладки браузера: клиент создаёт задачу (POST /api/jobs),
#  получает job_id и опрашивает состояние (GET /api/jobs/<id>).
#  Журнал задач сохраняется на диск — результаты не пропадают
#  даже после перезапуска движка.
#
#  Многозадачность (>= 1.2.0): задачи делятся на полосы.
#   - heavy: транскрипция, конвертация, clean_audio, hardsub —
#     до HEAVY_PARALLEL одновременно (1 на слабых машинах, 2 на мощных).
#   - light: скачивание видео/аудио (yt-dlp, упор в сеть) —
#     до 2 одновременно и независимо от heavy.
#  Лишние задачи стоят в очереди (status "queued") и стартуют
#  автоматически, когда освободится полоса.
# ═══════════════════════════════════════════════════════════════

CPU_THREADS = os.cpu_count() or 4
HEAVY_PARALLEL = max(1, min(2, CPU_THREADS // 4))  # 4 ядра → 1, 8+ → 2
LIGHT_PARALLEL = 2  # сетевые задачи почти не грузят CPU

HEAVY_SEM = threading.BoundedSemaphore(HEAVY_PARALLEL)
LIGHT_SEM = threading.BoundedSemaphore(LIGHT_PARALLEL)

_LANE_SEMS = {"heavy": HEAVY_SEM, "light": LIGHT_SEM}


def job_lane(jtype: str, params: dict) -> str:
    """Полоса исполнения задачи: network-bound скачивания — light, остальное — heavy."""
    if jtype == "media" and (params or {}).get("action") in ("download_video", "download_audio"):
        return "light"
    return "heavy"


JOBS = {}                      # job_id -> job dict
JOBS_LOCK = threading.Lock()
JOBS_FILE = os.path.join(OUTPUT_DIR, "jobs.json")
JOBS_MAX = 30
CURRENT_JOB = {"id": None, "worker": None}


def _job_snapshot(job):
    """Копия задачи для отдачи клиенту и сохранения на диск (без служебных полей)."""
    snap = {
        "job_id": job["id"],
        "type": job["type"],
        "status": job["status"],
        "progress": job.get("progress") or {},
        "result": job.get("result"),
        "error": job.get("error"),
        "label": job.get("label", ""),
        "created_at": job.get("created_at"),
        "finished_at": job.get("finished_at"),
        "lane": job.get("lane", "heavy"),
    }
    qp = _queue_position(job)
    if qp is not None:
        snap["queue_position"] = qp
    return snap


def _queue_position(job):
    """Позиция в очереди своей полосы (None — если задача не в очереди).

    Внимание: вызывается из _job_snapshot, который уже часто выполняется
    под JOBS_LOCK — поэтому лок здесь брать НЕЛЬЗЯ (дедлок, Lock не реентерабельный).
    list(JOBS.values()) атомарен под GIL — чтение безопасно.
    """
    if job.get("status") != "queued":
        return None
    lane = job.get("lane", "heavy")
    mine = job.get("created_at", 0)
    try:
        ahead = sum(
            1
            for j in list(JOBS.values())
            if j.get("lane", "heavy") == lane
            and j.get("status") in ("queued", "running")
            and j.get("created_at", 0) < mine
        )
    except Exception:
        return None
    return ahead + 1


def _save_jobs():
    try:
        with JOBS_LOCK:
            snap = {jid: _job_snapshot(j) for jid, j in JOBS.items()}
        with open(JOBS_FILE, "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False)
    except Exception as e:
        print(f"⚠ Не удалось сохранить журнал задач: {e}")


def _load_jobs():
    """Восстановить журнал после перезапуска. Незавершённые задачи помечаем ошибкой."""
    try:
        if not os.path.exists(JOBS_FILE):
            return
        with open(JOBS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
        for jid, j in data.items():
            if j.get("status") in ("running", "queued"):
                j["status"] = "error"
                j["error"] = "Движок был перезапущен во время выполнения задачи"
            j["progress"] = j.get("progress") or {
                "active": False, "task": j.get("type", ""),
                "stage": "Завершено",
                "percent": 100 if j.get("status") == "done" else 0,
                "eta": "", "log": [],
            }
            JOBS[jid] = j
    except Exception as e:
        print(f"⚠ Не удалось прочитать журнал задач: {e}")


def _prune_jobs():
    if len(JOBS) <= JOBS_MAX:
        return
    items = sorted(JOBS.items(), key=lambda kv: kv[1].get("created_at", 0))
    for jid, _ in items[: len(JOBS) - JOBS_MAX]:
        JOBS.pop(jid, None)


def make_job_logger(job):
    """Логгер конкретной задачи: пишет в её прогресс и зеркалит в глобальный
    progress_state, чтобы legacy-клиенты (/api/progress) тоже видели активность."""
    def log(msg, stage=None, percent=None, eta=None):
        jp = job.setdefault("progress", {"active": True, "task": job["type"], "stage": "", "percent": 0, "eta": "", "log": []})
        if stage is not None:
            jp["stage"] = stage
        if percent is not None:
            jp["percent"] = percent
        if eta is not None:
            jp["eta"] = eta
        jp["active"] = job["status"] in ("queued", "running")
        ts = time.strftime("%H:%M:%S")
        entry = f"[{ts}] {msg}"
        jp["log"] = (jp.get("log") or [])[-99:] + [entry]
        # Зеркало в глобальный прогресс
        progress_state["active"] = True
        progress_state["task"] = job["type"]
        progress_state["stage"] = jp["stage"]
        progress_state["percent"] = jp["percent"]
        progress_state["eta"] = jp["eta"]
        progress_state["log"] = (progress_state["log"][-99:] + [entry])[-100:]
        print(entry, flush=True)
    return log


def run_job(job):
    """Фоновый поток задачи: ждёт свободный слот своей полосы, выполняет, пишет результат.

    Пока ждём — статус остаётся "queued" (клиент показывает «В очереди»).
    """
    log = make_job_logger(job)
    lane = job.get("lane", "heavy")
    sem = _LANE_SEMS.get(lane, HEAVY_SEM)
    try:
        # Пытаемся занять слот сразу; если занято — честно показываем очередь
        if not sem.acquire(timeout=0.3):
            job["queued_at"] = time.time()
            log(
                f"⏳ Движок занят другой задачей — '{job['type']}' ожидает в очереди",
                stage="В очереди",
                percent=0,
            )
            sem.acquire()  # ждём своей очереди
        try:
            if job["status"] == "cancelled" or job["worker"].is_stop_requested():
                # Отменили, пока стояли в очереди
                job["status"] = "cancelled"
                job["error"] = "Задача отменена пользователем (пока стояла в очереди)"
                log("🛑 Задача отменена до запуска", stage="Отменено", percent=0)
                return
            job["status"] = "running"
            job["started_at"] = time.time()
            CURRENT_JOB["id"] = job["id"]
            CURRENT_JOB["worker"] = job["worker"]
            log(f"▶ Задача '{job['type']}' запущена", stage="Старт", percent=1)
            if job["worker"].is_stop_requested():
                raise ValueError("Задача отменена пользователем")
            if job["type"] == "transcribe":
                result = task_transcribe(job["params"], log, worker=job["worker"])
            elif job["type"] == "media":
                result = task_media(job["params"], log, worker=job["worker"])
            elif job["type"] == "convert":
                result = task_convert(job["params"], log, worker=job["worker"])
            else:
                raise ValueError(f"Неизвестный тип задачи: {job['type']}")
            job["result"] = result
            job["status"] = "done"
            log("✅ Задача завершена", stage="Готово", percent=100)
        finally:
            sem.release()  # слот полосы всегда освобождается — даже при ошибке/отмене
    except Exception as e:
        import traceback
        traceback.print_exc()
        cancelled = "отменена" in str(e).lower()
        job["status"] = "cancelled" if cancelled else "error"
        job["error"] = str(e)
        log(
            ("🛑 Задача отменена" if cancelled else f"❌ Ошибка задачи: {e}"),
            stage="Отменено" if cancelled else "Ошибка",
            percent=job.get("progress", {}).get("percent", 0),
        )
    finally:
        job["finished_at"] = time.time()
        progress_state["active"] = False
        if CURRENT_JOB.get("id") == job["id"]:
            CURRENT_JOB["id"] = None
            CURRENT_JOB["worker"] = None
        with JOBS_LOCK:
            _prune_jobs()
        _save_jobs()


# ─────────────────────────────────────────────────────────────────
#  Task-функции: чистая логика задач без HTTP.
#  Используются и синхронными хендлерами (legacy), и фоновыми
#  потоками (Job API). Ошибки валидации → ValueError.
# ─────────────────────────────────────────────────────────────────

def task_transcribe(data: dict, log, worker=None) -> dict:
    url = (data.get("url") or "").strip()
    local_file = (data.get("file_path") or "").strip()
    model_name = data.get("model", "base")
    lang = data.get("language", "auto")
    translate_to = (data.get("translate_to") or "-").strip().lower()
    save_audio = bool(data.get("save_audio", False))

    if not url and not local_file:
        raise ValueError("Не указан URL или файл для транскрибации")

    # Файл передан, но не существует на диске — понятная ошибка вместо трейсбека Whisper
    if local_file and not os.path.exists(local_file):
        raise ValueError(f"Файл не найден на диске движка: {local_file}")

    worker = worker or DummyWorker()

    log("🚀 Запуск транскрибации...", stage="Инициализация", percent=5)

    downloader = Downloader(OUTPUT_DIR)

    result_text = ""
    segments = []
    source_type = "unknown"
    detected_lang = lang
    saved_media_files = []

    # ─── URL CASE ───
    if url.startswith("http"):
        log(f"🔎 Шаг 1/4: Поиск субтитров YouTube для {url}...", stage="Поиск субтитров", percent=15)

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
            log(f"✅ Найдены субтитры '{sub_lang}' ({'авто' if is_auto else 'ручные'}). Скачивание...", stage="Скачивание субтитров", percent=35)
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
                        log("⚡ Субтитры получены и распарсены за 2 секунды!", stage="Субтитры готовы", percent=70)
                    try:
                        os.remove(sub_file)
                    except Exception:
                        pass
            except Exception as e:
                log(f"⚠️ Ошибка получения субтитров: {e}. Переходим к скачиванию медиа...", stage="Субтитры недоступны")

        # Fallback to downloading media + Whisper
        if not got_subtitles:
            log("📥 Шаг 2/4: Скачивание аудиодорожки с YouTube...", stage="Скачивание аудио", percent=30)

            def dl_callback(percent, eta=""):
                log(f"Загрузка: {percent}% ({eta})", percent=min(25 + int(percent * 0.25), 55))

            media_path, _ = downloader.download(
                url,
                extract_audio=True,
                worker_obj=worker,
                progress_callback=dl_callback
            )
            log(f"✅ Аудио скачано: {os.path.basename(media_path)}", stage="Медиа скачано", percent=60)

            if save_audio:
                saved_media_files.append(media_path)

            log(f"🧠 Шаг 3/4: Распознавание речи через Whisper ({model_name})...", stage="Whisper", percent=65)
            engine = WhisperEngine(model_name=model_name)

            def whisper_cb(percent, eta=""):
                log(f"Whisper: {percent}% ({eta})", percent=min(65 + int(percent * 0.25), 90))

            whisper_out = engine.transcribe(
                media_path,
                language=lang,
                progress_callback=whisper_cb,
                worker_obj=worker
            )
            result_text = whisper_out.get("text", "")
            segments = whisper_out.get("segments", [])
            detected_lang = whisper_out.get("language", lang)
            source_type = f"Whisper ({model_name})"
    else:
        # Local file
        media_path = local_file
        log(f"🧠 Распознавание локального файла через Whisper ({model_name})...", stage="Whisper", percent=40)
        engine = WhisperEngine(model_name=model_name)
        whisper_out = engine.transcribe(media_path, language=lang, worker_obj=worker)
        result_text = whisper_out.get("text", "")
        segments = whisper_out.get("segments", [])
        detected_lang = whisper_out.get("language", lang)
        source_type = f"Whisper ({model_name})"

    # Optional translation
    if translate_to and translate_to not in ["-", "", detected_lang]:
        log(f"🌍 Шаг 4/4: Перевод текста на {translate_to}...", stage="Перевод", percent=92)
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

    log("✅ Транскрибация успешно завершена!", stage="Готово", percent=100)

    return {
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
    }


def task_media(data: dict, log, worker=None) -> dict:
    action = data.get("action")
    url = (data.get("url") or "").strip()
    file_path = (data.get("file_path") or "").strip()

    downloader = Downloader(OUTPUT_DIR)
    converter = Converter()
    worker = worker or DummyWorker()

    # ffmpeg нужен для clean_audio и hardsub — проверяем ДО скачивания видео,
    # чтобы не тратить минуты и не падать с непонятным Errno 2 в конце
    if action in ("clean_audio", "hardsub") and not find_ffmpeg_executable():
        raise ValueError(
            "ffmpeg не найден на этом компьютере — эта операция невозможна. "
            "Переустановите движок той же командой установки: установщик скачает ffmpeg автоматически. "
            "Либо установите вручную: brew install ffmpeg (macOS) / apt install ffmpeg (Linux)."
        )

    if action == "download_video":
        log(f"🎬 Скачивание видео в максимальном качестве: {url}...", stage="Скачивание видео", percent=20)
        out_file, _ = downloader.download(url, video_only=True, worker_obj=worker)
        log(f"✅ Видео сохранено: {os.path.basename(out_file)}", stage="Готово", percent=100)
        return {"status": "success", "file": f"/api/download?file={urllib.parse.quote(out_file)}"}

    elif action == "download_audio":
        log(f"🎵 Скачивание аудио (MP3 192k): {url}...", stage="Скачивание аудио", percent=20)
        out_file, _ = downloader.download(url, extract_audio=True, worker_obj=worker)
        log(f"✅ Аудио сохранено: {os.path.basename(out_file)}", stage="Готово", percent=100)
        return {"status": "success", "file": f"/api/download?file={urllib.parse.quote(out_file)}"}

    elif action == "clean_audio":
        log("🎧 Очистка звука (удаление шума, фильтрация, нормализация)...", stage="Очистка звука", percent=30)
        target = file_path
        if url.startswith("http"):
            target, _ = downloader.download(url, extract_audio=True, worker_obj=worker)
        if not target or not os.path.exists(target):
            raise ValueError("Укажите ссылку на видео или загрузите локальный аудио-файл для очистки")

        cleaned = converter.enhance_audio(target, OUTPUT_DIR)
        log(f"✅ Очищенный аудиофайл готов: {os.path.basename(cleaned)}", stage="Готово", percent=100)
        return {"status": "success", "file": f"/api/download?file={urllib.parse.quote(cleaned)}"}

    elif action == "hardsub":
        # Полный конвейер: проверка ffmpeg → скачивание видео → субтитры
        # (YouTube или Whisper) → перевод (опционально) → умное вшивание вниз кадра
        ffmpeg_path = find_ffmpeg_executable()
        log(f"🎥 Вшивание субтитров: ffmpeg найден ({os.path.basename(ffmpeg_path)}), запускаем конвейер...", stage="Hardsub", percent=10)
        sub_lang = data.get("sub_lang", "ru")
        translate_to = (data.get("translate_to") or "-").strip().lower()
        # If YouTube URL, first check/download subtitles
        video_file = file_path
        sub_file = data.get("sub_file")

        if url.startswith("http"):
            # ─── 1. Скачивание видео (нужно в любом случае — и для Whisper, и для вшивания) ───
            log("📥 Шаг 1/4: Скачивание видео...", stage="Скачивание видео", percent=15)
            video_file, _ = downloader.download(url, video_only=True, worker_obj=worker)
            log(f"✅ Видео скачано: {os.path.basename(video_file)}", stage="Видео готово", percent=45)

            # ─── 2. Субтитры: сначала YouTube, если нет — Whisper ниже ───
            if not sub_file or not os.path.exists(sub_file):
                log(f"🔎 Шаг 2/4: Поиск субтитров YouTube ({sub_lang})...", stage="Поиск субтитров", percent=50)
                try:
                    subs_info = downloader.list_subtitles(url)
                    choice = downloader.choose_subtitle_track(subs_info, preferred_lang=sub_lang)
                    if choice:
                        sub_file = downloader.download_subtitles(url, choice["lang"], auto=choice["auto"])
                        if sub_file and os.path.exists(sub_file):
                            log(f"✅ Субтитры YouTube ({choice['lang']}) скачаны", percent=60)
                except Exception as e:
                    log(f"⚠️ Субтитры YouTube недоступны ({e}) — сгенерируем через Whisper", percent=52)
                    sub_file = None

        if not video_file or not os.path.exists(video_file):
            raise ValueError("Укажите ссылку на видео или загрузите локальный видео-файл для вшивания субтитров")

        if not sub_file or not os.path.exists(sub_file):
            # ─── 2b. Субтитров нет — генерируем через Whisper (вся дорожка) ───
            log("🧠 Шаг 2/4: Генерация субтитров через Whisper (вся дорожка — это долго)...", stage="Whisper", percent=50)
            engine = WhisperEngine(model_name=data.get("model", "base"))
            w_res = engine.transcribe(video_file, worker_obj=worker)
            w_segments = w_res.get("segments", [])
            sub_file = os.path.join(OUTPUT_DIR, f"temp_sub_{int(time.time())}.srt")
            with open(sub_file, "w", encoding="utf-8") as f:
                for i, seg in enumerate(w_segments, 1):
                    f.write(f"{i}\n{format_ts(seg['start'])} --> {format_ts(seg['end'])}\n{seg['text'].strip()}\n\n")
            log(f"✅ Сгенерировано реплик: {len(w_segments)}", percent=65)

        # ─── 3. Перевод субтитров (опционально) ───
        if translate_to and translate_to not in ("-", "", "auto"):
            log(f"🌍 Шаг 3/4: Перевод субтитров на {translate_to}...", stage="Перевод субтитров", percent=70)
            translator = Translator()
            sub_segs = parse_subtitles(sub_file) or []
            done_cnt = 0
            for s in sub_segs:
                try:
                    s["text"] = translator.translate_text(s["text"], translate_to)
                    done_cnt += 1
                except Exception:
                    pass  # непереведённые реплики остаются в оригинале
            new_sub = os.path.join(OUTPUT_DIR, f"sub_translated_{int(time.time())}.srt")
            with open(new_sub, "w", encoding="utf-8") as f:
                for i, s in enumerate(sub_segs, 1):
                    f.write(f"{i}\n{format_ts(s.get('start', 0))} --> {format_ts(s.get('end', 0))}\n{s['text'].strip()}\n\n")
            sub_file = new_sub
            log(f"✅ Переведено реплик: {done_cnt} из {len(sub_segs)}", percent=80)

        # ─── 4. Умное вшивание: внизу по центру, отступы, шрифт от высоты видео ───
        log("🎬 Шаг 4/4: Встраивание субтитров в кадр (низ экрана, центр, без перекрытия видео)...", stage="Встраивание субтитров", percent=85)
        out_video = converter.hardsub_video(
            video_file, sub_file, OUTPUT_DIR,
            progress_callback=lambda pct, eta="": log(
                f"Рендер: {pct}% ({eta})",
                percent=min(85 + int(pct * 0.14), 99),
            ),
        )
        log(f"✅ Видео с субтитрами готово: {os.path.basename(out_video)}", stage="Готово", percent=100)
        return {"status": "success", "file": f"/api/download?file={urllib.parse.quote(out_video)}"}

    else:
        raise ValueError(f"Неизвестное действие: {action}")


def task_convert(data: dict, log, worker=None) -> dict:
    file_path = (data.get("file_path") or "").strip()
    target_fmt = (data.get("target_format") or "").strip().lower()

    if not file_path or not os.path.exists(file_path):
        raise ValueError("Файл для конвертации не найден")

    # Медиа- и часть image-конвертаций требуют ffmpeg — проверяем заранее
    from src.utils.fs import find_ffmpeg_executable as _ffe
    media_exts_pre = {"mp3", "wav", "aac", "flac", "ogg", "mp4", "mkv", "webm", "avi", "mov", "m4a"}
    if os.path.splitext(file_path)[1].lower().strip(".") in media_exts_pre and not _ffe():
        raise ValueError(
            "ffmpeg не найден на этом компьютере — конвертация невозможна. "
            "Переустановите движок той же командой установки: установщик скачает ffmpeg автоматически."
        )

    converter = Converter()
    ext = os.path.splitext(file_path)[1].lower().strip(".")
    log(f"🔄 Конвертация {ext} -> {target_fmt}...", stage="Конвертация", percent=40)

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
        raise ValueError(f"Конвертация из {ext} в {target_fmt} не поддерживается")

    log(f"✅ Файл сконвертирован: {os.path.basename(out)}", stage="Готово", percent=100)
    return {"status": "success", "file": f"/api/download?file={urllib.parse.quote(out)}"}


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
        elif path == "/api/jobs":
            self.handle_jobs_list()
        elif path.startswith("/api/jobs/"):
            self.handle_job_get(path.split("/")[3])
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
            "version": "1.2.1",
            "jobs": True,  # Job API: фоновые задачи, переживающие закрытие вкладки
            "queue": True,  # очереди задач + видимый статус «В очереди»
            "parallel_heavy": HEAVY_PARALLEL,  # сколько тяжёлых задач идёт одновременно
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
        # RFC 5987/6266: http.server кодирует заголовки в latin-1 — кириллица
        # в имени файла (русское название видео с YouTube) роняет send_header
        # с UnicodeEncodeError и обрывает ответ без ответа вообще.
        # Даём ASCII-фолбэк + filename*=UTF-8'' — браузеры берут корректное имя из него.
        ascii_name = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_" for c in fname)
        if not ascii_name.strip("_ ."):
            ascii_name = "download" + (os.path.splitext(fname)[1] if os.path.splitext(fname)[1] else ".bin")
        utf8_name = urllib.parse.quote(fname, safe="")
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Disposition', f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}")
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
            elif path == "/api/jobs":
                self.handle_job_create()
            elif path.startswith("/api/jobs/") and path.endswith("/cancel"):
                self.handle_job_cancel(path[len("/api/jobs/"):-len("/cancel")])
            elif path == "/api/stop":
                self.handle_stop()
            else:
                self.send_error_json(f"Unknown POST endpoint: {path}", 404)
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_error_json(str(e), 500)

    def handle_stop(self):
        # Отмена активной фоновой задачи (если есть) + глобальный флаг для legacy-пути
        cur = CURRENT_JOB.get("id")
        if cur:
            with JOBS_LOCK:
                job = JOBS.get(cur)
            if job:
                try:
                    job["worker"].request_stop()
                except Exception:
                    pass
        progress_state["active"] = False
        log_progress("🛑 Обработка отменена", stage="Отменено", percent=0)
        self.send_json({"status": "stopped"})

    # ─────────────────────────────────────────────────────────────
    #  1. Transcribe (Subtitles First + Whisper Fallback)
    #     Legacy-синхронный путь: результат приходит в ответе POST.
    #     Новые клиенты используют POST /api/jobs (фоновое выполнение).
    # ─────────────────────────────────────────────────────────────
    def handle_transcribe(self):
        data = self.read_json_body()
        progress_state["active"] = True
        progress_state["log"] = []
        try:
            with _LANE_SEMS[job_lane("transcribe", data)]:
                result = task_transcribe(data, log_progress)
        except ValueError as e:
            self.send_error_json(str(e), 400)
            return
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_error_json(str(e), 500)
            return
        finally:
            progress_state["active"] = False
        self.send_json(result)

    # ─────────────────────────────────────────────────────────────
    #  2. Media (Download Video, Audio, Clean Audio, Hardsub)
    # ─────────────────────────────────────────────────────────────
    def handle_media(self):
        data = self.read_json_body()
        progress_state["active"] = True
        progress_state["log"] = []
        try:
            with _LANE_SEMS[job_lane("media", data)]:
                result = task_media(data, log_progress)
        except ValueError as e:
            self.send_error_json(str(e), 400)
            return
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_error_json(str(e), 500)
            return
        finally:
            progress_state["active"] = False
        self.send_json(result)

    # ─────────────────────────────────────────────────────────────
    #  3. Convert (Media, Documents, Images)
    # ─────────────────────────────────────────────────────────────
    def handle_convert(self):
        data = self.read_json_body()
        progress_state["active"] = True
        progress_state["log"] = []
        try:
            with _LANE_SEMS[job_lane("convert", data)]:
                result = task_convert(data, log_progress)
        except ValueError as e:
            self.send_error_json(str(e), 400)
            return
        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_error_json(str(e), 500)
            return
        finally:
            progress_state["active"] = False
        self.send_json(result)

    # ─────────────────────────────────────────────────────────────
    #  6. Job API — фоновые задачи, переживающие закрытие вкладки
    # ─────────────────────────────────────────────────────────────
    def handle_job_create(self):
        data = self.read_json_body()
        jtype = (data.get("type") or "").strip()
        params = data.get("params")
        if jtype not in ("transcribe", "media", "convert"):
            self.send_error_json(f"Неизвестный тип задачи: {jtype}", 400)
            return
        if not isinstance(params, dict):
            params = {}
        jid = uuid.uuid4().hex[:12]
        job = {
            "id": jid,
            "type": jtype,
            "params": params,
            "lane": job_lane(jtype, params),
            "status": "queued",
            "progress": {"active": True, "task": jtype, "stage": "В очереди", "percent": 0, "eta": "", "log": []},
            "result": None,
            "error": None,
            "label": str(data.get("label") or "").strip(),
            "created_at": time.time(),
            "finished_at": None,
            "worker": DummyWorker(),
        }
        with JOBS_LOCK:
            JOBS[jid] = job
        threading.Thread(target=run_job, args=(job,), daemon=True).start()
        _save_jobs()
        self.send_json({"status": "started", "job_id": jid})

    def handle_jobs_list(self):
        with JOBS_LOCK:
            jobs = [
                _job_snapshot(j)
                for j in sorted(JOBS.values(), key=lambda x: x.get("created_at", 0))[-JOBS_MAX:]
            ]
        self.send_json({"status": "ok", "jobs": jobs})

    def handle_job_get(self, job_id):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
            snap = _job_snapshot(job) if job else None
        if snap is None:
            self.send_error_json("Задача не найдена (журнал очищен или движок перезапускался)", 404)
            return
        self.send_json(snap)

    def handle_job_cancel(self, job_id):
        with JOBS_LOCK:
            job = JOBS.get(job_id)
        if not job:
            self.send_error_json("Задача не найдена", 404)
            return
        if job["status"] == "queued":
            # Стояла в очереди — отменяем мгновенно, не дожидаясь запуска
            job["status"] = "cancelled"
            job["error"] = "Задача отменена пользователем (пока стояла в очереди)"
            job["finished_at"] = time.time()
            try:
                job["worker"].request_stop()
            except Exception:
                pass
            _save_jobs()
            self.send_json({"status": "cancelled", "job_id": job_id})
        elif job["status"] == "running":
            try:
                job["worker"].request_stop()
            except Exception:
                pass
            self.send_json({"status": "cancelling", "job_id": job_id})
        else:
            self.send_json({"status": "already_finished", "job_id": job_id})

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
    _load_jobs()  # восстановить журнал фоновых задач после перезапуска
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
