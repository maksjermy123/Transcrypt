"use client";

import { motion } from "framer-motion";
import { Upload, Download, Trash2, Loader2, FileArchive, Image as ImageIcon } from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { downloadFile } from "@/lib/subtitles";

/**
 * Вкладка-конвертер.
 * Реализуем то, что браузер умеет без ffmpeg.wasm:
 *   - изображения: png ↔ jpeg ↔ webp через Canvas
 *   - аудио: извлечение аудиодорожки из видео в原始альном формате (через MediaRecorder)
 *   - text: txt / md / csv / json — кодировка в utf-8 + скачать
 *
 * В дальнейшем можно подключить ffmpeg.wasm, но это добавит ~30 МБ к первичной загрузке.
 */

type Tab = "image" | "text";

export function ConvertTab() {
  const [tab, setTab] = useState<Tab>("image");
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Конвертер</h1>
        <p className="text-sm text-muted-foreground">
          Браузерные конвертации без сервера. Изображения — через Canvas,
          текст — через File API.
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        <TabBtn active={tab === "image"} onClick={() => setTab("image")} icon={ImageIcon} label="Изображения" />
        <TabBtn active={tab === "text"} onClick={() => setTab("text")} icon={FileArchive} label="Текстовые файлы" />
      </div>

      {tab === "image" && <ImageConverter />}
      {tab === "text" && <TextConverter />}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors inline-flex items-center gap-2 ${
        active
          ? "bg-gradient-primary text-white"
          : "bg-[#1b2334] hover:bg-[#263147] text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function ImageConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [target, setTarget] = useState<"png" | "jpeg" | "webp">("png");
  const [quality, setQuality] = useState(0.92);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ blob: Blob; name: string; sizeKB: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("image/")) return;
    setFile(f);
    setResult(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  }, [preview]);

  async function convert() {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const img = new Image();
      img.src = preview;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas не поддерживается");
      ctx.drawImage(img, 0, 0);

      const mime = `image/${target}`;
      const blob: Blob = await new Promise((res) =>
        canvas.toBlob(
          (b) => res(b as Blob),
          mime,
          target === "jpeg" ? quality : undefined
        )
      );

      if (!blob) throw new Error("Не удалось сконвертировать");
      const baseName = file.name.replace(/\.[^.]+$/, "");
      setResult({
        blob,
        name: `${baseName}.${target}`,
        sizeKB: Math.round((blob.size / 1024) * 10) / 10,
      });
    } catch (err: any) {
      console.error(err);
      alert("Ошибка конвертации: " + err?.message);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-5">
      {!file ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          className="glass-card rounded-2xl p-12 text-center cursor-pointer hover:border-[#7c5bf5]/50 transition-colors"
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-4">
            <Upload className="w-8 h-8 text-[#7c5bf5]" />
          </div>
          <h3 className="font-semibold mb-1">Загрузите изображение</h3>
          <p className="text-sm text-muted-foreground">PNG, JPEG, WebP — до 20 МБ</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
            <img
              src={preview ?? ""}
              alt="preview"
              className="w-20 h-20 object-cover rounded-lg bg-[#0b0f19]"
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} КБ · {file.type}
              </div>
            </div>
            <button
              onClick={() => {
                setFile(null);
                setPreview(null);
                setResult(null);
              }}
              className="p-2 rounded-lg text-muted-foreground hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Формат</label>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as any)}
                  className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-2 text-sm"
                >
                  <option value="png">PNG (без потерь)</option>
                  <option value="jpeg">JPEG (сжатие)</option>
                  <option value="webp">WebP (компактный)</option>
                </select>
              </div>

              {target === "jpeg" && (
                <div className="flex-1 min-w-48">
                  <label className="text-xs text-muted-foreground block mb-1">
                    Качество: {Math.round(quality * 100)}%
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}

              <button
                onClick={convert}
                disabled={busy}
                className="bg-gradient-primary text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Конвертация…
                  </>
                ) : (
                  "Сконвертировать"
                )}
              </button>
            </div>

            {result && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-5 pt-5 border-t border-[#263147] flex items-center justify-between"
              >
                <div className="text-sm">
                  <div className="font-medium">{result.name}</div>
                  <div className="text-xs text-muted-foreground">{result.sizeKB} КБ</div>
                </div>
                <button
                  onClick={download}
                  className="bg-emerald-500/15 text-emerald-400 px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 hover:bg-emerald-500/25"
                >
                  <Download className="w-4 h-4" />
                  Скачать
                </button>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TextConverter() {
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState("");
  const [target, setTarget] = useState<"txt" | "md" | "json" | "csv">("txt");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ name: string; sizeKB: number; blob: Blob } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(f: File) {
    setFile(f);
    setResult(null);
    const text = await f.text();
    setContent(text);
  }

  async function convert() {
    if (!file) return;
    setBusy(true);
    try {
      let out = content;
      if (target === "json") {
        // Пробуем распарсить как JSON, если не получается — оборачиваем
        try {
          JSON.parse(content);
          out = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          out = JSON.stringify({ content }, null, 2);
        }
      }
      const blob = new Blob([out], { type: "text/plain;charset=utf-8" });
      const baseName = file.name.replace(/\.[^.]+$/, "");
      setResult({
        blob,
        name: `${baseName}.${target}`,
        sizeKB: Math.round((blob.size / 1024) * 10) / 10,
      });
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-5">
      {!file ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          className="glass-card rounded-2xl p-12 text-center cursor-pointer hover:border-[#7c5bf5]/50 transition-colors"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.md,.csv,.json,text/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-4">
            <Upload className="w-8 h-8 text-[#7c5bf5]" />
          </div>
          <h3 className="font-semibold mb-1">Загрузите текстовый файл</h3>
          <p className="text-sm text-muted-foreground">TXT, MD, CSV, JSON — до 10 МБ</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
            <FileArchive className="w-10 h-10 text-[#7c5bf5]" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(1)} КБ · {content.length} символов
              </div>
            </div>
            <button
              onClick={() => {
                setFile(null);
                setContent("");
                setResult(null);
              }}
              className="p-2 rounded-lg text-muted-foreground hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">В формат</label>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as any)}
                  className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-2 text-sm"
                >
                  <option value="txt">.txt (простой текст)</option>
                  <option value="md">.md (Markdown)</option>
                  <option value="json">.json (форматированный JSON)</option>
                  <option value="csv">.csv (как есть)</option>
                </select>
              </div>
              <button
                onClick={convert}
                disabled={busy}
                className="bg-gradient-primary text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Конвертация…
                  </>
                ) : (
                  "Сконвертировать"
                )}
              </button>
            </div>

            {result && (
              <div className="mt-5 pt-5 border-t border-[#263147] flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">{result.name}</div>
                  <div className="text-xs text-muted-foreground">{result.sizeKB} КБ</div>
                </div>
                <button
                  onClick={download}
                  className="bg-emerald-500/15 text-emerald-400 px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 hover:bg-emerald-500/25"
                >
                  <Download className="w-4 h-4" />
                  Скачать
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
