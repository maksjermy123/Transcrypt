"""
VoxPaperAi Pro — Web Edition
Gradio-based web UI for Hugging Face Spaces (free CPU tier).

Features:
  1. Transcription   – Whisper speech-to-text (tiny / base / small / medium)
  2. Translation      – Google Translate for text and files
  3. Audio Cleaning   – ffmpeg noise reduction + normalisation
  4. Media Conversion – ffmpeg format converter
"""

import gradio as gr
import whisper
import subprocess
import tempfile
import json
import os
from pathlib import Path

# ═══════════════════════════════════════════════════════════════════
#  Constants & helpers
# ═══════════════════════════════════════════════════════════════════

WHISPER_MODELS = ["tiny", "base", "small", "medium"]

WHISPER_LANGS = [
    "Авто", "ru", "en", "uk", "de", "fr", "es", "it",
    "pt", "zh", "ja", "ko", "ar", "tr", "pl", "nl", "sv",
]

TRANSLATE_LANGS = {
    "Авто": "auto", "Русский": "ru", "Английский": "en",
    "Украинский": "uk", "Немецкий": "de", "Французский": "fr",
    "Испанский": "es", "Итальянский": "it", "Португальский": "pt",
    "Китайский": "zh-CN", "Японский": "ja", "Корейский": "ko",
    "Арабский": "ar", "Турецкий": "tr", "Польский": "pl",
    "Нидерландский": "nl", "Шведский": "sv",
}

AUDIO_FORMATS = ["mp3", "wav", "aac", "ogg", "flac", "m4a", "wma"]
VIDEO_FORMATS = ["mp4", "mkv", "avi", "mov", "webm"]
MEDIA_FORMATS = AUDIO_FORMATS + VIDEO_FORMATS

_model_cache: dict = {}


def _load_model(name: str):
    """Load and cache a Whisper model."""
    if name not in _model_cache:
        _model_cache[name] = whisper.load_model(name)
    return _model_cache[name]


def _ts(seconds: float) -> str:
    """Format seconds → HH:MM:SS,mmm (SRT style)."""
    ms = int((seconds % 1) * 1000)
    total = int(seconds)
    h, r = divmod(total, 3600)
    m, s = divmod(r, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ts_vtt(seconds: float) -> str:
    """Format seconds → HH:MM:SS.mmm (VTT style)."""
    return _ts(seconds).replace(",", ".")


def _tmp(suffix: str) -> str:
    return os.path.join(tempfile.gettempdir(), f"voxpaper_out{suffix}")


# ═══════════════════════════════════════════════════════════════════
#  1. TRANSCRIPTION
# ═══════════════════════════════════════════════════════════════════

def transcribe(audio_path, model_name, language, with_timestamps, output_format,
               progress=gr.Progress(track_tqdm=True)):
    if audio_path is None:
        raise gr.Error("⚠️ Загрузите аудио или видео файл")

    progress(0.1, desc="Загрузка модели...")
    model = _load_model(model_name)

    progress(0.2, desc="Распознавание речи...")
    lang = None if language == "Авто" else language
    result = model.transcribe(audio_path, language=lang, verbose=False)
    segments = result.get("segments", [])
    detected = result.get("language", "?")

    progress(0.9, desc="Формирование результата...")
    header = f"🌐 Язык: {detected} | Сегментов: {len(segments)}\n\n"

    if output_format == "TXT":
        if with_timestamps:
            body = "\n".join(
                f"[{_ts(s['start'])} → {_ts(s['end'])}] {s['text'].strip()}"
                for s in segments
            )
        else:
            body = result["text"].strip()
        ext, content = ".txt", (body if not with_timestamps else body)

    elif output_format == "SRT":
        blocks = []
        for i, s in enumerate(segments, 1):
            blocks.append(
                f"{i}\n{_ts(s['start'])} --> {_ts(s['end'])}\n{s['text'].strip()}\n"
            )
        ext, content = ".srt", "\n".join(blocks)

    elif output_format == "VTT":
        lines = ["WEBVTT\n"]
        for s in segments:
            lines.append(
                f"{_ts_vtt(s['start'])} --> {_ts_vtt(s['end'])}\n{s['text'].strip()}\n"
            )
        ext, content = ".vtt", "\n".join(lines)

    elif output_format == "JSON":
        ext = ".json"
        content = json.dumps(result, ensure_ascii=False, indent=2)

    elif output_format == "MD":
        lines = [f"# Транскрипция\n\n> Язык: {detected}\n"]
        for s in segments:
            ts = f"`{_ts(s['start'])}` " if with_timestamps else ""
            lines.append(f"{ts}{s['text'].strip()}\n")
        ext, content = ".md", "\n".join(lines)

    else:
        ext, content = ".txt", result["text"].strip()

    out_path = _tmp(ext)
    Path(out_path).write_text(content, encoding="utf-8")

    preview = content[:5000] + ("\n\n... (скачайте файл для полного текста)" if len(content) > 5000 else "")
    return header + preview, out_path


# ═══════════════════════════════════════════════════════════════════
#  2. TRANSLATION
# ═══════════════════════════════════════════════════════════════════

def _do_translate(text: str, src_code: str, tgt_code: str) -> str:
    """Translate text with automatic chunking for long texts."""
    from deep_translator import GoogleTranslator

    translator = GoogleTranslator(source=src_code, target=tgt_code)
    max_len = 4500

    if len(text) <= max_len:
        return translator.translate(text)

    # Split by paragraphs, respecting chunk limits
    chunks, current = [], ""
    for para in text.split("\n"):
        if len(current) + len(para) + 1 > max_len:
            if current:
                chunks.append(current)
            current = para
        else:
            current = f"{current}\n{para}" if current else para
    if current:
        chunks.append(current)

    return "\n".join(translator.translate(c) for c in chunks if c.strip())


def translate_text(text, source_lang, target_lang):
    if not text or not text.strip():
        raise gr.Error("⚠️ Введите текст для перевода")

    src = TRANSLATE_LANGS.get(source_lang, "auto")
    tgt = TRANSLATE_LANGS.get(target_lang, "en")
    return _do_translate(text, src, tgt)


def translate_file(file_path, source_lang, target_lang):
    if file_path is None:
        raise gr.Error("⚠️ Загрузите файл (.txt или .srt)")

    src = TRANSLATE_LANGS.get(source_lang, "auto")
    tgt = TRANSLATE_LANGS.get(target_lang, "en")

    path = Path(file_path)
    ext = path.suffix.lower()
    if ext not in (".txt", ".srt", ".vtt", ".md"):
        raise gr.Error(f"Формат {ext} не поддерживается. Используйте .txt, .srt, .vtt или .md")

    text = path.read_text(encoding="utf-8", errors="ignore")
    translated = _do_translate(text, src, tgt)

    out_path = _tmp(f"_translated{ext}")
    Path(out_path).write_text(translated, encoding="utf-8")

    preview = translated[:3000] + ("..." if len(translated) > 3000 else "")
    return preview, out_path


# ═══════════════════════════════════════════════════════════════════
#  3. AUDIO CLEANING
# ═══════════════════════════════════════════════════════════════════

def clean_audio(audio_path):
    if audio_path is None:
        raise gr.Error("⚠️ Загрузите аудио файл")

    out_path = _tmp("_cleaned.mp3")
    cmd = [
        "ffmpeg", "-y", "-i", audio_path,
        "-af", (
            "afftdn=nf=-25,"
            "highpass=f=200,"
            "lowpass=f=3000,"
            "loudnorm=I=-16:TP=-1.5:LRA=11"
        ),
        "-ar", "44100", "-ac", "1",
        out_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        raise gr.Error(f"Ошибка ffmpeg:\n{r.stderr[-500:]}")

    orig_size = os.path.getsize(audio_path) / (1024 * 1024)
    new_size = os.path.getsize(out_path) / (1024 * 1024)

    info = (
        "✅ **Аудио очищено**\n\n"
        "Применённые фильтры:\n"
        "- `afftdn` — адаптивное шумоподавление\n"
        "- `highpass 200 Hz` — удаление низкочастотного гула\n"
        "- `lowpass 3000 Hz` — удаление высокочастотного шипения\n"
        "- `loudnorm` — нормализация громкости (EBU R128)\n\n"
        f"📦 Размер: {orig_size:.1f} MB → {new_size:.1f} MB"
    )
    return info, out_path


# ═══════════════════════════════════════════════════════════════════
#  4. MEDIA CONVERSION
# ═══════════════════════════════════════════════════════════════════

def convert_media(input_path, target_format):
    if input_path is None:
        raise gr.Error("⚠️ Загрузите медиа файл")

    fmt = target_format.lower().strip(".")
    out_path = _tmp(f"_converted.{fmt}")

    cmd = ["ffmpeg", "-y", "-i", input_path]

    # Format-specific encoding options
    if fmt == "mp3":
        cmd += ["-codec:a", "libmp3lame", "-q:a", "2"]
    elif fmt == "wav":
        cmd += ["-codec:a", "pcm_s16le"]
    elif fmt == "aac":
        cmd += ["-codec:a", "aac", "-b:a", "192k"]
        out_path = _tmp("_converted.m4a")  # AAC needs m4a container
    elif fmt == "ogg":
        cmd += ["-codec:a", "libvorbis", "-q:a", "5"]
    elif fmt == "flac":
        cmd += ["-codec:a", "flac"]
    elif fmt == "mp4":
        cmd += ["-codec:v", "libx264", "-preset", "fast",
                "-codec:a", "aac", "-movflags", "+faststart"]
    elif fmt == "mkv":
        cmd += ["-codec", "copy"]
    elif fmt == "webm":
        cmd += ["-codec:v", "libvpx-vp9", "-crf", "30", "-b:v", "0",
                "-codec:a", "libopus"]
    elif fmt == "avi":
        cmd += ["-codec:v", "mpeg4", "-q:v", "5", "-codec:a", "mp3"]
    elif fmt == "mov":
        cmd += ["-codec:v", "libx264", "-codec:a", "aac",
                "-movflags", "+faststart"]

    cmd.append(out_path)

    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise gr.Error(f"Ошибка конвертации:\n{r.stderr[-500:]}")

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    return f"✅ Конвертировано в **.{fmt}** ({size_mb:.1f} MB)", out_path


# ═══════════════════════════════════════════════════════════════════
#  GRADIO UI
# ═══════════════════════════════════════════════════════════════════

custom_css = """
.gradio-container { max-width: 1100px !important; }
.gr-button-primary { background: #7c5bf5 !important; border: none !important; }
.gr-button-primary:hover { background: #a78bfa !important; }
footer { display: none !important; }
"""

with gr.Blocks(
    title="VoxPaperAi Pro",
    theme=gr.themes.Soft(primary_hue="purple", secondary_hue="blue"),
    css=custom_css,
) as app:

    gr.Markdown(
        """
        # 🎙 VoxPaperAi Pro — Web Edition
        Транскрибация · Перевод · Очистка аудио · Конвертация форматов

        > ⚡ Бесплатная веб-версия на CPU.
        > Для полного функционала скачайте [десктопное приложение](https://github.com/maksjermy123/Transcrypt/releases).
        """
    )

    # ─── Tab 1: Transcription ───────────────────────────────────
    with gr.Tab("🎙 Транскрибация"):
        gr.Markdown("Загрузите аудио или видео — Whisper распознает речь и создаст текст / субтитры.")
        with gr.Row():
            with gr.Column(scale=1):
                t_audio = gr.Audio(type="filepath", label="Аудио / Видео файл")
                t_model = gr.Dropdown(WHISPER_MODELS, value="base", label="Модель Whisper",
                                      info="tiny — быстро, medium — качественно")
                t_lang = gr.Dropdown(WHISPER_LANGS, value="Авто", label="Язык аудио")
                t_ts = gr.Checkbox(value=True, label="Добавить таймкоды")
                t_fmt = gr.Dropdown(["TXT", "SRT", "VTT", "JSON", "MD"], value="TXT",
                                    label="Формат выхода")
                t_btn = gr.Button("🚀 Распознать речь", variant="primary", size="lg")

            with gr.Column(scale=2):
                t_result = gr.Textbox(label="Результат", lines=22, show_copy_button=True)
                t_file = gr.File(label="📥 Скачать файл")

        t_btn.click(
            transcribe,
            inputs=[t_audio, t_model, t_lang, t_ts, t_fmt],
            outputs=[t_result, t_file],
        )

    # ─── Tab 2: Translation ─────────────────────────────────────
    with gr.Tab("🌍 Перевод"):
        lang_names = list(TRANSLATE_LANGS.keys())

        with gr.Tabs():
            with gr.Tab("Текст"):
                gr.Markdown("Вставьте текст — получите перевод через Google Translate.")
                with gr.Row():
                    tr_src_lang = gr.Dropdown(lang_names, value="Авто", label="Исходный язык")
                    tr_tgt_lang = gr.Dropdown(
                        [l for l in lang_names if l != "Авто"],
                        value="Английский", label="Целевой язык",
                    )
                with gr.Row():
                    tr_input = gr.Textbox(label="Исходный текст", lines=10,
                                          placeholder="Вставьте текст для перевода...")
                    tr_output = gr.Textbox(label="Перевод", lines=10,
                                           show_copy_button=True, interactive=False)
                tr_btn = gr.Button("🌍 Перевести", variant="primary")
                tr_btn.click(translate_text,
                             inputs=[tr_input, tr_src_lang, tr_tgt_lang],
                             outputs=[tr_output])

            with gr.Tab("Файл"):
                gr.Markdown("Загрузите `.txt`, `.srt`, `.vtt` или `.md` файл для перевода.")
                with gr.Row():
                    tf_src_lang = gr.Dropdown(lang_names, value="Авто", label="Исходный язык")
                    tf_tgt_lang = gr.Dropdown(
                        [l for l in lang_names if l != "Авто"],
                        value="Английский", label="Целевой язык",
                    )
                tf_file_in = gr.File(label="Загрузите файл", file_types=[".txt", ".srt", ".vtt", ".md"])
                tf_btn = gr.Button("🌍 Перевести файл", variant="primary")
                tf_preview = gr.Textbox(label="Предпросмотр", lines=10, interactive=False)
                tf_file_out = gr.File(label="📥 Скачать перевод")
                tf_btn.click(translate_file,
                             inputs=[tf_file_in, tf_src_lang, tf_tgt_lang],
                             outputs=[tf_preview, tf_file_out])

    # ─── Tab 3: Audio Cleaning ──────────────────────────────────
    with gr.Tab("🎧 Очистка аудио"):
        gr.Markdown(
            "Загрузите аудио — ffmpeg уберёт шум, отфильтрует частоты "
            "и нормализует громкость."
        )
        with gr.Row():
            with gr.Column():
                ac_audio = gr.Audio(type="filepath", label="Исходное аудио")
                ac_btn = gr.Button("🎧 Очистить", variant="primary", size="lg")
            with gr.Column():
                ac_info = gr.Markdown(label="Результат")
                ac_file = gr.File(label="📥 Скачать очищенное аудио")

        ac_btn.click(clean_audio, inputs=[ac_audio], outputs=[ac_info, ac_file])

    # ─── Tab 4: Media Conversion ────────────────────────────────
    with gr.Tab("🔄 Конвертер"):
        gr.Markdown("Конвертируйте аудио и видео между популярными форматами.")
        with gr.Row():
            with gr.Column():
                cv_file = gr.File(label="Загрузите медиа файл")
                cv_fmt = gr.Dropdown(
                    MEDIA_FORMATS, value="mp3",
                    label="Целевой формат",
                )
                cv_btn = gr.Button("🔄 Конвертировать", variant="primary", size="lg")
            with gr.Column():
                cv_info = gr.Markdown(label="Результат")
                cv_out = gr.File(label="📥 Скачать результат")

        cv_btn.click(convert_media, inputs=[cv_file, cv_fmt], outputs=[cv_info, cv_out])

    # ─── Footer ─────────────────────────────────────────────────
    gr.Markdown(
        """
        ---
        <center>

        **VoxPaperAi Pro** v1.0.0 ·
        [GitHub](https://github.com/maksjermy123/Transcrypt) ·
        [Скачать десктоп-версию](https://github.com/maksjermy123/Transcrypt/releases)

        </center>
        """
    )

# ═══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app.launch()
