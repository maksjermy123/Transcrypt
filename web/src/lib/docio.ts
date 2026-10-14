"use client";

/**
 * docio — чтение и экспорт документов полностью в браузере.
 * Веб-замена частей src/core/translator.py, которым требовались
 * LibreOffice/Word: здесь Word и LibreOffice НЕ НУЖНЫ.
 *
 * Чтение:
 *  - .txt/.md/.csv/...  → FileReader (текст)
 *  - .docx              → mammoth.js (CDN) → текст
 *  - .pdf               → pdf.js (CDN) → текст + позиции строк (для LAYOUT)
 *
 * Экспорт:
 *  - .txt               → Blob
 *  - .docx              → docx.js (CDN, Packer.toBlob)
 *  - .pdf FAST          → pdfmake (CDN, Roboto — кириллица из коробки)
 *  - .pdf LAYOUT        → pdf-lib + fontkit (CDN): перевод накладывается
 *                         поверх оригинальных страниц — картинки и разметка
 *                         сохраняются. Белые плашки закрывают исходный текст.
 */

// ─────────────────────────────────────────────────────────────
//  Динамическая загрузка внешних библиотек (CDN)
// ─────────────────────────────────────────────────────────────

const scriptCache = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  const existing = scriptCache.get(src);
  if (existing) return existing;

  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    document.head.appendChild(el);
  });
  scriptCache.set(src, p);
  return p;
}

async function importEsm(url: string): Promise<any> {
  const dynamicImport = new Function("u", "return import(u)") as (u: string) => Promise<any>;
  return dynamicImport(url);
}

// ─────────────────────────────────────────────────────────────
//  pdf.js — чтение PDF (текст + координаты строк)
// ─────────────────────────────────────────────────────────────

const PDFJS_VERSION = "4.10.38";
let pdfjsPromise: Promise<any> | null = null;

function getPdfJs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await importEsm(
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`
      );
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export type PdfLine = {
  text: string;
  page: number; // 1-based
  x: number; // левый край (PDF-координаты, y снизу)
  y: number; // базовая линия (baseline)
  width: number;
  fontSize: number;
};

export type PdfDoc = {
  numPages: number;
  pages: Array<{
    index: number; // 0-based
    width: number;
    height: number;
    lines: PdfLine[];
  }>;
};

/**
 * Извлекает строки PDF с координатами. Элементы pdf.js группируются
 * в строки по совпадению базовой линии — так перевод контекстно полнее.
 */
export async function loadPdfStructure(
  data: ArrayBuffer,
  onProgress?: (p: number) => void
): Promise<PdfDoc> {
  const pdfjs = await getPdfJs();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages: PdfDoc["pages"] = [];

  for (let p = 0; p < pdf.numPages; p++) {
    const page = await pdf.getPage(p + 1);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    type Item = { str: string; x: number; y: number; w: number; size: number };
    const items: Item[] = [];
    for (const it of textContent.items as any[]) {
      if (!it.str || !it.str.trim()) continue;
      const tr = it.transform as number[];
      // transform: [a,b,c,d,e,f]; e=x, f=y (baseline), d≈масштаб по вертикали
      items.push({
        str: it.str,
        x: tr[4],
        y: tr[5],
        w: it.width ?? 0,
        size: Math.abs(tr[3]) || Math.abs(tr[0]) || 10,
      });
    }

    // Группировка в строки: одинаковая базовая линия (±2)
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const lineMap: Array<{ y: number; items: Item[] }> = [];
    for (const it of items) {
      const line = lineMap.find((l) => Math.abs(l.y - it.y) <= 2);
      if (line) line.items.push(it);
      else lineMap.push({ y: it.y, items: [it] });
    }

    const lines: PdfLine[] = lineMap.map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      // Склейка с пробелами там, где между элементами большой зазор
      let text = "";
      let prevEnd: number | null = null;
      for (const it of l.items) {
        if (prevEnd !== null && it.x - prevEnd > it.size * 0.25 && !text.endsWith(" ")) {
          text += " ";
        }
        text += it.str;
        prevEnd = it.x + it.w;
      }
      const x0 = Math.min(...l.items.map((i) => i.x));
      const x1 = Math.max(...l.items.map((i) => i.x + i.w));
      const sizes = l.items.map((i) => i.size);
      const fontSize = Math.round(Math.max(...sizes) * 10) / 10;
      return {
        text: text.replace(/\s+/g, " ").trim(),
        page: p + 1,
        x: x0,
        y: l.y,
        width: Math.max(x1 - x0, 10),
        fontSize,
      };
    });

    pages.push({
      index: p,
      width: viewport.width,
      height: viewport.height,
      lines: lines.filter((l) => l.text.length > 0),
    });

    onProgress?.(Math.round(((p + 1) / pdf.numPages) * 100));
  }

  return { numPages: pdf.numPages, pages };
}

/** Простой текст PDF (страница за страницей, строки через \n) */
export async function extractPdfText(
  data: ArrayBuffer,
  onProgress?: (p: number) => void
): Promise<string> {
  const doc = await loadPdfStructure(data, onProgress);
  return doc.pages
    .map((pg) => pg.lines.map((l) => l.text).join("\n"))
    .join("\n\n");
}

// ─────────────────────────────────────────────────────────────
//  mammoth.js — чтение DOCX
// ─────────────────────────────────────────────────────────────

async function readDocx(data: ArrayBuffer): Promise<string> {
  await loadScript("https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js");
  const mammoth = (window as any).mammoth;
  if (!mammoth) throw new Error("mammoth не загрузился");
  const result = await mammoth.extractRawText({ arrayBuffer: data });
  return result.value as string;
}

// ─────────────────────────────────────────────────────────────
//  Универсальное чтение документа в текст
// ─────────────────────────────────────────────────────────────

export const READABLE_EXTS = [".txt", ".md", ".docx", ".pdf"] as const;

export function isReadableFile(name: string): boolean {
  const ext = name.toLowerCase().replace(/^.*(\.[^.]+)$/, "$1");
  return (READABLE_EXTS as readonly string[]).includes(ext);
}

export type ReadResult = {
  text: string;
  kind: "text" | "docx" | "pdf";
  pdf?: { buffer: ArrayBuffer; structure: PdfDoc };
};

export async function readDocument(
  file: File,
  onProgress?: (p: number) => void
): Promise<ReadResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const buffer = await file.arrayBuffer();
    const structure = await loadPdfStructure(buffer.slice(0), onProgress);
    const text = structure.pages
      .map((pg) => pg.lines.map((l) => l.text).join("\n"))
      .join("\n\n");
    return { text, kind: "pdf", pdf: { buffer, structure } };
  }
  if (name.endsWith(".docx")) {
    onProgress?.(10);
    const buffer = await file.arrayBuffer();
    const text = await readDocx(buffer);
    onProgress?.(100);
    return { text, kind: "docx" };
  }
  // txt / md и прочие текстовые
  onProgress?.(30);
  const text = await file.text();
  onProgress?.(100);
  return { text, kind: "text" };
}

// ─────────────────────────────────────────────────────────────
//  Скачивание Blob
// ─────────────────────────────────────────────────────────────

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

// ─────────────────────────────────────────────────────────────
//  Экспорт DOCX (docx.js)
// ─────────────────────────────────────────────────────────────

export async function exportDocx(
  filename: string,
  text: string,
  title?: string
): Promise<void> {
  await loadScript("https://unpkg.com/docx@8.5.0/build/index.umd.js");
  const docx = (window as any).docx;
  if (!docx) throw new Error("docx.js не загрузился");

  const paragraphs: any[] = [];
  if (title) {
    paragraphs.push(
      new docx.Paragraph({
        children: [new docx.TextRun({ text: title, bold: true, size: 28 })],
        spacing: { after: 240 },
      })
    );
  }
  for (const para of text.split(/\n/)) {
    paragraphs.push(
      new docx.Paragraph({
        children: [new docx.TextRun({ text: para, size: 24 })],
        spacing: { after: 120 },
      })
    );
  }

  const doc = new docx.Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 24 } },
      },
    },
    sections: [{ properties: {}, children: paragraphs }],
  });

  const blob = await docx.Packer.toBlob(doc);
  downloadBlob(filename, blob);
}

// ─────────────────────────────────────────────────────────────
//  Экспорт PDF FAST (pdfmake — красивый документ с нуля)
// ─────────────────────────────────────────────────────────────

async function getPdfMake(): Promise<any> {
  if (!(window as any).pdfMake) {
    await loadScript("https://unpkg.com/pdfmake@0.2.20/build/pdfmake.min.js");
    await loadScript("https://unpkg.com/pdfmake@0.2.20/build/vfs_fonts.js");
  }
  const pdfMake = (window as any).pdfMake;
  if (!pdfMake) throw new Error("pdfmake не загрузился");
  return pdfMake;
}

export async function exportPdfFast(
  filename: string,
  text: string,
  title?: string
): Promise<void> {
  const pdfMake = await getPdfMake();

  const content: any[] = [];
  if (title) {
    content.push({ text: title, style: "title" });
  }
  for (const para of text.split(/\n/)) {
    if (para.trim()) {
      content.push({ text: para, style: "body", margin: [0, 0, 0, 6] });
    }
  }

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [50, 50, 50, 50],
    defaultStyle: { font: "Roboto", fontSize: 11, lineHeight: 1.4 },
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 14], color: "#1a1a2e" },
      body: { fontSize: 11, color: "#222" },
    },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: "center",
      fontSize: 9,
      color: "#999",
    }),
    content,
  };

  pdfMake.createPdf(docDefinition).download(filename);
}

// ─────────────────────────────────────────────────────────────
//  Экспорт PDF LAYOUT (pdf-lib: оверлей перевода на оригинал)
// ─────────────────────────────────────────────────────────────

const PDFLIB_URL = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";
const FONTKIT_URL = "https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";
// TTF с кириллицей (DejaVu Sans — открытый шрифт с широкой покрытием)
const UNICODE_FONT_URL = "https://unpkg.com/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf";

export type LayoutOverlay = {
  pageIndex: number; // 0-based
  lines: Array<{ x: number; y: number; width: number; fontSize: number; text: string }>;
};

/**
 * Собирает PDF LAYOUT: оригинальные страницы + белые плашки + переведённый текст.
 * Картинки, графики и разметка сохраняются, потому что закрываются только
 * области текста.
 */
export async function exportPdfLayout(
  filename: string,
  sourcePdf: ArrayBuffer,
  overlays: LayoutOverlay[]
): Promise<void> {
  await loadScript(PDFLIB_URL);
  await loadScript(FONTKIT_URL);
  const PDFLib = (window as any).PDFLib;
  const fontkit = (window as any).fontkit;
  if (!PDFLib || !fontkit) throw new Error("pdf-lib/fontkit не загрузились");

  const { PDFDocument, rgb, degrees } = PDFLib;

  const pdf = await PDFDocument.load(sourcePdf);
  pdf.registerFontkit(fontkit);

  // Шрифт с кириллицей
  const fontBytes = await fetch(UNICODE_FONT_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Шрифт не скачался: HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .catch(async () => {
      // Fallback: jsDelivr
      const r = await fetch("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf");
      return r.arrayBuffer();
    });
  const font = await pdf.embedFont(fontBytes, { subset: false });

  const pages = pdf.getPages();

  for (const overlay of overlays) {
    const page = pages[overlay.pageIndex];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    // Масштаб исходных координат (pdf.js scale=1 == PDF points) — совпадают,
    // но на всякий случай нормируем по медиане размеров.

    for (const line of overlay.lines) {
      if (!line.text.trim()) continue;

      // Подбираем размер шрифта, чтобы строка влезла в исходную ширину
      let size = line.fontSize;
      let textWidth = font.widthOfTextAtSize(line.text, size);
      const maxWidth = line.width * 1.08; // чуть больше исходного поля
      if (textWidth > maxWidth && textWidth > 0) {
        size = Math.max(4, size * (maxWidth / textWidth));
        textWidth = font.widthOfTextAtSize(line.text, size);
      }

      const padX = 1.2;
      const padY = size * 0.22;
      const boxX = line.x - padX;
      const boxY = line.y - size * 0.24 - padY / 2;
      const boxW = Math.min(Math.max(textWidth + padX * 2, line.width * 0.4), pw - boxX - 2);
      const boxH = size * 1.45;

      // Белая плашка поверх исходного текста
      page.drawRectangle({
        x: boxX,
        y: boxY,
        width: boxW,
        height: boxH,
        color: rgb(1, 1, 1),
        opacity: 1,
      });

      // Переведённый текст (клампим координаты в страницу)
      const drawX = Math.max(2, Math.min(line.x, pw - textWidth - 2));
      const drawY = Math.max(boxY + size * 0.22, Math.min(line.y, ph - 4));
      page.drawText(line.text, {
        x: drawX,
        y: drawY,
        size,
        font,
        color: rgb(0.05, 0.05, 0.1),
      });
      void degrees;
    }
  }

  const bytes = await pdf.save();
  downloadBlob(filename, new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
}
