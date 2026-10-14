"use client";

/**
 * Вкладка «Перевод» — веб-порт translation_tab.py из десктопа.
 *
 * Секция 1. Перевод текста (Google / DeepL) — как в десктопе:
 *   слева исходник, справа перевод, провайдер + язык + копирование.
 * Секция 2. Перевод файлов (TXT / DOCX / PDF):
 *   - PDF читается прямо в браузере (pdf.js) — Word/LibreOffice НЕ нужны
 *   - Режимы PDF: LAYOUT (сохраняет картинки и разметку, перевод накладывается
 *     поверх оригинальных страниц) и FAST (только текст, новый PDF)
 *   - Выходные форматы: txt / docx / pdf
 */

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Languages,
  Copy,
  Check,
  FileText,
  FilePlus2,
  Trash2,
  Loader2,
  AlertCircle,
  Info,
  Wand2,
  CheckCircle2,
  XCircle,
  Download,
} from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useSettings } from "@/lib/settings-store";
import { translateText, translateBatch } from "@/lib/translate";
import {
  readDocument,
  isReadableFile,
  downloadText,
  exportDocx,
  exportPdfFast,
  exportPdfLayout,
  type LayoutOverlay,
} from "@/lib/docio";

const TARGET_LANGS = ["ru", "en", "uk", "es", "de", "fr", "it", "pl"];

const LANG_NAMES: Record<string, string> = {
  ru: "Русский",
  en: "Английский",
  uk: "Украинский",
  es: "Испанский",
  de: "Немецкий",
  fr: "Французский",
  it: "Итальянский",
  pl: "Польский",
};

type FileStatus = "pending" | "reading" | "translating" | "done" | "error";

type FileItem = {
  id: number;
  file: File;
  lang: string; // целевой язык этого файла
  format: "txt" | "docx" | "pdf";
  status: FileStatus;
  message: string;
  progress: number;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function TranslateTab() {
  const { engineServerOnline } = useOnboarding();
  const { provider, deeplKey, pdfMode, setPdfMode } = useSettings();

  // ─── Секция 1: перевод текста ───
  const [textIn, setTextIn] = useState("");
  const [textOut, setTextOut] = useState("");
  const [textLang, setTextLang] = useState("ru");
  const [textBusy, setTextBusy] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ─── Секция 2: перевод файлов ───
  const [items, setItems] = useState<FileItem[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);

  const pushLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    setLog((prev) => {
      const next = [...prev, `[${ts}] ${msg}`];
      return next.slice(-200);
    });
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  }, []);

  // ─── Перевод текста ───
  async function translateTextInput() {
    if (!textIn.trim() || textBusy) return;
    setTextBusy(true);
    setTextError(null);
    setTextOut("Перевод…");
    try {
      const res = await translateText(textIn, {
        targetLang: textLang,
        provider,
        apiKey: deeplKey,
        engineOnline: engineServerOnline,
      });
      setTextOut(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTextError(msg);
      setTextOut("");
    } finally {
      setTextBusy(false);
    }
  }

  async function copyResult() {
    if (!textOut) return;
    await navigator.clipboard.writeText(textOut);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // ─── Файлы: добавление / удаление ───
  function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const accepted: FileItem[] = [];
    const rejected: string[] = [];
    for (const f of files) {
      if (isReadableFile(f.name)) {
        accepted.push({
          id: ++idCounter.current,
          file: f,
          lang: "ru",
          format: f.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx",
          status: "pending",
          message: "",
          progress: 0,
        });
      } else {
        rejected.push(f.name);
      }
    }

    if (accepted.length) setItems((prev) => [...prev, ...accepted]);
    if (rejected.length) {
      pushLog(`⚠️ Пропущены файлы неподдерживаемого формата: ${rejected.slice(0, 3).join(", ")}${rejected.length > 3 ? ` и ещё ${rejected.length - 3}` : ""}`);
    }
    e.target.value = "";
  }

  function removeItem(id: number) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function updateItem(id: number, patch: Partial<FileItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  // ─── Пакетный перевод файлов ───
  async function startFileTranslation() {
    const queue = items.filter((i) => i.status === "pending" || i.status === "error");
    if (!queue.length || batchBusy) return;

    const hasLayoutPdf = queue.some(
      (i) => i.file.name.toLowerCase().endsWith(".pdf") && i.format === "pdf" && pdfMode === "LAYOUT"
    );
    if (hasLayoutPdf) {
      pushLog(`ℹ️ PDF LAYOUT: перевод накладывается на оригинальные страницы — картинки и разметка сохраняются.`);
    }

    setBatchBusy(true);
    setBatchProgress(0);
    let done = 0;
    let ok = 0;
    let fail = 0;

    for (const item of queue) {
      const name = item.file.name;
      pushLog(`🔄 Перевод ${name} → ${LANG_NAMES[item.lang] ?? item.lang}…`);
      updateItem(item.id, { status: "reading", message: "Чтение…", progress: 5 });

      try {
        // 1. Чтение документа
        const read = await readDocument(item.file, (p) =>
          updateItem(item.id, { progress: Math.max(5, Math.round(p * 0.15)) })
        );
        if (!read.text.trim()) throw new Error("Пустой файл или не удалось извлечь текст");

        updateItem(item.id, { status: "translating", message: "Перевод…", progress: 20 });

        const isPdfLayout =
          read.kind === "pdf" && item.format === "pdf" && pdfMode === "LAYOUT" && !!read.pdf;

        // 2. Перевод
        let translatedText = "";
        let overlays: LayoutOverlay[] | null = null;

        if (isPdfLayout && read.pdf) {
          // LAYOUT: построчный перевод с сохранением позиций
          const allLines = read.pdf.structure.pages.flatMap((pg) =>
            pg.lines.map((l) => ({ ...l, pageIndex: pg.index, translated: "" as string }))
          );
          const translatable = allLines.filter((l) => /[\p{L}]/u.test(l.text));
          pushLog(`   Строк: ${allLines.length}, к переводу: ${translatable.length}`);

          const results = await translateBatch(
            translatable.map((l) => l.text),
            {
              targetLang: item.lang,
              provider,
              apiKey: deeplKey,
              engineOnline: engineServerOnline,
              onProgress: (p) =>
                updateItem(item.id, { progress: 20 + Math.round(p * 0.55) }),
            }
          );
          translatable.forEach((l, i) => (l.translated = results[i] ?? l.text));

          // Оверлеи по страницам: переводим строки там, где они были
          overlays = read.pdf.structure.pages.map((pg, pgIdx) => ({
            pageIndex: pg.index,
            lines: allLines
              .filter((l) => l.pageIndex === pgIdx)
              .map((l) => ({ x: l.x, y: l.y, width: l.width, fontSize: l.fontSize, text: l.translated || l.text }))
              .filter((l) => l.text.trim()),
          }));
        } else {
          // FAST: цельный текст через чанкинг
          translatedText = await translateText(read.text, {
            targetLang: item.lang,
            provider,
            apiKey: deeplKey,
            engineOnline: engineServerOnline,
            onProgress: (p, eta) => {
              updateItem(item.id, { progress: 20 + Math.round(p * 0.55) });
              if (eta) updateItem(item.id, { message: `Перевод… (${eta})` });
            },
          });
        }

        updateItem(item.id, { progress: 85, message: "Сохранение…" });

        // 3. Экспорт
        const base = name.replace(/\.[^.]+$/, "");
        const suffix = `TRANS_${item.lang.toUpperCase()}`;
        if (isPdfLayout && read.pdf && overlays) {
          await exportPdfLayout(`${suffix}_${base}.pdf`, read.pdf.buffer, overlays);
          pushLog(`✅ Сохранено (LAYOUT, разметка сохранена): ${suffix}_${base}.pdf`);
        } else if (item.format === "pdf") {
          await exportPdfFast(`${suffix}_${base}.pdf`, translatedText, `Перевод: ${name}`);
          pushLog(`✅ Сохранено (FAST, только текст): ${suffix}_${base}.pdf`);
        } else if (item.format === "docx") {
          await exportDocx(`${suffix}_${base}.docx`, translatedText, `Перевод: ${name}`);
          pushLog(`✅ Сохранено: ${suffix}_${base}.docx`);
        } else {
          downloadText(`${suffix}_${base}.txt`, translatedText);
          pushLog(`✅ Сохранено: ${suffix}_${base}.txt`);
        }

        updateItem(item.id, { status: "done", message: "Готово", progress: 100 });
        ok++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushLog(`❌ Ошибка перевода ${name}: ${msg}`);
        updateItem(item.id, { status: "error", message: msg, progress: 0 });
        fail++;
      }

      done++;
      setBatchProgress(Math.round((done / queue.length) * 100));
    }

    pushLog(
      fail === 0
        ? `🎉 Готово! Успешно: ${ok}/${queue.length}`
        : `⚠️ Завершено: ${ok}/${queue.length} успешно, ошибок: ${fail}`
    );
    setBatchBusy(false);
  }

  const statusIcon = (s: FileStatus) => {
    switch (s) {
      case "done":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
      case "error":
        return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
      case "reading":
      case "translating":
        return <Loader2 className="w-4 h-4 text-[#7c5bf5] animate-spin flex-shrink-0" />;
      default:
        return <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Заголовок */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
          <Languages className="w-5 h-5 text-[#7c5bf5]" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Перевод</h2>
          <p className="text-sm text-muted-foreground">
            Текст и файлы (TXT / DOCX / PDF). PDF обрабатывается прямо в браузере —
            Word и LibreOffice не нужны.
          </p>
        </div>
      </div>

      {/* ═══════════ Секция 1: Перевод текста ═══════════ */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#263147]/60 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-sm">1. Перевод текста</h3>
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-xs text-muted-foreground">Провайдер:</label>
            <select
              value={provider}
              onChange={(e) => useSettings.getState().setProvider(e.target.value as "google" | "deepl")}
              className="bg-[#1b2334] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs"
            >
              <option value="google">Google</option>
              <option value="deepl">DeepL</option>
            </select>
            <label className="text-xs text-muted-foreground ml-2">Язык:</label>
            <select
              value={textLang}
              onChange={(e) => setTextLang(e.target.value)}
              className="bg-[#1b2334] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs"
            >
              {TARGET_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l} — {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#263147]/60">
          {/* Вход */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground">Исходный текст (авто-определение):</label>
              <button
                onClick={() => {
                  setTextIn("");
                  setTextOut("");
                  setTextError(null);
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Очистить
              </button>
            </div>
            <textarea
              value={textIn}
              onChange={(e) => setTextIn(e.target.value)}
              placeholder="Вставьте или введите текст для перевода…"
              className="w-full h-48 bg-[#0b0f19] border border-[#263147] rounded-xl p-3 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-[#7c5bf5]/50"
            />
          </div>

          {/* Выход */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground">Перевод:</label>
              <button
                onClick={copyResult}
                disabled={!textOut}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 inline-flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <div
              className={`w-full h-48 bg-[#0b0f19] border rounded-xl p-3 text-sm overflow-y-auto ${
                textError ? "border-red-500/40" : "border-[#263147]"
              }`}
            >
              {textError ? (
                <div className="flex items-start gap-2 text-red-300">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{textError}</span>
                </div>
              ) : (
                <span className={textOut ? "" : "text-muted-foreground"}>
                  {textOut || "Здесь появится перевод…"}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-[#263147]/60">
          <button
            onClick={translateTextInput}
            disabled={textBusy || !textIn.trim()}
            className="bg-gradient-primary text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {textBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
            {textBusy ? "Переводим…" : "Перевести текст"}
          </button>
          {provider === "deepl" && !deeplKey && (
            <span className="text-xs text-amber-400 ml-3 inline-flex items-center gap-1">
              <Info className="w-3 h-3" /> Для DeepL добавьте API-ключ во вкладке «Настройки»
            </span>
          )}
        </div>
      </section>

      {/* ═══════════ Секция 2: Перевод файлов ═══════════ */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#263147]/60 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-sm">2. Перевод файлов (TXT / DOCX / PDF)</h3>
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-xs text-muted-foreground">PDF режим:</label>
            <select
              value={pdfMode}
              onChange={(e) => setPdfMode(e.target.value as "LAYOUT" | "FAST")}
              className="bg-[#1b2334] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs"
              title="LAYOUT: перевод поверх оригинала с сохранением картинок и разметки. FAST: только текст в новом PDF."
            >
              <option value="LAYOUT">LAYOUT (с разметкой)</option>
              <option value="FAST">FAST (только текст)</option>
            </select>
          </div>
        </div>

        {pdfMode === "LAYOUT" && (
          <div className="px-5 py-2.5 bg-[#7c5bf5]/5 border-b border-[#263147]/60 text-xs text-[#b9a8f7] flex items-start gap-2">
            <Wand2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <b>LAYOUT</b> — перевод накладывается прямо на оригинальные страницы PDF:
              картинки, графики и оформление сохраняются. Если что-то пойдёт не так —
              переключитесь на <b>FAST</b> (чистый текст в новом PDF).
            </span>
          </div>
        )}

        <div className="p-4 space-y-3">
          {/* Кнопки */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 bg-[#1b2334] hover:bg-[#232c40] border border-[#263147] px-4 py-2.5 rounded-xl text-sm cursor-pointer transition-colors">
              <FilePlus2 className="w-4 h-4 text-[#7c5bf5]" />
              Добавить файл(ы)
              <input
                type="file"
                multiple
                accept=".txt,.md,.docx,.pdf"
                onChange={addFiles}
                className="hidden"
              />
            </label>
            {items.length > 0 && (
              <button
                onClick={() => !batchBusy && setItems([])}
                disabled={batchBusy}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-red-400 px-3 py-2.5 disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" />
                Очистить список
              </button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              Файлы обрабатываются локально в браузере, в сеть уходит только текст для перевода
            </span>
          </div>

          {/* Список файлов */}
          {items.length > 0 && (
            <div className="rounded-xl border border-[#263147]/60 overflow-hidden">
              <div className="max-h-72 overflow-y-auto divide-y divide-[#263147]/40">
                {items.map((item) => (
                  <div key={item.id} className="p-3 hover:bg-[#161d2e]/50 transition-colors">
                    <div className="flex items-center gap-3">
                      {statusIcon(item.status)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium truncate">{item.file.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {formatSize(item.file.size)}
                          </span>
                        </div>
                        {(item.message || item.progress > 0) && (
                          <div className="text-xs text-muted-foreground mt-0.5">{item.message}</div>
                        )}
                        {(item.status === "reading" || item.status === "translating") && (
                          <div className="mt-1.5 h-1 rounded-full bg-[#263147] overflow-hidden">
                            <div
                              className="h-full bg-gradient-primary transition-all"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        )}
                        {item.status === "error" && (
                          <div className="text-xs text-red-300 mt-0.5 line-clamp-2">{item.message}</div>
                        )}
                      </div>
                      <select
                        value={item.lang}
                        onChange={(e) => updateItem(item.id, { lang: e.target.value })}
                        disabled={batchBusy}
                        className="bg-[#1b2334] border border-[#263147] rounded-lg px-2 py-1.5 text-xs flex-shrink-0"
                        title="Язык перевода этого файла"
                      >
                        {TARGET_LANGS.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <select
                        value={item.format}
                        onChange={(e) =>
                          updateItem(item.id, { format: e.target.value as "txt" | "docx" | "pdf" })
                        }
                        disabled={batchBusy}
                        className="bg-[#1b2334] border border-[#263147] rounded-lg px-2 py-1.5 text-xs flex-shrink-0"
                        title="Формат сохранения"
                      >
                        <option value="txt">→ .txt</option>
                        <option value="docx">→ .docx</option>
                        <option value="pdf">→ .pdf</option>
                      </select>
                      <button
                        onClick={() => removeItem(item.id)}
                        disabled={batchBusy}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 flex-shrink-0"
                        title="Убрать файл"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Прогресс + кнопка запуска */}
          <div className="space-y-3">
            {batchBusy && (
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span>Общий прогресс пакета…</span>
                  <span>{batchProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#263147] overflow-hidden">
                  <div
                    className="h-full bg-gradient-primary transition-all"
                    style={{ width: `${batchProgress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={startFileTranslation}
              disabled={batchBusy || !items.some((i) => i.status === "pending" || i.status === "error")}
              className="w-full bg-gradient-primary text-white px-5 py-3 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {batchBusy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Переводим файлы… {batchProgress}%
                </>
              ) : (
                <>
                  <Languages className="w-4 h-4" />
                  Начать перевод файлов
                </>
              )}
            </button>
          </div>

          {/* Лог */}
          {log.length > 0 && (
            <div
              ref={logRef}
              className="h-36 overflow-y-auto rounded-xl bg-[#0b0f19] border border-[#263147] p-3 text-xs font-mono text-muted-foreground space-y-0.5"
            >
              {log.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.includes("❌")
                      ? "text-red-300"
                      : line.includes("✅")
                      ? "text-emerald-300"
                      : line.includes("⚠️")
                      ? "text-amber-300"
                      : ""
                  }
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Подсказка про скачивание результатов */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-[#263147]/60 bg-[#0b0f19]/60 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2"
      >
        <Download className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#7c5bf5]" />
        <span>
          Готовые файлы скачиваются автоматически в папку загрузок браузера с префиксом{" "}
          <code className="text-[#b9a8f7]">TRANS_ЯЗЫК_</code>. Веб-версия читает PDF и DOCX сама —
          в отличие от десктопа, Microsoft Word и LibreOffice не требуются.
        </span>
      </motion.div>
    </div>
  );
}
