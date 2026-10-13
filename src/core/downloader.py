import os
import time
import yt_dlp
from yt_dlp.networking.impersonate import ImpersonateTarget
import logging
from src.utils.fs import (
    artifact_label_from_info,
    find_ffmpeg_executable,
    safe_artifact_part,
)
from src.utils.app_paths import app_support_dir

class Downloader:
    def __init__(self, output_dir=None):
        self.output_dir = output_dir or os.path.join(app_support_dir(), "temp_downloads")
        os.makedirs(self.output_dir, exist_ok=True)
        self.logger = logging.getLogger(__name__)

    @staticmethod
    def _normalize_lang_code(value: str) -> str:
        if not value:
            return ""
        return str(value).strip().lower().replace("_", "-")

    @classmethod
    def _matching_lang_codes(cls, available: list[str], requested: str) -> list[str]:
        requested_norm = cls._normalize_lang_code(requested)
        if not requested_norm:
            return []

        exact = []
        prefixed = []
        for code in available or []:
            code_norm = cls._normalize_lang_code(code)
            if code_norm == requested_norm:
                exact.append(code)
            elif code_norm.startswith(f"{requested_norm}-"):
                prefixed.append(code)
        return exact + prefixed

    @classmethod
    def choose_subtitle_track(cls, subs_info, preferred_lang, fallback_langs=None):
        manual = list((subs_info or {}).get("manual") or [])
        auto = list((subs_info or {}).get("auto") or [])
        fallback_langs = list(fallback_langs or [])

        ordered_langs = []
        preferred_norm = cls._normalize_lang_code(preferred_lang)
        
        # Add preferred lang first, then fallbacks
        if preferred_norm:
            ordered_langs.append((preferred_norm, True))  # (lang, is_preferred)
        
        for lang in fallback_langs:
            norm = cls._normalize_lang_code(lang)
            if norm and norm not in [l[0] for l in ordered_langs]:
                ordered_langs.append((norm, False))  # (lang, is_preferred=False)

        for lang_norm, is_preferred in ordered_langs:
            for match in cls._matching_lang_codes(manual, lang_norm):
                if is_preferred:
                    reason = f"точное/предпочтительное совпадение ({lang_norm}) в ручных субтитрах"
                else:
                    reason = f"совпадение fallback языка ({lang_norm}) в ручных субтитрах"
                return {
                    "lang": match,
                    "auto": False,
                    "reason": reason,
                }
            for match in cls._matching_lang_codes(auto, lang_norm):
                if is_preferred:
                    reason = f"точное/предпочтительное совпадение ({lang_norm}) в автосубтитрах"
                else:
                    reason = f"совпадение fallback языка ({lang_norm}) в автосубтитрах"
                return {
                    "lang": match,
                    "auto": True,
                    "reason": reason,
                }

        if manual:
            return {
                "lang": manual[0],
                "auto": False,
                "reason": "взяты любые доступные ручные субтитры для последующего перевода",
            }
        if auto:
            return {
                "lang": auto[0],
                "auto": True,
                "reason": "взяты любые доступные автосубтитры для последующего перевода",
            }
        return None

    @staticmethod
    def _is_fragment_file(path: str) -> bool:
        name = os.path.basename(path or "")
        return ".f" in name and any(part.isdigit() for part in name.split("."))

    def _find_downloaded_match(
        self,
        base_name: str,
        started_at: float,
        *,
        audio_only: bool = False,
        video_only: bool = False,
    ) -> str | None:
        candidates = []
        audio_exts = {".m4a", ".mp3", ".aac", ".wav", ".ogg", ".opus", ".webm"}
        video_exts = {".mp4", ".mkv", ".mov", ".webm", ".m4v"}

        for entry in os.listdir(self.output_dir):
            if not entry.startswith(base_name):
                continue

            full_path = os.path.join(self.output_dir, entry)
            if not os.path.isfile(full_path):
                continue

            try:
                mtime = os.path.getmtime(full_path)
            except OSError:
                continue

            # Ignore stale files from older attempts.
            if mtime + 1 < started_at:
                continue

            ext = os.path.splitext(entry)[1].lower()
            is_fragment = self._is_fragment_file(full_path)

            if audio_only and ext not in audio_exts:
                continue
            if video_only and ext not in video_exts:
                continue

            score = 0
            if not is_fragment:
                score += 100
            if video_only and ext in {".mp4", ".webm", ".mkv", ".mov", ".m4v"}:
                score += 10
            if audio_only and ext in {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".opus"}:
                score += 10

            candidates.append((score, mtime, full_path))

        if not candidates:
            return None

        candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return candidates[0][2]

    def download(self, url, extract_audio=False, audio_only=False, video_only=False, worker_obj=None, progress_callback=None):
        """
        Downloads media from URL.
        :param url: URL to download
        :param extract_audio: If True, extracts audio for transcription (mp3)
        :param audio_only: If True, downloads only audio (keep original format if possible or mp3)
        :param video_only: If True, downloads only video
        :return: Tuple (Path to file, is_new_file boolean)
        """
        self.logger.info(f"Starting download: {url}")
        ffmpeg_path = find_ffmpeg_executable()
        
        ydl_opts = {
            'outtmpl': os.path.join(self.output_dir, '%(title)s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'restrictfilenames': False, # Keep original readable titles without replacing spaces with _
            'ignoreerrors': True, # Continue if subtitles fail
            'noplaylist': True, # Download only the video, not the playlist
            # YouTube requires browser TLS fingerprint (HTTP 403 otherwise)
            'impersonate': ImpersonateTarget('chrome'),
            # mweb client + EJS challenge solver: needed for GVS PO Token
            'extractor_args': {'youtube': {'player_client': ['mweb']}},
            'remote_components': ['ejs:github'],
        }
        if ffmpeg_path:
            ydl_opts['ffmpeg_location'] = os.path.dirname(ffmpeg_path)

        if extract_audio or audio_only:
            if ffmpeg_path:
                ydl_opts.update({
                    'format': 'bestaudio/best',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    }],
                })
            else:
                # Without ffmpeg we can only save the original audio stream as-is.
                ydl_opts.update({
                    'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
                })
        elif video_only:
             if ffmpeg_path:
                 # Prefer MP4 with H.264 (avc1) and AAC for maximum compatibility on macOS/QuickTime
                 ydl_opts.update({'format': 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best'})
             else:
                 # Without ffmpeg download only muxed A/V formats, otherwise yt-dlp leaves .fXXX files.
                 ydl_opts.update({
                     'format': 'best[acodec!=none][vcodec!=none][ext=mp4]/best[acodec!=none][vcodec!=none][ext=webm]/best[acodec!=none][vcodec!=none]',
                 })
        else:
             if ffmpeg_path:
                 # Default: Best quality, prefer compatible MP4
                 ydl_opts.update({'format': 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best'})
             else:
                 ydl_opts.update({
                     'format': 'best[acodec!=none][vcodec!=none][ext=mp4]/best[acodec!=none][vcodec!=none][ext=webm]/best[acodec!=none][vcodec!=none]',
                 })

        # Add subtitle options
        # FIX: Do NOT download all subtitles by default. This causes "70 files" issue.
        # Only download if explicitly requested (future feature) or if we implement "Subtitle First" logic properly.
        # For now, disable to keep output clean.
        ydl_opts.update({
            'writesubtitles': False,
            'writeautomaticsub': False,
            'subtitleslangs': [], 
            'skip_download': False,
        })
        
        def stop_hook(d):
            if worker_obj and hasattr(worker_obj, 'is_stop_requested') and worker_obj.is_stop_requested():
                raise Exception("Скачивание прервано пользователем")
            if not progress_callback:
                return
            try:
                status = d.get("status")
                if status == "downloading":
                    downloaded = d.get("downloaded_bytes") or 0
                    total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                    if total:
                        percent = int((downloaded / total) * 100)
                    else:
                        percent = 0
                    speed = d.get("speed") or 0
                    eta = d.get("eta")
                    eta_str = ""
                    if isinstance(eta, (int, float)) and eta >= 0:
                        if eta > 60:
                            eta_str = f"Скачивание: ~{int(eta//60)} мин. {int(eta%60)} сек."
                        else:
                            eta_str = f"Скачивание: ~{int(eta)} сек."
                    elif speed and total and downloaded:
                        remaining = max(0, total - downloaded)
                        eta_guess = remaining / speed if speed > 0 else 0
                        if eta_guess > 0:
                            eta_str = f"Скачивание: ~{int(eta_guess)} сек."
                    progress_callback(min(percent, 99), eta_str)
                elif status == "finished":
                    progress_callback(99, "Скачивание завершено, постобработка...")
            except Exception:
                pass
                
        ydl_opts['progress_hooks'] = [stop_hook]

        try:
            started_at = time.time()
            # Retry loop: YouTube often answers HTTP 429 on rapid consecutive requests
            # (e.g. right after a failed subtitle download).
            max_dl_retries = 3
            for attempt in range(max_dl_retries):
                try:
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        info = ydl.extract_info(url, download=False)

                    if info is None:
                        raise RuntimeError("yt-dlp не получил информацию о видео (возможна блокировка или 429)")

                    predicted_name = ydl.prepare_filename(info)
                    final_filename = predicted_name
                    if (extract_audio or audio_only) and ffmpeg_path:
                        base, _ = os.path.splitext(predicted_name)
                        final_filename = f"{base}.mp3"

                    if os.path.exists(final_filename):
                        self.logger.info(f"File already exists: {final_filename}")
                        return final_filename, False

                    download_opts = dict(ydl_opts)
                    if final_filename != predicted_name:
                        self.logger.info(f"File exists, downloading to unique path: {final_filename}")
                        download_opts['outtmpl'] = final_filename

                    # Real download must NOT swallow errors: ignoreerrors=True would
                    # return a path to a file that was never created.
                    download_opts['ignoreerrors'] = False

                    with yt_dlp.YoutubeDL(download_opts) as ydl:
                        info = ydl.extract_info(url, download=True)
                    break
                except yt_dlp.utils.DownloadError as e:
                    if ('429' in str(e) or 'Too Many Requests' in str(e)) and attempt < max_dl_retries - 1:
                        wait_time = 10 * (attempt + 1)
                        self.logger.warning(
                            f"HTTP 429 при скачивании медиа. Пауза {wait_time}s перед повтором "
                            f"{attempt + 2}/{max_dl_retries}..."
                        )
                        time.sleep(wait_time)
                        continue
                    raise

            if info is None:
                raise RuntimeError("Скачивание не удалось после всех попыток")

            # Get actual filename from info
            if 'requested_downloads' in info:
                try:
                    filename = info['requested_downloads'][0]['filepath']
                except KeyError:
                    filename = info['requested_downloads'][0].get('filename')

                if not filename:
                    filename = ydl.prepare_filename(info)
                    if (extract_audio or audio_only) and ffmpeg_path:
                       base, _ = os.path.splitext(filename)
                       filename = f"{base}.mp3"

            else:
                filename = ydl.prepare_filename(info)
                if (extract_audio or audio_only) and ffmpeg_path:
                    base, _ = os.path.splitext(filename)
                    filename = f"{base}.mp3"

            self.logger.info(f"Download completed: {filename}")

            # FINAL CHECK: Does the file exist?
            if not os.path.exists(filename):
                 self.logger.warning(f"Reported filename does not exist: {filename}")
                 base_name = os.path.basename(os.path.splitext(filename)[0])
                 found = self._find_downloaded_match(
                     base_name,
                     started_at,
                     audio_only=(extract_audio or audio_only),
                     video_only=video_only and not (extract_audio or audio_only),
                 )

                 if found:
                     self.logger.warning(f"Found match: {found}")
                     filename = found
                 else:
                     # Never return a path to a non-existent file: the caller
                     # (Whisper subprocess) would fail with a confusing error.
                     raise RuntimeError(
                         "Скачивание не удалось: файл не найден после загрузки "
                         f"(ожидался: {filename}). Возможна блокировка YouTube (HTTP 429) — попробуйте позже."
                     )

            return filename, True
                
        except Exception as e:
            self.logger.error(f"Download failed: {e}")
            raise

    def get_title(self, url):
        try:
            with yt_dlp.YoutubeDL({'quiet': True}) as ydl:
                info = ydl.extract_info(url, download=False)
                return info.get('title', 'Unknown')
        except Exception:
            return "Unknown"

    def get_artifact_label(self, url):
        """Returns a readable label like 'YT Channel - Title' for URL-based artifacts."""
        try:
            with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True}) as ydl:
                info = ydl.extract_info(url, download=False)
            return safe_artifact_part(artifact_label_from_info(info, url))
        except Exception:
            tail = url.strip().rstrip("/").split("/")[-1] or "link"
            return safe_artifact_part(tail) or "link"

    def list_subtitles(self, url):
        """
        Returns available subtitles for the URL.
        :return: dict {'manual': [lang_codes], 'auto': [lang_codes]}
        """
        try:
            ydl_opts = {
                'quiet': True,
                'skip_download': True,
                'writesubtitles': True,
                'writeautomaticsub': True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return {
                    'manual': list(info.get('subtitles', {}).keys()),
                    'auto': list(info.get('automatic_captions', {}).keys())
                }
        except Exception as e:
            self.logger.error(f"Failed to list subtitles: {e}")
            return {'manual': [], 'auto': []}

    def download_subtitles(self, url, lang, auto=False, is_vtt=True, worker_obj=None, allow_auto_fallback=True):
        """
        Downloads subtitles for a specific language.
        :param lang: Language code (e.g., 'en', 'ru')
        :param auto: True if downloading auto-generated captions
        :return: Path to the downloaded .vtt/.srt file
        """
        self.logger.info(f"Downloading subtitles: {lang} (Auto={auto})")

        def vtt_to_srt(vtt_path: str, srt_path: str) -> str:
            import re

            with open(vtt_path, "r", encoding="utf-8", errors="ignore") as f:
                raw = f.read().replace("\r\n", "\n").replace("\r", "\n")

            lines = [ln.rstrip() for ln in raw.split("\n")]
            # Drop WEBVTT header and NOTE blocks (best-effort)
            cleaned = []
            skip_note = False
            for ln in lines:
                if ln.strip().upper().startswith("WEBVTT"):
                    continue
                if ln.strip().startswith("NOTE"):
                    skip_note = True
                    continue
                if skip_note:
                    if not ln.strip():
                        skip_note = False
                    continue
                cleaned.append(ln)

            blocks = "\n".join(cleaned).split("\n\n")
            out_lines = []
            idx = 1
            for block in blocks:
                b_lines = [x.strip() for x in block.split("\n") if x.strip()]
                if not b_lines:
                    continue
                ts_line = None
                text_lines = []
                for bl in b_lines:
                    if "-->" in bl and ts_line is None:
                        ts_line = bl
                    elif ts_line is not None:
                        text_lines.append(bl)
                if not ts_line or not text_lines:
                    continue

                # 00:00:01.500 --> 00:00:04.120  (ignore cues settings)
                ts_line = ts_line.split(" ", 3)
                if len(ts_line) >= 3 and ts_line[1] == "-->":
                    start = ts_line[0]
                    end = ts_line[2]
                else:
                    parts = re.split(r"\s*-->\s*", " ".join(ts_line))
                    if len(parts) < 2:
                        continue
                    start = parts[0].strip()
                    end = parts[1].strip().split(" ")[0]

                start = start.replace(".", ",")
                end = end.replace(".", ",")

                out_lines.append(str(idx))
                out_lines.append(f"{start} --> {end}")
                out_lines.extend(text_lines)
                out_lines.append("")
                idx += 1

            with open(srt_path, "w", encoding="utf-8") as f:
                f.write("\n".join(out_lines).strip() + "\n")
            return srt_path
        
        ydl_opts = {
            'outtmpl': os.path.join(self.output_dir, '%(title)s_%(id)s.%(ext)s'),
            'quiet': True,
            'skip_download': True, # Don't download video
            'writesubtitles': (not auto) or allow_auto_fallback,
            'writeautomaticsub': auto or allow_auto_fallback,
            'subtitleslangs': [lang],
            'subtitlesformat': 'vtt/srt', # Prefer VTT, allow SRT when available
            'noplaylist': True,
            
            # Additional workarounds for HTTP 429 (Too Many Requests)
            'sleep_interval': 1,
            'max_sleep_interval': 5,
            # Browser TLS fingerprint: required by YouTube since 2025
            'impersonate': ImpersonateTarget('chrome'),
            'extractor_args': {'youtube': {'player_client': ['mweb']}},
            'remote_components': ['ejs:github'],
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }
        
        def stop_hook(d):
            if worker_obj and hasattr(worker_obj, 'is_stop_requested') and worker_obj.is_stop_requested():
                raise Exception("Скачивание прервано пользователем")
                
        ydl_opts['progress_hooks'] = [stop_hook]
        
        # We add a retry loop because YouTube often temporarily blocks quick consecutive requests
        max_retries = 3
        for attempt in range(max_retries):
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=True)
                
                # Predict filename
                # Subtitles are usually saved as filename.lang.vtt
                # We need to find the file that was actually created.
                # requested_downloads might not be populated for skip_download=True
                
                # Let's look for the file in the output dir that matches the pattern
                # info['title'] might be sanitized differently.
                # Best bet: use prepare_filename to get base, then check extensions
                
                filename_base = ydl.prepare_filename(info)
                base, _ = os.path.splitext(filename_base)
                
                # yt-dlp naming: base.lang.vtt / base.lang.srt
                expected_vtt = f"{base}.{lang}.vtt"
                expected_srt = f"{base}.{lang}.srt"
                
                if os.path.exists(expected_srt) and not is_vtt:
                    return expected_srt
                if os.path.exists(expected_vtt) and is_vtt:
                    return expected_vtt
                if os.path.exists(expected_vtt) and not is_vtt:
                    out_srt = os.path.splitext(expected_vtt)[0] + ".srt"
                    return vtt_to_srt(expected_vtt, out_srt)
                if os.path.exists(expected_srt) and is_vtt:
                    return expected_srt
                
                # Try finding any vtt file with that base
                # This is a bit hacky but yt-dlp naming can be tricky
                for f in os.listdir(self.output_dir):
                    if f.startswith(os.path.basename(base)) and f.endswith(f".{lang}.srt"):
                        if not is_vtt:
                            return os.path.join(self.output_dir, f)
                        return os.path.join(self.output_dir, f)
                    if f.startswith(os.path.basename(base)) and f.endswith(f".{lang}.vtt"):
                        p = os.path.join(self.output_dir, f)
                        if is_vtt:
                            return p
                        out_srt = os.path.splitext(p)[0] + ".srt"
                        return vtt_to_srt(p, out_srt)
                        
                return None
                
            except yt_dlp.utils.DownloadError as e:
                # Catch specific yt-dlp errors to implement waiting
                import time
                if '429' in str(e) or 'Too Many Requests' in str(e):
                    if attempt < max_retries - 1:
                        wait_time = 5 * (attempt + 1)
                        self.logger.warning(f"HTTP 429 encountered. Waiting {wait_time}s before retry {attempt+1}/{max_retries}...")
                        time.sleep(wait_time)
                        continue
                self.logger.error(f"Subtitle download failed on attempt {attempt+1}: {e}")
                raise
            except Exception as e:
                self.logger.error(f"Subtitle download failed globally: {e}")
                raise
