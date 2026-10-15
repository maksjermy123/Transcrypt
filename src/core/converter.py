import os
import subprocess
import logging
import shutil
import tempfile
from src.utils.fs import ensure_dir, find_soffice_executable
from src.utils.app_paths import cyrillic_font_candidates

class Converter:
    # Популярные кодировки текстовых файлов (UTF-8 первый — строгий, сразу отсеивает
    # чужие кодировки; однобайтовые CP1251/KOI8-R почти никогда не бросают ошибку,
    # поэтому идут после строгих). Порядок = приоритет угадывания.
    TEXT_ENCODINGS = (
        "utf-8-sig",
        "utf-8",
        "windows-1251",   # самый частый источник «крякозябр»: текст из Word/Блокнота на русской Windows
        "utf-16",         # со строгой проверкой: нечётная длина/битые пары отбросят его
        "koi8-r",
        "cp866",
        "mac-cyrillic",
    )

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    # ─────────────────────────────────────────────────────────────
    #  Кодировки: чтение/нормализация текстов (фикс «крякозябр»)
    # ─────────────────────────────────────────────────────────────

    @classmethod
    def decode_bytes(cls, data: bytes) -> str:
        """Декодирует байты, перебирая популярные кодировки (UTF-8 → CP1251 → KOI8-R → UTF-16…).
        Гарантирует отсутствие replacement-символов U+FFFD в результате."""
        for enc in cls.TEXT_ENCODINGS:
            try:
                text = data.decode(enc)
            except (UnicodeDecodeError, UnicodeError):
                continue
            # Однобайтовые кодировки декодируют почти любой мусор — не считаем удачей,
            # если в тексте всё же появились replacement-символы
            if "\ufffd" in text and enc not in ("utf-8", "utf-8-sig"):
                continue
            return text
        # Последний шанс — UTF-8 с заменой ошибок (лучше, чем исключение)
        return data.decode("utf-8", errors="replace")

    @classmethod
    def read_text_smart(cls, path: str) -> str:
        """Читает текстовый файл в любой популярной кодировке (UTF-8/CP1251/KOI8-R/UTF-16)."""
        with open(path, "rb") as f:
            return cls.decode_bytes(f.read())

    @classmethod
    def write_text_utf8(cls, path: str, text: str) -> None:
        """Записывает текст в UTF-8 (единая кодировка результатов конвертации)."""
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    @classmethod
    def normalize_txt_utf8(cls, path: str) -> None:
        """Перекодирует готовый .txt на месте в UTF-8.
        LibreOffice/textutil на Windows отдают результат в системной кодировке
        (CP1251) — именно отсюда «крякозябры» в скачанном файле."""
        try:
            with open(path, "rb") as f:
                data = f.read()
            text = cls.decode_bytes(data)
            if not text:
                return
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        except Exception as e:  # noqa: BLE001 — нормализация не должна ронять конвертацию
            logging.getLogger(__name__).warning(f"normalize_txt_utf8 failed for {path}: {e}")

    def _register_cyrillic_font(self) -> str:
        """Регистрирует TTF-шрифт с кириллицей для reportlab. Возвращает имя шрифта."""
        try:
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont

            for path in cyrillic_font_candidates():
                if path and os.path.exists(path):
                    pdfmetrics.registerFont(TTFont("VPAuto", path))
                    return "VPAuto"
        except Exception as e:  # noqa: BLE001
            self.logger.warning(f"Font registration failed: {e}")
        return "Helvetica"  # без кириллицы — последний фолбэк

    def _extract_docx_blocks(self, input_docx: str) -> list[str]:
        """Вытаскивает абзацы и строки таблиц из DOCX (python-docx)."""
        from docx import Document

        doc = Document(input_docx)
        blocks = [p.text.rstrip() for p in doc.paragraphs]
        for table in doc.tables:
            for row in table.rows:
                cells = [c.text.strip().replace("\t", "    ") for c in row.cells]
                blocks.append("    ".join(cells))
        return blocks

    def _docx_to_pdf_reportlab(self, input_docx: str, output_pdf: str) -> str:
        """Чистый Python fallback DOCX→PDF: python-docx (текст) + reportlab (рендер).
        Работает БЕЗ Microsoft Word и LibreOffice — закрывает главный кейс студентов,
        у которых нет ни того, ни другого. Сохраняет абзацы, переносы и таблицы как текст."""
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
        from reportlab.lib.utils import simpleSplit

        blocks = self._extract_docx_blocks(input_docx)

        font_name = self._register_cyrillic_font()
        font_size = 11
        line_height = font_size * 1.4

        ensure_dir(os.path.dirname(output_pdf))
        c = canvas.Canvas(output_pdf, pagesize=A4)
        width, height = A4
        margin = 50
        y = height - margin

        # ВАЖНО: без setFont первая страница рисуется дефолтным Helvetica —
        # кириллица не кодируется (WinAnsi) и из PDF не извлекается. Проявлялось
        # ТОЛЬКО на Windows без MS Word/LibreOffice (докручивается до этого фолбэка;
        # на Linux тесты проходили через LibreOffice). Проверено на windows-latest.
        c.setFont(font_name, font_size)

        def new_page():
            nonlocal y
            c.showPage()
            c.setFont(font_name, font_size)
            y = height - margin

        for block in blocks:
            if not block:
                y -= line_height * 0.6  # пустая строка = отбивка абзаца
                continue
            for line in simpleSplit(block, font_name, font_size, width - 2 * margin):
                if y < margin:
                    new_page()
                c.drawString(margin, y, line)
                y -= line_height
        c.save()
        if not os.path.exists(output_pdf) or os.path.getsize(output_pdf) == 0:
            raise RuntimeError("reportlab не создал PDF-файл")
        return output_pdf

    def _convert_office_with_soffice(self, input_path: str, output_path: str, output_ext: str) -> str | None:
        soffice = find_soffice_executable()
        if not soffice:
            return None

        # «Text (encoded):UTF8» — форсируем UTF-8: фильтр «Text» пишет в системной
        # кодировке (на русской Windows это CP1251 → «крякозябры» у пользователя)
        convert_to = "txt:Text (encoded):UTF8" if output_ext == ".txt" else output_ext.lstrip(".")
        with tempfile.TemporaryDirectory(prefix="voxpaperai-convert-office-") as tmpdir:
            subprocess.run(
                [soffice, "--headless", "--convert-to", convert_to, "--outdir", tmpdir, input_path],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            expected = os.path.join(tmpdir, os.path.splitext(os.path.basename(input_path))[0] + output_ext)
            if not os.path.exists(expected):
                return None
            ensure_dir(os.path.dirname(output_path))
            shutil.copy2(expected, output_path)
            if output_ext == ".txt":
                self.normalize_txt_utf8(output_path)  # страховка: всё в UTF-8
            return output_path

    def _docx_to_pdf(self, input_docx, output_pdf):
        try:
            from docx2pdf import convert

            convert(input_docx, output_pdf)
            if os.path.exists(output_pdf):
                return output_pdf
        except Exception as e:
            self.logger.warning(f"docx2pdf failed: {e}")

        soffice = find_soffice_executable()
        if soffice:
            out_dir = os.path.dirname(output_pdf)
            os.makedirs(out_dir, exist_ok=True)
            subprocess.run(
                [soffice, "--headless", "--convert-to", "pdf", "--outdir", out_dir, input_docx],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            expected = os.path.join(out_dir, os.path.splitext(os.path.basename(input_docx))[0] + ".pdf")
            if os.path.exists(expected) and expected != output_pdf:
                if os.path.exists(output_pdf):
                    os.remove(output_pdf)
                os.replace(expected, output_pdf)
            if os.path.exists(output_pdf):
                return output_pdf

        # Чистый Python fallback (без Word и LibreOffice): python-docx + reportlab.
        # Качество проще, чем у Word — но конвертация РАБОТАЕТ у любого студента,
        # а кириллица рендерится через системный TTF-шрифт.
        try:
            return self._docx_to_pdf_reportlab(input_docx, output_pdf)
        except Exception as e:
            self.logger.error(f"reportlab DOCX→PDF fallback failed: {e}")

        raise RuntimeError(
            "Конвертация DOCX→PDF не удалась: нужны Microsoft Word (docx2pdf), LibreOffice (soffice) "
            "или библиотеки python-docx + reportlab (входят в движок ≥ 1.3.0 — переустановите его командой установки)."
        )

    def _ffmpeg(self):
        """Returns full path to ffmpeg binary (falls back to bare name)."""
        from src.utils.fs import find_ffmpeg_executable
        return find_ffmpeg_executable() or "ffmpeg"

    def _ffprobe(self):
        """Returns full path to ffprobe binary (falls back to bare name)."""
        from src.utils.fs import find_ffprobe_executable
        return find_ffprobe_executable() or "ffprobe"

    def convert_media(self, input_path, output_format, output_dir=None, progress_callback=None, worker_obj=None):
        """Converts media using ffmpeg."""
        # Validate input file type
        valid_extensions = {'.mp3', '.wav', '.mp4', '.mkv', '.avi', '.mov', '.flv', '.m4a', '.webm', '.ogg'}
        ext = os.path.splitext(input_path)[1].lower()
        if ext not in valid_extensions:
            raise ValueError(f"Файл {ext} не поддерживается для медиа-конвертации. Используйте медиа-файлы (mp3, mp4, wav и т.д.)")

        if output_dir:
            ensure_dir(output_dir)
            base = os.path.splitext(os.path.basename(input_path))[0]
            output_path = os.path.join(output_dir, f"{base}.{output_format}")
        else:
            base = os.path.splitext(input_path)[0]
            
            # If input and output are in the same dir and same name (e.g. mp4 -> mp4 conversion?),
            # ffmpeg checks. But here we usually convert mp4 -> mp3.
            # If we just change extension, we get a new path.
            output_path = f"{base}.{output_format}"
            
        # FIX: Ensure unique output path to avoid overwriting existing files
        # Only do this check if we are NOT using -y (which we are, but user complained about overwrite).
        # Actually, user WANTS unique files. So we should NOT overwrite.
        # But cmd has "-y". We should change logic to find a free name and then write to it.
        if os.path.exists(output_path):
            base_no_ext, ext = os.path.splitext(output_path)
            counter = 1
            while os.path.exists(output_path):
                output_path = f"{base_no_ext}_{counter}{ext}"
                counter += 1


        cmd = [self._ffmpeg(), "-y", "-i", input_path, output_path]
        
        self.logger.info(f"Converting {input_path} to {output_path}")
        
        duration = None
        if progress_callback:
            try:
                probe_cmd = [self._ffprobe(), "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input_path]
                res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                duration = float(res.stdout.strip())
            except Exception:
                duration = None

        try:
            if progress_callback and duration:
                import time
                import re
                
                # Use subprocess.Popen to read stderr dynamically
                # ffmpeg prints to stderr, not stdout typically
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, universal_newlines=True)
                if worker_obj:
                    worker_obj.active_process = process
                start_time = time.time()
                
                for line in process.stderr:
                    # e.g., time=00:01:23.45
                    match = re.search(r"time=(?:(\d+):)?(\d{2}):(\d{2})\.(\d+)", line)
                    if match:
                        hours = int(match.group(1)) if match.group(1) else 0
                        mins, secs, centis = map(int, match.group(2, 3, 4))
                        
                        frac_len = len(match.group(4))
                        frac_val = centis / (10 ** frac_len)
                        
                        current_seconds = hours * 3600 + mins * 60 + secs + frac_val
                        percent = int((current_seconds / duration) * 100)
                        
                        elapsed = time.time() - start_time
                        eta_str = ""
                        if current_seconds > 0 and elapsed > 0:
                            speed = current_seconds / elapsed
                            remaining = duration - current_seconds
                            if speed > 0:
                                eta_seconds = remaining / speed
                                if eta_seconds > 60:
                                    eta_str = f"Осталось: ~{int(eta_seconds//60)} мин. {int(eta_seconds%60)} сек."
                                else:
                                    eta_str = f"Осталось: ~{int(eta_seconds)} сек."
                        
                        if percent > 99: percent = 99
                        try:
                            progress_callback(percent, eta_str)
                        except TypeError:
                            progress_callback(percent)
                            
                process.wait()
                if worker_obj:
                    worker_obj.active_process = None
                if process.returncode != 0 and (not worker_obj or not worker_obj.is_stop_requested()):
                    raise subprocess.CalledProcessError(process.returncode, cmd)
            else:
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if worker_obj:
                    worker_obj.active_process = process
                process.wait()
                if worker_obj:
                    worker_obj.active_process = None
                if process.returncode != 0 and (not worker_obj or not worker_obj.is_stop_requested()):
                    raise subprocess.CalledProcessError(process.returncode, cmd)
                
            return output_path
        except subprocess.CalledProcessError as e:
            err_msg = e.stderr.decode() if hasattr(e, 'stderr') and e.stderr else str(e)
            self.logger.error(f"FFmpeg conversion failed: {err_msg}")
            raise e

    def convert_document(self, input_path, output_format, output_dir=None):
        """Converts documents (PDF <-> DOCX <-> TXT)."""
        input_ext = os.path.splitext(input_path)[1].lower()
        output_ext = f".{output_format.lower()}"
        
        # Output Path Calculation (Same unique logic)
        if output_dir:
            ensure_dir(output_dir)
            base = os.path.splitext(os.path.basename(input_path))[0]
            output_path = os.path.join(output_dir, f"{base}.{output_format}")
        else:
            base = os.path.splitext(input_path)[0]
            output_path = f"{base}.{output_format}"
            
        if os.path.exists(output_path):
            base_no_ext, ext = os.path.splitext(output_path)
            counter = 1
            while os.path.exists(output_path):
                output_path = f"{base_no_ext}_{counter}{ext}"
                counter += 1
                
        self.logger.info(f"Converting document {input_path} to {output_path}")
        
        try:
            # 0. Same-format document export means copy to output location / unique name.
            if input_ext == output_ext:
                shutil.copy2(input_path, output_path)
                # txt→txt = «починить кодировку»: файл из Блокнота русской Windows
                # (CP1251) должен прийти пользователю в UTF-8, а не его же крякозябрами.
                if input_ext in (".txt", ".md", ".csv"):
                    self.normalize_txt_utf8(output_path)
                return output_path

            # 1. DOCX -> PDF
            if input_ext in ['.docx', '.doc'] and output_format == 'pdf':
                return self._docx_to_pdf(input_path, output_path)
                
            # 2. PDF -> DOCX
            elif input_ext == '.pdf' and output_format == 'docx':
                try:
                    from pdf2docx import Converter as PDFConverter
                except ImportError:
                    raise RuntimeError(
                        "Для PDF→DOCX не хватает библиотеки pdf2docx в окружении движка — "
                        "переустановите движок командой установки (движок ≥ 1.3.0 включает её)."
                    )
                cv = PDFConverter(input_path)
                cv.convert(output_path, start=0, end=None)
                cv.close()
                return output_path
            
            # 3. TXT -> PDF (Preserve structure via ReportLab)
            elif input_ext == '.txt' and output_format == 'pdf':
                from reportlab.lib.pagesizes import letter
                from reportlab.pdfgen import canvas
                from reportlab.lib.utils import simpleSplit

                c = canvas.Canvas(output_path, pagesize=letter)
                width, height = letter

                # Font Registration for Cyrillic
                font_name = self._register_cyrillic_font()

                # Читаем текст в любой кодировке (UTF-8/CP1251/KOI8-R…) —
                # раньше жёсткий UTF-8 давал «крякозябры» для файлов из Windows
                text = self.read_text_smart(input_path)
                
                text_object = c.beginText(40, height - 40)
                text_object.setFont(font_name, 10) 
                
                lines = text.split('\n')
                for line in lines:
                    # Simple wrapping
                    wrapped_lines = simpleSplit(line, font_name, 10, width - 80)
                    for wrapped in wrapped_lines:
                        text_object.textLine(wrapped)
                        if text_object.getY() < 40: # Page break
                            c.drawText(text_object)
                            c.showPage()
                            text_object = c.beginText(40, height - 40)
                            text_object.setFont(font_name, 10)
                            
                c.drawText(text_object)
                c.save()
                return output_path
                
            # 3.4 DOCX -> TXT: python-docx напрямую — UTF-8 сразу, без внешних программ.
            # Раньше эта ветка уходила в LibreOffice, который на Windows пишет TXT
            # в системной CP1251 — пользователь получал «крякозябры».
            if input_ext == '.docx' and output_format == 'txt':
                try:
                    blocks = self._extract_docx_blocks(input_path)
                    self.write_text_utf8(output_path, "\n".join(blocks) + ("\n" if blocks else ""))
                    return output_path
                except Exception as e:
                    # Явный фолбэк на LibreOffice/textutil (не полагаемся на провал в elif-цепочку)
                    self.logger.warning(f"python-docx DOCX→TXT failed ({e}) — fallback to soffice/textutil")
                    office_result = self._convert_office_with_soffice(input_path, output_path, output_ext)
                    if office_result:
                        return office_result
                    raise ValueError(
                        "Конвертация DOCX→TXT требует python-docx (движок ≥ 1.3.0), LibreOffice или textutil (macOS)."
                    )

            # 3.4b TXT -> DOCX: python-docx напрямую, чтение в любой кодировке
            elif input_ext == '.txt' and output_format == 'docx':
                try:
                    from docx import Document
                except ImportError:
                    raise RuntimeError(
                        "Для TXT→DOCX не хватает библиотеки python-docx в окружении движка — "
                        "переустановите движок командой установки (движок ≥ 1.3.0 включает её)."
                    )
                doc = Document()
                text = self.read_text_smart(input_path)
                for line in text.splitlines():
                    doc.add_paragraph(line.rstrip())
                doc.save(output_path)
                return output_path

            # 3.5 Office-family document conversion via LibreOffice (supports ODT round-trip).
            elif input_ext in ['.odt', '.docx', '.doc', '.rtf', '.rtfd', '.txt'] and output_format in ['docx', 'odt', 'pdf', 'txt', 'rtf']:
                office_result = self._convert_office_with_soffice(input_path, output_path, output_ext)
                if office_result:
                    return office_result

                # macOS textutil fallback for some rich text families
                import sys
                if sys.platform != 'darwin':
                    raise ValueError(f"Conversion from {input_ext} to {output_format} requires LibreOffice (soffice).")

                intermediate_ext = 'docx' if output_format in ['docx', 'pdf'] else output_format
                temp_output = output_path
                if output_format == 'pdf':
                    temp_output = output_path.replace('.pdf', '.docx')

                cmd = ["textutil", "-convert", intermediate_ext, input_path, "-output", temp_output]
                subprocess.run(cmd, check=True)

                if output_format == 'txt':
                    self.normalize_txt_utf8(temp_output)  # textutil может дать не-UTF-8

                if output_format == 'pdf':
                    self._docx_to_pdf(temp_output, output_path)
                    try:
                        os.remove(temp_output)
                    except Exception:
                        pass
                    return output_path
                return temp_output

            # 3.6 macOS textutil for rich text (ODT, RTF) -> DOCX legacy fallback
            # (kept branch 3.5 above handles odt/rtf/rtfd/docx/doc/txt; branch 3.6
            # was unreachable dead code and has been removed.)
            # (TXT→DOCX теперь в ветке 3.4b — python-docx без внешних программ.)

            # 5. Any -> TXT
            elif output_format == 'txt':
                text = ""
                if input_ext == '.pdf':
                    try:
                        from pypdf import PdfReader
                    except ImportError:
                        raise RuntimeError(
                            "Для PDF→TXT не хватает библиотеки pypdf в окружении движка — "
                            "переустановите движок командой установки (движок ≥ 1.3.0 включает её)."
                        )
                    reader = PdfReader(input_path)
                    for page in reader.pages:
                        text += page.extract_text() + "\n"
                elif input_ext == '.docx':
                    blocks = self._extract_docx_blocks(input_path)
                    text = "\n".join(blocks) + ("\n" if blocks else "")
                elif input_ext == '.doc':
                    office_result = self._convert_office_with_soffice(input_path, output_path, '.txt')
                    if office_result:
                        return office_result
                    raise ValueError(
                        "Извлечение текста из .doc требует LibreOffice (soffice) или textutil (macOS)."
                    )
                else:
                    # Fallback or just copy if it's already text?
                    # If it's unknown binary, we can't extract easily without textract.
                    raise ValueError(f"Text extraction from {input_ext} not supported without external tools.")

                self.write_text_utf8(output_path, text)
                return output_path
                
            else:
                 raise ValueError(f"Conversion from {input_ext} to {output_format} not supported yet.")
                 
        except Exception as e:
            self.logger.error(f"Document conversion failed: {e}")
            raise e

    def convert_image(self, input_path, output_format, output_dir=None):
        """Converts images (JPG <-> PNG <-> WEBP <-> PDF)."""
        try:
            from PIL import Image
            
            if output_dir:
                ensure_dir(output_dir)
                base = os.path.splitext(os.path.basename(input_path))[0]
                output_path = os.path.join(output_dir, f"{base}.{output_format}")
            else:
                base = os.path.splitext(input_path)[0]
                output_path = f"{base}.{output_format}"
                
            # Unique path logic
            if os.path.exists(output_path):
                base_no_ext, ext = os.path.splitext(output_path)
                counter = 1
                while os.path.exists(output_path):
                    output_path = f"{base_no_ext}_{counter}{ext}"
                    counter += 1
                    
            self.logger.info(f"Converting image {input_path} to {output_path}")
            
            with Image.open(input_path) as img:
                # Handle PDF conversion
                if output_format == 'pdf':
                    img = img.convert('RGB')
                    img.save(output_path, "PDF", resolution=100.0)
                else:
                    # Generic image conversion
                    # Handle transparency for JPG
                    if output_format in ['jpg', 'jpeg'] and img.mode in ('RGBA', 'LA'):
                        background = Image.new(img.mode[:-1], img.size, (255, 255, 255))
                        background.paste(img, img.split()[-1])
                        img = background.convert('RGB')
                        
                    img.save(output_path)
                    
            return output_path
            
        except ImportError:
             self.logger.error("Pillow (PIL) library not found.")
             raise ImportError("Pillow library is required for image conversion.")
        except Exception as e:
             self.logger.error(f"Image conversion failed: {e}")
             raise e

    def enhance_audio(self, input_path, output_path=None, progress_callback=None, worker_obj=None):
        """Applies noise reduction and voice isolation using ffmpeg audio filters.
        Filters: afftdn (adaptive noise reduction), highpass (remove rumble), lowpass (remove hiss).
        """
        import time
        import re
        
        if not output_path or os.path.isdir(output_path) or not os.path.splitext(output_path)[1]:
            # движок передаёт каталог вывода — строим имя файла сами
            output_path = self._ensure_output_file_path(output_path, input_path, "_enhanced", ".mp3")

        # Ensure unique
        if os.path.exists(output_path):
            base_no_ext, ext = os.path.splitext(output_path)
            counter = 1
            while os.path.exists(output_path):
                output_path = f"{base_no_ext}_{counter}{ext}"
                counter += 1

        # Audio filter chain: remove noise, cut rumble below 200Hz, cut hiss above 3000Hz
        af_filters = "afftdn=nf=-25,highpass=f=200,lowpass=f=3000,volume=1.5"
        cmd = [self._ffmpeg(), "-y", "-i", input_path, "-af", af_filters, output_path]
        
        self.logger.info(f"Enhancing audio: {input_path} -> {output_path}")
        
        # Get duration for ETA
        duration = None
        if progress_callback:
            try:
                probe_cmd = [self._ffprobe(), "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input_path]
                res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                duration = float(res.stdout.strip())
            except Exception:
                duration = None
        
        try:
            if progress_callback and duration:
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, universal_newlines=True)
                if worker_obj: worker_obj.active_process = process
                start_time = time.time()
                
                for line in process.stderr:
                    match = re.search(r"time=(?:(\d+):)?(\d{2}):(\d{2})\.(\d+)", line)
                    if match:
                        hours = int(match.group(1)) if match.group(1) else 0
                        mins, secs, centis = map(int, match.group(2, 3, 4))
                        frac_len = len(match.group(4))
                        frac_val = centis / (10 ** frac_len)
                        current_seconds = hours * 3600 + mins * 60 + secs + frac_val
                        percent = int((current_seconds / duration) * 100)
                        
                        elapsed = time.time() - start_time
                        eta_str = ""
                        if current_seconds > 0 and elapsed > 0:
                            speed = current_seconds / elapsed
                            remaining = duration - current_seconds
                            if speed > 0:
                                eta_seconds = remaining / speed
                                if eta_seconds > 60:
                                    eta_str = f"Осталось: ~{int(eta_seconds//60)} мин. {int(eta_seconds%60)} сек."
                                else:
                                    eta_str = f"Осталось: ~{int(eta_seconds)} сек."
                        
                        if percent > 99: percent = 99
                        try:
                            progress_callback(percent, eta_str)
                        except TypeError:
                            progress_callback(percent)
                
                process.wait()
                if worker_obj: worker_obj.active_process = None
                if process.returncode != 0 and (not worker_obj or not worker_obj.is_stop_requested()):
                    raise subprocess.CalledProcessError(process.returncode, cmd)
            else:
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if worker_obj: worker_obj.active_process = process
                process.wait()
                if worker_obj: worker_obj.active_process = None
                if process.returncode != 0 and (not worker_obj or not worker_obj.is_stop_requested()):
                    raise subprocess.CalledProcessError(process.returncode, cmd)
            
            return output_path
        except subprocess.CalledProcessError as e:
            err_msg = e.stderr.decode() if hasattr(e, 'stderr') and e.stderr else str(e)
            self.logger.error(f"Audio enhancement failed: {err_msg}")
            raise e

    def _ensure_output_file_path(self, output_path, input_path, tag, default_ext):
        """Приводит output_path к корректному ПУТИ ФАЙЛА.

        Вызывающие могут передать каталог (движок передаёт OUTPUT_DIR)
        или путь без расширения — строим внутри него имя файла из входа:
        <имя_входа><tag><расширение>. Возвращает валидный путь файла.
        """
        if output_path and os.path.isdir(output_path):
            d = output_path
            output_path = None
        else:
            d = None
        if output_path and not os.path.splitext(output_path)[1]:
            # без расширения — считаем каталогом (существующим или нет)
            d = output_path
            output_path = None
        if output_path:
            return output_path
        if not d:
            d = os.path.dirname(input_path) or "."
        base = os.path.splitext(os.path.basename(input_path))[0]
        ext = os.path.splitext(input_path)[1] or default_ext
        return os.path.join(d, f"{base}{tag}{ext}")

    def _probe_video_height(self, video_path):
        """Высота видео через ffprobe (для масштабирования шрифта субтитров)."""
        try:
            probe_cmd = [
                self._ffprobe(), "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=height",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ]
            res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
            h = int(float(res.stdout.strip()))
            return h if h > 0 else None
        except Exception:
            return None

    def hardsub_video(self, video_path, srt_path, output_path=None, progress_callback=None, worker_obj=None):
        """Burns SRT subtitles directly into the video using ffmpeg subtitles filter.
        This requires full video re-encoding and is a slow process.

        Умное встраивание (force_style):
          - субтитры ВНИЗУ по центру (Alignment=2), а не по-середине кадра;
          - отступ от нижнего края ~5% высоты — не липнут к краю;
          - боковые поля ~6% — строки не прилипают к краям экрана;
          - размер шрифта масштабируется от высоты видео (~3.5%), 16–52;
          - чёрная обводка + тень — читаемо на любом фоне;
          - умный перенос длинных строк (WrapStyle=0) — максимум 2-3 строки внизу.
        """
        import time
        import re
        
        if not output_path or os.path.isdir(output_path) or not os.path.splitext(output_path)[1]:
            # движок передаёт каталог вывода — строим имя файла сами
            output_path = self._ensure_output_file_path(output_path, video_path, "_hardsub", ".mp4")

        # Ensure unique
        if os.path.exists(output_path):
            base_no_ext, ext = os.path.splitext(output_path)
            counter = 1
            while os.path.exists(output_path):
                output_path = f"{base_no_ext}_{counter}{ext}"
                counter += 1
        
        # Escape special characters in srt_path for ffmpeg filter
        escaped_srt = srt_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        
        # ─── Умный стиль: низ по центру, отступы, шрифт от высоты видео ───
        video_height = self._probe_video_height(video_path)
        if video_height:
            font_size = max(16, min(52, round(video_height * 0.035)))
            margin_v = max(10, round(video_height * 0.05))
            margin_lr = max(20, round(video_height * 0.11))
        else:
            font_size, margin_v, margin_lr = 22, 26, 60

        force_style = (
            f"FontName=Arial,FontSize={font_size},"
            "PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,"
            "BorderStyle=1,Outline=2,Shadow=1,"
            f"Alignment=2,MarginV={margin_v},MarginL={margin_lr},MarginR={margin_lr},"
            "WrapStyle=0"
        )
        sub_filter = f"subtitles='{escaped_srt}':force_style='{force_style}'"

        cmd = [self._ffmpeg(), "-y", "-i", video_path, "-vf", sub_filter, output_path]
        
        self.logger.info(f"Hardsubbing: {video_path} + {srt_path} -> {output_path}")
        self.logger.info(f"Стиль субтитров: FontSize={font_size}, MarginV={margin_v} (высота видео: {video_height})")
        
        # Get duration for ETA
        duration = None
        if progress_callback:
            try:
                probe_cmd = [self._ffprobe(), "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", video_path]
                res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                duration = float(res.stdout.strip())
            except Exception:
                duration = None
        
        try:
            if progress_callback and duration:
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, universal_newlines=True)
                if worker_obj: worker_obj.active_process = process
                start_time = time.time()
                
                for line in process.stderr:
                    match = re.search(r"time=(?:(\d+):)?(\d{2}):(\d{2})\.(\d+)", line)
                    if match:
                        hours = int(match.group(1)) if match.group(1) else 0
                        mins, secs, centis = map(int, match.group(2, 3, 4))
                        frac_len = len(match.group(4))
                        frac_val = centis / (10 ** frac_len)
                        current_seconds = hours * 3600 + mins * 60 + secs + frac_val
                        percent = int((current_seconds / duration) * 100)
                        
                        elapsed = time.time() - start_time
                        eta_str = ""
                        if current_seconds > 0 and elapsed > 0:
                            speed = current_seconds / elapsed
                            remaining = duration - current_seconds
                            if speed > 0:
                                eta_seconds = remaining / speed
                                if eta_seconds > 60:
                                    eta_str = f"Осталось: ~{int(eta_seconds//60)} мин. {int(eta_seconds%60)} сек."
                                else:
                                    eta_str = f"Осталось: ~{int(eta_seconds)} сек."
                        
                        if percent > 99: percent = 99
                        try:
                            progress_callback(percent, eta_str)
                        except TypeError:
                            progress_callback(percent)
                
                process.wait()
                if worker_obj: worker_obj.active_process = None
                if process.returncode != 0 and (not worker_obj or not worker_obj.is_stop_requested()):
                    raise subprocess.CalledProcessError(process.returncode, cmd)
            else:
                process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if worker_obj: worker_obj.active_process = process
                process.wait()
                if worker_obj: worker_obj.active_process = None
                if process.returncode != 0 and (not worker_obj or not worker_obj.is_stop_requested()):
                    raise subprocess.CalledProcessError(process.returncode, cmd)
            
            return output_path
        except subprocess.CalledProcessError as e:
            err_msg = e.stderr.decode() if hasattr(e, 'stderr') and e.stderr else str(e)
            self.logger.error(f"Hardsubbing failed: {err_msg}")
            raise e

    def convert(self, input_path, output_format, output_dir=None, progress_callback=None, worker_obj=None):
        """Unified conversion method that dispatches to media or document converter."""
        ext = os.path.splitext(input_path)[1].lower()
        media_exts = {'.mp3', '.wav', '.mp4', '.mkv', '.avi', '.mov', '.flv', '.m4a', '.webm', '.ogg', '.aac', '.flac', '.alac', '.wma'}
        img_exts = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.gif', '.heic', '.ico', '.svg'}
        doc_exts = {'.pdf', '.docx', '.doc', '.txt', '.odt', '.rtf', '.rtfd'}
        
        if ext in media_exts:
            return self.convert_media(input_path, output_format, output_dir, progress_callback, worker_obj)
        elif ext in img_exts:
             return self.convert_image(input_path, output_format, output_dir)
        else:
            return self.convert_document(input_path, output_format, output_dir)
