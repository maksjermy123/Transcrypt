import os
import time
import logging
import shutil
import tempfile
import subprocess
from deep_translator import GoogleTranslator
from src.utils.fs import find_soffice_executable, unique_path
from src.utils.app_paths import cyrillic_font_candidates
from src.utils.winproc import no_window_kwargs

class Translator:
    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def _read_plain_text_file(self, path: str) -> str:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()

    def _convert_document_to_text(self, path: str) -> str | None:
        ext = os.path.splitext(path)[1].lower()

        # LibreOffice gives the broadest coverage for office documents.
        soffice = find_soffice_executable()
        if soffice:
            with tempfile.TemporaryDirectory(prefix="voxpaperai-read-office-") as tmpdir:
                subprocess.run(
                    [soffice, "--headless", "--convert-to", "txt:Text", "--outdir", tmpdir, path],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    encoding="utf-8", errors="replace",  # без encoding Windows читает CP1251 ('charmap')
                    **no_window_kwargs(),
                )
                converted = os.path.join(tmpdir, os.path.splitext(os.path.basename(path))[0] + ".txt")
                if os.path.exists(converted):
                    return self._read_plain_text_file(converted)

        # macOS textutil is a useful fallback for rich text and Word-family docs.
        if shutil.which("textutil") and ext in {".odt", ".rtf", ".rtfd", ".doc", ".docx"}:
            with tempfile.TemporaryDirectory(prefix="voxpaperai-read-textutil-") as tmpdir:
                converted = os.path.join(tmpdir, os.path.splitext(os.path.basename(path))[0] + ".txt")
                subprocess.run(
                    ["textutil", "-convert", "txt", path, "-output", converted],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    encoding="utf-8", errors="replace",
                    **no_window_kwargs(),
                )
                if os.path.exists(converted):
                    return self._read_plain_text_file(converted)

        return None

    def _iter_table_paragraphs(self, tables):
        for table in tables or []:
            for row in getattr(table, "rows", []) or []:
                for cell in getattr(row, "cells", []) or []:
                    for p in getattr(cell, "paragraphs", []) or []:
                        if p is not None:
                            yield p

    def _iter_doc_paragraphs(self, doc):
        for p in getattr(doc, "paragraphs", []) or []:
            yield p
        for p in self._iter_table_paragraphs(getattr(doc, "tables", []) or []):
            yield p
        for section in getattr(doc, "sections", []):
            for container in (getattr(section, "header", None), getattr(section, "footer", None)):
                if container is None:
                    continue
                for p in getattr(container, "paragraphs", []) or []:
                    yield p
                for p in self._iter_table_paragraphs(getattr(container, "tables", []) or []):
                    yield p

    def _replace_paragraph_text_preserve_runs(self, paragraph, translated: str):
        if paragraph is None:
            return
        translated = translated or ""
        runs = list(getattr(paragraph, "runs", []) or [])
        if not runs:
            paragraph.text = translated
            return
        runs[0].text = translated
        for run in runs[1:]:
            run.text = ""

    def _create_provider(self, provider: str, target_lang: str, api_key: str | None = None):
        provider = (provider or "Google").strip()
        if provider.lower() == "google":
            return GoogleTranslator(source="auto", target=target_lang)
        if provider.lower() == "deepl":
            try:
                from deep_translator import DeeplTranslator
            except Exception as e:
                raise RuntimeError(f"DeepL недоступен: {e}")
            api_key = (api_key or "").strip()
            if not api_key:
                raise RuntimeError("Для DeepL нужен API key (Настройки → Перевод).")
            try:
                return DeeplTranslator(api_key=api_key, source="auto", target=target_lang, use_free_api=True)
            except TypeError:
                return DeeplTranslator(api_key=api_key, source="auto", target=target_lang)
        raise RuntimeError(f"Неизвестный провайдер перевода: {provider}")

    # --- Fallback provider: official Google gtx JSON endpoint ---
    # deep_translator hits translate.google.com/m (HTML). That host is often
    # rate-limited ("too many requests") while the lightweight gtx JSON API on
    # a different host still works. We keep this as an automatic last resort.

    _GTX_URL = "https://translate.googleapis.com/translate_a/single"

    def _gtx_translate(self, text: str, target_lang: str, source_lang: str = "auto") -> str:
        # Google rate-limits by TLS fingerprint (JA3): plain python-requests
        # gets HTTP 429 even with a browser UA, while a real Chrome TLS
        # handshake passes. curl-cffi (already a dependency for yt-dlp)
        # impersonates Chrome's TLS perfectly.
        params = {
            "client": "gtx",
            "sl": source_lang or "auto",
            "tl": target_lang,
            "dt": "t",
            "q": text,
        }
        try:
            from curl_cffi import requests as cf_requests

            resp = cf_requests.get(
                self._GTX_URL,
                params=params,
                timeout=30,
                impersonate="chrome",
            )
        except ImportError:
            import requests as _requests

            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "*/*",
            }
            resp = _requests.get(self._GTX_URL, params=params, timeout=30, headers=headers)
        if resp.status_code == 429 or resp.status_code == 503:
            raise RuntimeError(f"gtx rate limited (HTTP {resp.status_code})")
        resp.raise_for_status()
        data = resp.json()
        # Response shape: [[["translated","original",...],...], ...]
        sentences = data[0] if data and isinstance(data[0], list) else []
        return "".join(s[0] for s in sentences if s and s[0])

    def _translate_chunk_with_fallback(self, translator, chunk: str, target_lang: str) -> str:
        """Try the primary provider, then fall back to the gtx endpoint."""
        try:
            return translator.translate(chunk)
        except Exception as primary_error:
            try:
                return self._gtx_translate(chunk, target_lang)
            except Exception as fallback_error:
                self.logger.warning(
                    f"Primary provider failed ({primary_error}); "
                    f"gtx fallback also failed ({fallback_error})"
                )
                raise primary_error

    @staticmethod
    def _split_text_chunks(text: str, chunk_size: int = 1200) -> list[str]:
        """Split text into chunks on paragraph/sentence/word boundaries.

        Never cuts in the middle of a word, which previously produced
        translation artifacts and HTTP errors from the provider.
        """
        text = text or ""
        if len(text) <= chunk_size:
            return [text] if text else []

        chunks: list[str] = []
        remaining = text
        while len(remaining) > chunk_size:
            window = remaining[:chunk_size]
            # Prefer the last paragraph break, then sentence end, then space.
            cut = max(window.rfind("\n"), window.rfind(". "), window.rfind("! "), window.rfind("? "))
            if cut < chunk_size // 2:
                cut = window.rfind(" ")
            if cut <= 0:
                cut = chunk_size
            chunks.append(remaining[: cut + 1].rstrip())
            remaining = remaining[cut + 1:].lstrip()
        if remaining:
            chunks.append(remaining)
        return chunks

    def translate_text(self, text, target_lang='ru', progress_callback=None, provider="Google", api_key: str | None = None):
        """Translates text using Google Translator with chunking and retries."""
        if not text:
            return ""

        translator = self._create_provider(provider, target_lang, api_key=api_key)
        chunks = self._split_text_chunks(text, chunk_size=1200)
        translated_chunks = []

        total_chunks = len(chunks)
        start_time = time.time()

        for i, chunk in enumerate(chunks):
            # Retry logic with adaptive backoff: rate-limit errors need long waits
            last_error = None
            for attempt in range(5):
                try:
                    res = self._translate_chunk_with_fallback(translator, chunk, target_lang)
                    translated_chunks.append(res)
                    time.sleep(0.5)  # Gentle delay
                    last_error = None
                    break
                except Exception as e:
                    last_error = e
                    err_text = str(e).lower()
                    if attempt == 4:
                        self.logger.error(f"Chunk translation failed after retries: {e}")
                    else:
                        # Google rate limit ("too many requests"/HTTP 429) is a
                        # temporary per-second/minute throttle — wait it out.
                        if "too many" in err_text or "429" in err_text or "request" in err_text:
                            time.sleep(15 * (attempt + 1))
                        else:
                            time.sleep(2 * (attempt + 1))
            if last_error is not None:
                # Do NOT silently return the original text: the caller would save
                # an untranslated file and report success. Fail loudly instead.
                raise RuntimeError(
                    f"Перевод не выполнен: провайдер вернул ошибку после всех повторов "
                    f"({last_error}). Это обычно временный рейт-лимит (HTTP 429) — "
                    f"подождите 1–2 минуты и повторите."
                )

            # Progress and ETA calculation
            if progress_callback:
                chunks_done = i + 1
                percent = int((chunks_done / total_chunks) * 100)
                elapsed = time.time() - start_time
                speed = chunks_done / elapsed if elapsed > 0 else 0
                eta_str = ""

                if speed > 0:
                    remaining_chunks = total_chunks - chunks_done
                    eta_seconds = remaining_chunks / speed
                    if eta_seconds > 60:
                        eta_str = f"Осталось: ~{int(eta_seconds//60)} мин. {int(eta_seconds%60)} сек."
                    else:
                        eta_str = f"Осталось: ~{int(eta_seconds)} сек."

                if percent > 99: percent = 99

                try:
                    progress_callback(percent, eta_str)
                except TypeError:
                    progress_callback(percent)

        return "".join(translated_chunks)

    def translate_batch(self, texts, target_lang='ru', progress_callback=None, provider="Google", api_key: str | None = None):
        """Translates a list of text strings in larger batches to reduce request count."""
        if not texts:
            return []

        import time

        separator = "\n[[[VOXPAPER_SEG]]]\n"
        max_batch_chars = 2400
        translated: list[str] = [""] * len(texts)
        total = len(texts)
        start_time = time.time()

        batches: list[tuple[list[int], str]] = []
        current_indexes: list[int] = []
        current_parts: list[str] = []
        current_len = 0

        for idx, text in enumerate(texts):
            piece = text or ""
            if not piece.strip():
                translated[idx] = piece
                continue

            piece_len = len(piece) + (len(separator) if current_parts else 0)
            if current_parts and current_len + piece_len > max_batch_chars:
                batches.append((current_indexes, separator.join(current_parts)))
                current_indexes = []
                current_parts = []
                current_len = 0

            current_indexes.append(idx)
            current_parts.append(piece)
            current_len += len(piece) + (len(separator) if len(current_parts) > 1 else 0)

        if current_parts:
            batches.append((current_indexes, separator.join(current_parts)))

        processed_items = 0
        for batch_indexes, batch_text in batches:
            try:
                batch_result = self.translate_text(
                    batch_text,
                    target_lang=target_lang,
                    provider=provider,
                    api_key=api_key,
                )
                parts = batch_result.split(separator) if batch_result else []
            except Exception as e:
                self.logger.warning(f"Batch translation failed, fallback to per-segment mode: {e}")
                parts = []

            if len(parts) == len(batch_indexes):
                for idx, translated_text in zip(batch_indexes, parts):
                    translated[idx] = translated_text
            else:
                # Fallback if provider altered separator or returned malformed text
                for idx in batch_indexes:
                    source_text = texts[idx] or ""
                    try:
                        translated[idx] = self.translate_text(
                            source_text,
                            target_lang=target_lang,
                            provider=provider,
                            api_key=api_key,
                        )
                    except Exception as e:
                        # Do NOT silently keep the original: the caller would save
                        # an untranslated file and report success. Fail loudly.
                        self.logger.error(f"Segment translation failed: {e}")
                        raise

            processed_items += len(batch_indexes)

            if progress_callback:
                percent = int((processed_items / total) * 100)
                elapsed = time.time() - start_time
                speed = processed_items / elapsed if elapsed > 0 else 0
                eta_str = ""
                if speed > 0:
                    remaining_items = total - processed_items
                    eta_seconds = remaining_items / speed
                    if eta_seconds > 60:
                        eta_str = f"Осталось: ~{int(eta_seconds//60)} мин. {int(eta_seconds%60)} сек."
                    else:
                        eta_str = f"Осталось: ~{int(eta_seconds)} сек."
                if percent > 99:
                    percent = 99
                try:
                    progress_callback(percent, eta_str)
                except TypeError:
                    progress_callback(percent)

        for idx, original in enumerate(texts):
            if translated[idx] == "":
                translated[idx] = original or ""
        return translated

    def read_file_content(self, path):
        """Reads content from text-like files (txt/docx/pdf/odt/rtf/...)."""
        ext = os.path.splitext(path)[1].lower()
        if ext in {".txt", ".md", ".json", ".csv", ".log", ".xml", ".srt", ".vtt", ".yaml", ".yml"}:
            return self._read_plain_text_file(path)
        elif ext in [".docx", ".doc"]:
            try:
                import docx

                if ext == ".doc":
                    text = self._convert_document_to_text(path)
                    if text is not None:
                        return text
                    raise RuntimeError("Для чтения .doc нужен LibreOffice (soffice) или textutil.")

                doc = docx.Document(path)
                return "\n".join([p.text for p in doc.paragraphs])
            except ImportError:
                raise ImportError("python-docx not installed")
        elif ext == ".pdf":
            try:
                from pypdf import PdfReader
                reader = PdfReader(path)
                text = ""
                for page in reader.pages:
                    text += page.extract_text() + "\n"
                return text
            except ImportError:
                raise ImportError("pypdf not installed")
        elif ext in {".odt", ".rtf", ".rtfd"}:
            text = self._convert_document_to_text(path)
            if text is not None:
                return text
            raise RuntimeError(f"Для чтения {ext} нужен LibreOffice (soffice) или textutil.")
        return None
        
    def _docx_to_pdf(self, input_docx: str, output_pdf: str) -> tuple[bool, str]:
        # 1) docx2pdf (usually requires MS Word on macOS)
        try:
            from docx2pdf import convert

            convert(input_docx, output_pdf)
            if os.path.exists(output_pdf):
                return True, "OK(docx2pdf)"
        except Exception as e:
            self.logger.warning(f"docx2pdf failed: {e}")

        # 2) LibreOffice (soffice)
        soffice = find_soffice_executable()
        if soffice:
            try:
                import subprocess

                out_dir = os.path.dirname(output_pdf)
                os.makedirs(out_dir, exist_ok=True)
                subprocess.run(
                    [soffice, "--headless", "--convert-to", "pdf", "--outdir", out_dir, input_docx],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    encoding="utf-8", errors="replace",  # без encoding Windows читает CP1251 ('charmap')
                    **no_window_kwargs(),
                )
                expected = os.path.join(out_dir, os.path.splitext(os.path.basename(input_docx))[0] + ".pdf")
                if os.path.exists(expected) and expected != output_pdf:
                    try:
                        if os.path.exists(output_pdf):
                            os.remove(output_pdf)
                    except Exception:
                        pass
                    os.replace(expected, output_pdf)
                if os.path.exists(output_pdf):
                    return True, "OK(soffice)"
            except Exception as e:
                self.logger.warning(f"soffice failed: {e}")

        return False, "Не найден конвертер DOCX→PDF с сохранением разметки. Нужен Microsoft Word (docx2pdf) или LibreOffice (soffice)."

    def translate_document_with_formatting(self, input_path, output_path, target_lang='ru', progress_callback=None, provider="Google", api_key: str | None = None):
        """Translates DOCX/PDF while preserving layout, images, and styles (best-effort)."""
        ext = os.path.splitext(input_path)[1].lower()
        temp_dir = None
        output_ext = os.path.splitext(output_path)[1].lower()
        
        try:
            # 1. If PDF, convert to DOCX first
            if ext == '.pdf':
                if progress_callback:
                    try: progress_callback(5, "Конвертация PDF в DOCX...")
                    except TypeError: progress_callback(5)
                
                try:
                    from pdf2docx import Converter
                    import tempfile

                    temp_dir = tempfile.mkdtemp(prefix="voxpaperai-pdf-layout-")
                    basename = os.path.splitext(os.path.basename(input_path))[0]
                    temp_docx = os.path.join(temp_dir, f"source_{basename}.docx")
                    
                    cv = Converter(input_path)
                    cv.convert(temp_docx, start=0, end=None)
                    cv.close()
                    
                    process_path = temp_docx
                except ImportError:
                    self.logger.error("pdf2docx не установлен")
                    raise RuntimeError("Для режима LAYOUT при переводе PDF нужна библиотека pdf2docx.")
            else:
                process_path = input_path
                
            # 2. Process DOCX with python-docx
            try:
                import docx
            except ImportError:
                raise Exception("python-docx не установлен")
                
            doc = docx.Document(process_path)
            
            # Collect all text items (paragraphs and tables)
            items_to_translate = []
            
            for p in self._iter_doc_paragraphs(doc):
                if p.text.strip():
                    items_to_translate.append(p)
                                
            total_items = len(items_to_translate)
            
            if total_items == 0:
                doc.save(output_path)
                return output_path

            source_texts = [p.text.strip() for p in items_to_translate]

            def _layout_progress(percent, eta_str=""):
                if not progress_callback:
                    return
                scaled = max(5, min(95, int(percent)))
                try:
                    progress_callback(scaled, eta_str)
                except TypeError:
                    progress_callback(scaled)

            translated_texts = self.translate_batch(
                source_texts,
                target_lang=target_lang,
                progress_callback=_layout_progress,
                provider=provider,
                api_key=api_key,
            )

            for paragraph, translated in zip(items_to_translate, translated_texts):
                self._replace_paragraph_text_preserve_runs(paragraph, translated or paragraph.text)
                        
            # 4. Save modified DOCX
            if progress_callback:
                try: progress_callback(98, "Сохранение документа...")
                except TypeError: progress_callback(98)

            if output_ext == ".pdf":
                # Save into temp DOCX first, then export to PDF (requires external helper).
                if temp_dir is None:
                    import tempfile
                    temp_dir = tempfile.mkdtemp(prefix="voxpaperai-docx-layout-")
                base = os.path.splitext(os.path.basename(output_path))[0]
                temp_translated_docx = os.path.join(temp_dir, f"translated_{base}.docx")
                doc.save(temp_translated_docx)
                ok, msg = self._docx_to_pdf(temp_translated_docx, output_path)
                if not ok:
                    raise RuntimeError(msg)
                return output_path

            doc.save(output_path)
            return output_path
            
        finally:
            if temp_dir and os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                except Exception:
                    pass

    def save_translated_file(self, text, original_path, target_lang, output_format, output_dir=None):
        """Saves translated text to file."""
        if not output_dir:
            output_dir = os.path.dirname(original_path)
            
        name_no_ext = os.path.splitext(os.path.basename(original_path))[0]
        out_name = f"TRANS_{target_lang.upper()}_{name_no_ext}.{output_format}"
        out_path = unique_path(os.path.join(output_dir, out_name))
        
        if output_format == "txt":
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(text)
        elif output_format == "docx":
            try:
                from docx import Document
                doc = Document()
                for line in text.split('\n'):
                    if line.strip():
                        doc.add_paragraph(line.strip())
                doc.save(out_path)
            except ImportError:
                with open(out_path + ".txt", "w", encoding="utf-8") as f:
                    f.write(text)
        elif output_format == "pdf":
            try:
                from reportlab.lib.pagesizes import letter
                from reportlab.pdfgen import canvas
                from reportlab.lib.utils import simpleSplit
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.ttfonts import TTFont
                
                c = canvas.Canvas(out_path, pagesize=letter)
                width, height = letter
                
                font_name = "Helvetica" 
                try:
                    font_paths = cyrillic_font_candidates()
                    for path in font_paths:
                        if os.path.exists(path):
                            pdfmetrics.registerFont(TTFont('Arial', path))
                            font_name = 'Arial'
                            break
                except Exception as e:
                    self.logger.warning(f"Cyrillic font not loaded: {e}")

                c.setFont(font_name, 12)
                
                margin = 40
                y = height - margin
                line_height = 14
                
                lines = text.split('\n')
                for line in lines:
                    if not line.strip():
                        y -= line_height
                        continue
                        
                    wrapped_lines = simpleSplit(line, font_name, 12, width - 2*margin)
                    for wl in wrapped_lines:
                        if y < margin:
                            c.showPage()
                            c.setFont(font_name, 12)
                            y = height - margin
                        c.drawString(margin, y, wl)
                        y -= line_height
                        
                c.save()
            except ImportError as e:
                self.logger.error(f"Failed to generate PDF: {e}")
                # Fallback to TXT
                out_path = out_path.replace(".pdf", ".txt")
                with open(out_path, "w", encoding="utf-8") as f:
                    f.write(text)
                    
                    
        return out_path
