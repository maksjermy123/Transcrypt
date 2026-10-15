"use client";

import { motion } from "framer-motion";
import {
  Upload,
  Download,
  Trash2,
  Loader2,
  FileArchive,
  Image as ImageIcon,
  FileAudio,
  Settings2,
  History,
  X,
  Square,
} from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";

import { convertMedia, downloadBytes, getFFmpeg } from "@/lib/ffmpeg";
import { useOnboarding } from "@/lib/onboarding-store";
import {
  convertViaEngine,
  uploadFileToEngine,
  downloadEngineFile,
  resumeActiveJob,
  watchJobToCompletion,
  clearActiveJob,
  cancelActiveJob,
  type EngineProgress,
  type TaskResult,
} from "@/lib/engine-bridge";

type Mode = "media" | "image" | "text";

const MEDIA_FORMATS = [
  { ext: "mp3", label: "MP3 — аудио (192 kbps)", kind: "audio" },
  { ext: "wav", label: "WAV — без потерь", kind: "audio" },
  { ext: "aac", label: "AAC — аудио", kind: "audio" },
  { ext: "ogg", label: "OGG — аудио", kind: "audio" },
  { ext: "mp4", label: "MP4 — видео (H.264 + AAC)", kind: "video" },
  { ext: "webm", label: "WebM — видео", kind: "video" },
];

export function ConvertTab() {
  const [mode, setMode] = useState<Mode>("media");
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Конвертер</h1>
        <p className="text-sm text-muted-foreground">
          Медиа (через локальный ffmpeg, если движок запущен — иначе ffmpeg.wasm), изображения (Canvas), текстовые файлы.
        </p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <ModeBtn active={mode === "media"} onClick={() => setMode("media")} icon={FileAudio} label="Медиа" />
        <ModeBtn active={mode === "image"} onClick={() => setMode("image")} icon={ImageIcon} label="Изображения" />
        <ModeBtn active={mode === "text"} onClick={() => setMode("text")} icon={FileArchive} label="Текст" />
      </div>

      {mode === "media" && <MediaConverter />}
      {mode === "image" && <ImageConverter />}
      {mode === "text" && <TextConverter />}
    </div>
  );
}

function ModeBtn({
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

function MediaConverter() {
  const { engineServerOnline, engineServerHealth } = useOnboarding();
  const supportsJobs = !!engineServerHealth?.jobs;
  const supportsQueue = !!engineServerHealth?.queue; // движок ≥ 1.2.0: очереди задач
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<{ name: string; sizeKB: number; mime: string; data: Uint8Array } | null>(null);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [resultName, setResultName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Вытаскиваем имя файла из URL /api/download?file=... */
  function fileNameFromUrl(fileUrl: string, fallback: string): string {
    try {
      const u = new URL(fileUrl.startsWith("http") ? fileUrl : `http://x${fileUrl}`);
      const fp = u.searchParams.get("file") || u.pathname;
      return decodeURIComponent(fp.split("/").pop() || fallback);
    } catch {
      return fallback;
    }
  }

  function persistLastConvert(fileUrl: string, fname: string) {
    try {
      localStorage.setItem(
        "transcrypt.lastConvert",
        JSON.stringify({ at: Date.now(), file: fileUrl, name: fname })
      );
    } catch {
      /* ignore */
    }
  }

  function restoreLastConvert() {
    try {
      const raw = localStorage.getItem("transcrypt.lastConvert");
      if (!raw) return;
      const r = JSON.parse(raw);
      if (!r?.file) return;
      setResultFile(r.file);
      setResultName(r.name || "output");
      const when = r.at ? new Date(r.at).toLocaleString() : "";
      setJobNote(`Восстановлен последний готовый файл${when ? ` (от ${when})` : ""}.`);
    } catch {
      /* ignore */
    }
  }

  // ═══ Восстановление фоновой задачи при возврате на вкладку ═══
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let outcome: Awaited<ReturnType<typeof resumeActiveJob>>;
      try {
        outcome = await resumeActiveJob("convert");
      } catch {
        restoreLastConvert();
        return;
      }
      if (cancelled) return;
      if (outcome.state === "none" || outcome.state === "offline") {
        restoreLastConvert();
        return;
      }
      if (outcome.state === "lost") {
        clearActiveJob("convert");
        setJobNote("Прошлая фоновая задача не найдена — движок перезапускался.");
        restoreLastConvert();
        return;
      }
      if (outcome.state === "error") {
        clearActiveJob("convert");
        setError(outcome.job.error || "Фоновая задача завершилась с ошибкой");
        return;
      }
      const rec = outcome.record;
      if (outcome.state === "done") {
        clearActiveJob("convert"); // результат забрали — слот освобождаем
        const res = outcome.job.result as TaskResult;
        if (res?.file) {
          setResultFile(res.file);
          setResultName(fileNameFromUrl(res.file, `output.${target}`));
          setJobNote("Фоновая конвертация завершилась, пока вас не было — файл готов.");
        } else {
          setJobNote(res?.message || "Фоновая задача завершилась.");
        }
        return;
      }
      // running — переподключаемся
      setBusy(true);
      setProgress(1);
      setProgressText("Переподключение к фоновой задаче…");
      setJobNote("Задача выполнялась в фоне — снова следим за ней.");
      try {
        const res = await watchJobToCompletion<TaskResult>(
          rec.jobId,
          (p: EngineProgress) => {
            setProgress(p.percent);
            setProgressText(p.stage || "Конвертация…");
            setJobNote((n) =>
              p.stage?.startsWith("В очереди")
                ? "Задача стоит в очереди — движок выполняет другую задачу. Она начнётся автоматически: ничего не пропадёт."
                : n?.startsWith("Задача стоит в очереди")
                  ? null
                  : n
            );
            if (p.log?.length) setLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
          },
          "convert"
        );
        if (cancelled) return;
        if (res.status !== "success" || !res.file) {
          throw new Error(res.message || "Движок вернул ошибку");
        }
        const fname = fileNameFromUrl(res.file, `output.${target}`);
        setResultFile(res.file);
        setResultName(fname);
        setProgress(100);
        setProgressText("Готово");
        persistLastConvert(res.file, fname);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Ошибка фоновой задачи");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Предупреждение при закрытии/обновлении страницы во время задачи
  useEffect(() => {
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [busy]);

  async function cancelRun() {
    setProgressText("Отменяем задачу…");
    try {
      await cancelActiveJob("convert");
    } catch {
      /* ignore */
    }
    setBusy(false);
    setProgress(0);
    setProgressText("");
    setJobNote("Задача отменена.");
  }

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("audio/") && !f.type.startsWith("video/")) return;
    setFile(f);
    setResult(null);
    setResultFile(null);
    setError(null);
    setProgress(0);
  }, []);

  async function convert() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    setLog([]);
    setResult(null);
    setResultFile(null);
    setJobNote(null);

    try {
      if (engineServerOnline) {
        // ===== Через локальный движок =====
        setProgressText("Загружаем файл на движок…");
        setProgress(10);
        const filePath = await uploadFileToEngine(file, file.name);
        setProgress(25);
        setProgressText("Конвертация на движке…");

        const result = await convertViaEngine(filePath, target, (p: EngineProgress) => {
          setProgress(p.percent);
          setProgressText(p.stage || "Конвертация…");
          setJobNote((n) =>
            p.stage?.startsWith("В очереди")
              ? "Задача стоит в очереди — движок выполняет другую задачу. Она начнётся автоматически: ничего не пропадёт, можно переключать вкладки."
              : n?.startsWith("Задача стоит в очереди")
                ? null
                : n
          );
          if (p.log?.length) {
            setLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
          }
        }, file.name);

        if (result.status !== "success" || !result.file) {
          throw new Error(result.message || "Движок вернул ошибку");
        }

        // Извлекаем имя
        let fname = `output.${target}`;
        try {
          const u = new URL(result.file.startsWith("http") ? result.file : `http://x${result.file}`);
          const fp = u.searchParams.get("file") || u.pathname;
          fname = decodeURIComponent(fp.split("/").pop() || fname);
        } catch {
          /* ignore */
        }
        setResultFile(result.file);
        setResultName(fname);
        setProgress(100);
        setProgressText("Готово");
        persistLastConvert(result.file, fname);
        return;
      }

      // ===== Fallback на ffmpeg.wasm в браузере =====
      setProgressText("Загружаем ffmpeg.wasm…");
      setProgress(5);
      await getFFmpeg();
      setProgress(15);

      const inBytes = new Uint8Array(await file.arrayBuffer());
      const inName = file.name;
      const outExt = target;
      const outName = `output.${outExt}`;

      const isAudio = ["mp3", "wav", "aac", "ogg"].includes(outExt);
      const extra: string[] = [];
      if (isAudio) {
        if (outExt === "mp3") extra.push("-b:a", `${bitrate}k`);
        if (outExt === "wav") extra.push("-c:a", "pcm_s16le");
      } else {
        extra.push("-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac");
      }

      setProgressText("Конвертация через ffmpeg.wasm…");
      const out = await convertMedia(inBytes, inName, outName, extra, (m) => {
        setLog((l) => [...l.slice(-50), m]);
      });

      setResult({
        name: file.name.replace(/\.[^.]+$/, "") + "." + outExt,
        sizeKB: Math.round((out.length / 1024) * 10) / 10,
        mime: isAudio ? `audio/${outExt}` : `video/${outExt}`,
        data: out,
      });
      setProgress(100);
      setProgressText("Готово");
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Ошибка конвертации");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (resultFile && engineServerOnline) {
      await downloadEngineFile(resultFile, resultName || `output.${target}`);
      return;
    }
    if (result) {
      downloadBytes(result.name, result.data, result.mime);
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-xs px-3 py-2 rounded-lg bg-[#1b2334] text-muted-foreground inline-block">
        {engineServerOnline ? (
          <>🟢 Через локальный движок (нативный ffmpeg) — быстрее, больше форматов</>
        ) : (
          <>🟡 Через ffmpeg.wasm в браузере — медленнее, но без установки</>
        )}
      </div>

      {!file ? (
        <div className="space-y-4">
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
              accept="audio/*,video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-4">
              <FileAudio className="w-8 h-8 text-[#7c5bf5]" />
            </div>
            <h3 className="font-semibold mb-1">Загрузите аудио или видео</h3>
            <p className="text-sm text-muted-foreground">
              MP3, WAV, M4A, MP4, MKV, WebM, MOV — до 500 МБ
            </p>
          </div>

          {/* Восстановленный результат фоновой конвертации — виден и без выбранного файла */}
          {jobNote && !busy && (
            <div className="glass-card rounded-2xl p-4 border border-[#7c5bf5]/30 flex items-start gap-3">
              <History className="w-4 h-4 mt-0.5 text-[#a78bfa] flex-shrink-0" />
              <span className="text-sm text-[#cfc2ff] flex-1">{jobNote}</span>
              <button
                onClick={() => setJobNote(null)}
                className="p-0.5 rounded hover:bg-white/10 flex-shrink-0"
                title="Скрыть"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          )}
          {resultFile && !busy && (
            <div className="glass-card rounded-2xl p-5 flex items-center justify-between">
              <div className="text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Download className="w-4 h-4 text-emerald-500" />
                  {resultName}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Готово — файл ждёт на диске движка</div>
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
      ) : (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
            <FileAudio className="w-10 h-10 text-[#7c5bf5]" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} МБ · {file.type || "неизвестный формат"}
              </div>
            </div>
            <button
              onClick={() => {
                setFile(null);
                setResult(null);
                setResultFile(null);
              }}
              className="p-2 rounded-lg text-muted-foreground hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-48">
                <label className="text-xs text-muted-foreground block mb-1 flex items-center gap-1.5">
                  <Settings2 className="w-3 h-3" />
                  Формат
                </label>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-2 text-sm w-full"
                >
                  {MEDIA_FORMATS.map((f) => (
                    <option key={f.ext} value={f.ext}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              {target === "mp3" && (
                <div className="flex-1 min-w-48">
                  <label className="text-xs text-muted-foreground block mb-1">
                    Битрейт MP3: {bitrate} kbps
                  </label>
                  <input
                    type="range"
                    min={64}
                    max={320}
                    step={32}
                    value={bitrate}
                    onChange={(e) => setBitrate(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              )}

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

            {busy && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span>{progressText}</span>
                  <span className="text-[#7c5bf5] font-mono font-bold">{progress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#1b2334] overflow-hidden mb-2">
                  <motion.div
                    className="h-full bg-gradient-primary"
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                {log.length > 0 && (
                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                      Лог ({log.length} строк)
                    </summary>
                    <div className="max-h-32 overflow-y-auto mt-2 font-mono text-[10px] text-muted-foreground bg-[#0b0f19] p-2 rounded-lg">
                      {log.map((l, i) => (
                        <div key={i} className="truncate">{l}</div>
                      ))}
                    </div>
                  </details>
                )}
                {engineServerOnline && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-emerald-300/90">
                      {supportsJobs
                        ? "Задача на движке: вкладку можно переключить или закрыть — файл дождётся вас здесь."
                        : "Задача идёт в этой вкладке — не закрывайте её."}
                    </span>
                    <button
                      onClick={cancelRun}
                      className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
                    >
                      <Square className="w-3 h-3" />
                      Отменить
                    </button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 text-sm text-red-400 bg-red-500/10 p-3 rounded-lg">
                {error}
              </div>
            )}

            {jobNote && !busy && (
              <div className="mt-4 p-3 rounded-lg border border-[#7c5bf5]/30 bg-[#7c5bf5]/10 text-xs text-[#cfc2ff] flex items-start gap-2">
                <History className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span className="flex-1">{jobNote}</span>
                <button
                  onClick={() => setJobNote(null)}
                  className="p-0.5 rounded hover:bg-white/10 flex-shrink-0"
                  title="Скрыть"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {((result && !busy) || (resultFile && !busy)) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-5 pt-5 border-t border-[#263147] flex items-center justify-between"
              >
                <div className="text-sm">
                  <div className="font-medium">{result?.name || resultName}</div>
                  <div className="text-xs text-muted-foreground">
                    {result ? `${(result.sizeKB / 1024).toFixed(2)} МБ` : "Готово"}
                  </div>
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
