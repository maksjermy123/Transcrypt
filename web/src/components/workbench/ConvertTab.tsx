"use client";

import { motion } from "framer-motion";
import {
  Upload,
  Download,
  Trash2,
  Loader2,
  FileText,
  Image as ImageIcon,
  FileAudio,
  Settings2,
  History,
  AlertTriangle,
  X,
  Square,
} from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";

import { convertMedia, downloadBytes, getFFmpeg } from "@/lib/ffmpeg";
import { useOnboarding } from "@/lib/onboarding-store";
import { translate, useI18n } from "@/lib/i18n";
import {
  convertViaEngine,
  uploadFileToEngine,
  downloadEngineFile,
  engineFileUrl,
  resumeActiveJobWithRetry,
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
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("media");
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">{t("Конвертер")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Медиа (через локальный ffmpeg, если движок запущен — иначе ffmpeg.wasm), изображения (Canvas), документы Word ↔ PDF ↔ TXT.")} </p>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        <ModeBtn active={mode === "media"} onClick={() => setMode("media")} icon={FileAudio} label={t("Медиа")} />
        <ModeBtn active={mode === "image"} onClick={() => setMode("image")} icon={ImageIcon} label={t("Изображения")} />
        <ModeBtn active={mode === "text"} onClick={() => setMode("text")} icon={FileText} label={t("Документы")} />
      </div>

      {mode === "media" && <MediaConverter />}
      {mode === "image" && <ImageConverter />}
      {mode === "text" && <DocConverter />}
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
  const { t } = useI18n();
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
  const [downloadError, setDownloadError] = useState<string | null>(null);
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
      setJobNote(t("Восстановлен последний готовый файл{when}.", { when: when ? t("(от {d})", { d: when }) : "" }));
    } catch {
      /* ignore */
    }
  }

  // ═══ Восстановление фоновой задачи при возврате на вкладку ═══
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let outcome: Awaited<ReturnType<typeof resumeActiveJobWithRetry>>;
      try {
        outcome = await resumeActiveJobWithRetry("convert");
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
        setJobNote(t("Прошлая фоновая задача не найдена — движок перезапускался."));
        restoreLastConvert();
        return;
      }
      if (outcome.state === "error") {
        clearActiveJob("convert");
        setError(outcome.job.error || t("Фоновая задача завершилась с ошибкой"));
        return;
      }
      const rec = outcome.record;
      if (outcome.state === "done") {
        clearActiveJob("convert"); // результат забрали — слот освобождаем
        const res = outcome.job.result as TaskResult;
        if (res?.file) {
          setResultFile(res.file);
          setResultName(fileNameFromUrl(res.file, `output.${target}`));
          setJobNote(t("Фоновая конвертация завершилась, пока вас не было — файл готов."));
        } else {
          setJobNote(res?.message || t("Фоновая задача завершилась."));
        }
        return;
      }
      // running — переподключаемся
      setBusy(true);
      setProgress(1);
      setProgressText(t("Переподключение к фоновой задаче…"));
      setJobNote(t("Задача выполнялась в фоне — снова следим за ней."));
      try {
        const res = await watchJobToCompletion<TaskResult>(
          rec.jobId,
          (p: EngineProgress) => {
            setProgress(p.percent);
            setProgressText(p.stage || t("Конвертация…"));
            setJobNote((n) =>
              p.stage?.startsWith("В очереди")
                ? t("Задача стоит в очереди — движок выполняет другую задачу. Она начнётся автоматически: ничего не пропадёт.")
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
          throw new Error(res.message || t("Движок вернул ошибку"));
        }
        const fname = fileNameFromUrl(res.file, `output.${target}`);
        setResultFile(res.file);
        setResultName(fname);
        setProgress(100);
        setProgressText(t("Готово"));
        persistLastConvert(res.file, fname);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? t("Ошибка фоновой задачи"));
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
    setProgressText(t("Отменяем задачу…"));
    try {
      await cancelActiveJob("convert");
    } catch {
      /* ignore */
    }
    setBusy(false);
    setProgress(0);
    setProgressText("");
    setJobNote(t("Задача отменена."));
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
        setProgressText(t("Загружаем файл на движок…"));
        setProgress(10);
        const filePath = await uploadFileToEngine(file, file.name);
        setProgress(25);
        setProgressText(t("Конвертация на движке…"));

        const result = await convertViaEngine(filePath, target, (p: EngineProgress) => {
          setProgress(p.percent);
          setProgressText(p.stage || t("Конвертация…"));
          setJobNote((n) =>
            p.stage?.startsWith("В очереди")
              ? t("Задача стоит в очереди — движок выполняет другую задачу. Она начнётся автоматически: ничего не пропадёт, можно переключать вкладки.")
              : n?.startsWith("Задача стоит в очереди")
                ? null
                : n
          );
          if (p.log?.length) {
            setLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
          }
        }, file.name);

        if (result.status !== "success" || !result.file) {
          throw new Error(result.message || t("Движок вернул ошибку"));
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
        setProgressText(t("Готово"));
        persistLastConvert(result.file, fname);
        return;
      }

      // ===== Fallback на ffmpeg.wasm в браузере =====
      setProgressText(t("Загружаем ffmpeg.wasm…"));
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

      setProgressText(t("Конвертация через ffmpeg.wasm…"));
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
      setProgressText(t("Готово"));
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? t("Ошибка конвертации"));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (resultFile && engineServerOnline) {
      setDownloadError(null);
      try {
        await downloadEngineFile(resultFile, resultName || `output.${target}`);
      } catch (e: any) {
        console.error(e);
        setDownloadError(e?.message ?? t("Не удалось скачать файл"));
      }
      return;
    }
    if (result) {
      downloadBytes(result.name, result.data, result.mime);
    }
  }

  function openDirect() {
    if (!resultFile) return;
    window.open(engineFileUrl(resultFile), "_blank", "noopener");
  }

  return (
    <div className="space-y-5">
      <div className="text-xs px-3 py-2 rounded-lg bg-[#1b2334] text-muted-foreground inline-block">
        {engineServerOnline ? (
          <>{t("🟢 Через локальный движок (нативный ffmpeg) — быстрее, больше форматов")}</>
        ) : (
          <>{t("🟡 Через ffmpeg.wasm в браузере — медленнее, но без установки")}</>
        )}
      </div>

      {/* Баннер обновления движка перенесён в Настройки — вкладки не засоряем сообщениями:
          индикатор в шапке зелёный = всё работает, а обновление доступно в Настройках. */}

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
            <h3 className="font-semibold mb-1">{t("Загрузите аудио или видео")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("MP3, WAV, M4A, MP4, MKV, WebM, MOV — до 500 МБ")} </p>
          </div>

          {/* Восстановленный результат фоновой конвертации — виден и без выбранного файла */}
          {jobNote && !busy && (
            <div className="glass-card rounded-2xl p-4 border border-[#7c5bf5]/30 flex items-start gap-3">
              <History className="w-4 h-4 mt-0.5 text-[#a78bfa] flex-shrink-0" />
              <span className="text-sm text-[#cfc2ff] flex-1">{jobNote}</span>
              <button
                onClick={() => setJobNote(null)}
                className="p-0.5 rounded hover:bg-white/10 flex-shrink-0"
                title={t("Скрыть")}
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
                <div className="text-xs text-muted-foreground mt-0.5">{t("Готово — файл ждёт на диске движка")}</div>
              </div>
              <button
                onClick={download}
                className="bg-emerald-500/15 text-emerald-400 px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 hover:bg-emerald-500/25"
              >
                <Download className="w-4 h-4" />
                {t("Скачать")} </button>
            </div>
          )}
          {resultFile && !busy && downloadError && (
            <DownloadErrorCard
              error={downloadError}
              onRetryDirect={openDirect}
              onClose={() => setDownloadError(null)}
            />
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
            <FileAudio className="w-10 h-10 text-[#7c5bf5]" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)}  {t("МБ ·")} {file.type || t("неизвестный формат")}
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
                  {t("Формат")} </label>
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
                    {t("Битрейт MP3:")} {bitrate} kbps
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
                    <Loader2 className="w-4 h-4 animate-spin" />  {t("Конвертация…")} </>
                ) : (
                  t("Сконвертировать")
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
                      {t("Лог (")}{log.length}  {t("строк)")} </summary>
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
                        ? t("Задача на движке: вкладку можно переключить или закрыть — файл дождётся вас здесь.")
                        : t("Задача идёт в этой вкладке — не закрывайте её.")}
                    </span>
                    <button
                      onClick={cancelRun}
                      className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
                    >
                      <Square className="w-3 h-3" />
                      {t("Отменить")} </button>
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
                  title={t("Скрыть")}
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
                    {result ? `${(result.sizeKB / 1024).toFixed(2)} МБ` : t("Готово")}
                  </div>
                </div>
                <button
                  onClick={download}
                  className="bg-emerald-500/15 text-emerald-400 px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 hover:bg-emerald-500/25"
                >
                  <Download className="w-4 h-4" />
                  {t("Скачать")} </button>
              </motion.div>
            )}
            {resultFile && !result && !busy && downloadError && (
              <DownloadErrorCard
                error={downloadError}
                onRetryDirect={openDirect}
                onClose={() => setDownloadError(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ImageConverter() {
  const { t } = useI18n();
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
      if (!ctx) throw new Error(t("Canvas не поддерживается"));
      ctx.drawImage(img, 0, 0);

      const mime = `image/${target}`;
      const blob: Blob = await new Promise((res) =>
        canvas.toBlob(
          (b) => res(b as Blob),
          mime,
          target === "jpeg" ? quality : undefined
        )
      );

      if (!blob) throw new Error(t("Не удалось сконвертировать"));
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
          <h3 className="font-semibold mb-1">{t("Загрузите изображение")}</h3>
          <p className="text-sm text-muted-foreground">{t("PNG, JPEG, WebP — до 20 МБ")}</p>
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
                {(file.size / 1024).toFixed(1)}  {t("КБ ·")} {file.type}
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
                <label className="text-xs text-muted-foreground block mb-1">{t("Формат")}</label>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as any)}
                  className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-2 text-sm"
                >
                  <option value="png">{t("PNG (без потерь)")}</option>
                  <option value="jpeg">{t("JPEG (сжатие)")}</option>
                  <option value="webp">{t("WebP (компактный)")}</option>
                </select>
              </div>

              {target === "jpeg" && (
                <div className="flex-1 min-w-48">
                  <label className="text-xs text-muted-foreground block mb-1">
                    {t("Качество:")} {Math.round(quality * 100)}%
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
                    <Loader2 className="w-4 h-4 animate-spin" />  {t("Конвертация…")} </>
                ) : (
                  t("Сконвертировать")
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
                  <div className="text-xs text-muted-foreground">{result.sizeKB}  {t("КБ")}</div>
                </div>
                <button
                  onClick={download}
                  className="bg-emerald-500/15 text-emerald-400 px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 hover:bg-emerald-500/25"
                >
                  <Download className="w-4 h-4" />
                  {t("Скачать")} </button>
              </motion.div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Документы: Word ↔ PDF ↔ TXT ↔ RTF/ODT — через локальный движок (≥ 1.3.0).
//  Фикс «крякозябр»: docx/pdf больше не читаются как UTF-8 в браузере,
//  а текстовые файлы декодируются умно (UTF-8 → Windows-1251 → KOI8-R).
//  Текст-в-текст (txt/md/csv/json) работает даже без движка.
// ═══════════════════════════════════════════════════════════════

const DOC_ACCEPT = ".docx,.doc,.pdf,.txt,.md,.csv,.rtf,.odt";

type DocKind = "word" | "pdf" | "text";

function docKindOf(filename: string): DocKind | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["docx", "doc", "rtf", "odt"].includes(ext)) return "word";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "csv", "json"].includes(ext)) return "text";
  return null;
}

/** Целевые форматы по типу входного файла; engine: true — нужна локальная конвертация на движке */
const DOC_TARGETS: Record<DocKind, { ext: string; label: string; engine: boolean }[]> = {
  word: [
    { ext: "docx", label: ".docx — Word", engine: true },
    { ext: "pdf", label: ".pdf — PDF", engine: true },
    { ext: "txt", label: ".txt — текст (UTF-8)", engine: true },
    { ext: "rtf", label: ".rtf — Rich Text", engine: true },
    { ext: "odt", label: ".odt — OpenDocument", engine: true },
  ],
  pdf: [
    { ext: "docx", label: ".docx — Word", engine: true },
    { ext: "txt", label: ".txt — текст (UTF-8)", engine: true },
  ],
  text: [
    { ext: "txt", label: ".txt — текст (исправит кодировку на UTF-8)", engine: false },
    { ext: "pdf", label: ".pdf — PDF", engine: true },
    { ext: "docx", label: ".docx — Word", engine: true },
    { ext: "md", label: ".md — Markdown", engine: false },
    { ext: "csv", label: ".csv — как есть", engine: false },
    { ext: "json", label: ".json — форматированный JSON", engine: false },
  ],
};

/**
 * Умное чтение текстового файла в браузере: UTF-8 (строгий) → Windows-1251 → KOI8-R.
 * Именно f.text() (жёсткий UTF-8) раньше превращал файлы из русской Windows
 * в «крякозябры» ещё до отправки на движок.
 */
async function decodeTextFile(f: File): Promise<{ text: string; encoding: string }> {
  const buf = await f.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe)
    return { text: new TextDecoder("utf-16le").decode(buf), encoding: "UTF-16 LE (BOM)" };
  if (b[0] === 0xfe && b[1] === 0xff)
    return { text: new TextDecoder("utf-16be").decode(buf), encoding: "UTF-16 BE (BOM)" };
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return { text: new TextDecoder("utf-8").decode(buf), encoding: "UTF-8 (BOM)" };
  const tries: [string, string][] = [
    ["utf-8", "UTF-8"],
    ["windows-1251", "Windows-1251"],
    ["koi8-r", "KOI8-R"],
  ];
  for (const [enc, label] of tries) {
    try {
      return { text: new TextDecoder(enc, { fatal: true }).decode(buf), encoding: label };
    } catch {
      /* пробуем следующую кодировку */
    }
  }
  return { text: new TextDecoder("utf-8").decode(buf), encoding: translate("UTF-8 (с заменами)") };
}

function DocConverter() {
  const { t } = useI18n();
  const { engineServerOnline, engineServerHealth } = useOnboarding();
  const supportsJobs = !!engineServerHealth?.jobs;
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState("txt");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [resultName, setResultName] = useState("");
  const [localResult, setLocalResult] = useState<{ name: string; sizeKB: number; blob: Blob } | null>(null);
  const [preview, setPreview] = useState<{ text: string; encoding: string } | null>(null);
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

  function persistLastDoc(fileUrl: string, fname: string) {
    try {
      localStorage.setItem(
        "transcrypt.lastConvert",
        JSON.stringify({ at: Date.now(), file: fileUrl, name: fname })
      );
    } catch {
      /* ignore */
    }
  }

  function restoreLastDoc() {
    try {
      const raw = localStorage.getItem("transcrypt.lastConvert");
      if (!raw) return;
      const r = JSON.parse(raw);
      if (!r?.file) return;
      setResultFile(r.file);
      setResultName(r.name || "output");
      const when = r.at ? new Date(r.at).toLocaleString() : "";
      setJobNote(t("Восстановлен последний готовый файл{when}.", { when: when ? t("(от {d})", { d: when }) : "" }));
    } catch {
      /* ignore */
    }
  }

  // ═══ Восстановление фоновой задачи при возврате на вкладку ═══
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let outcome: Awaited<ReturnType<typeof resumeActiveJobWithRetry>>;
      try {
        outcome = await resumeActiveJobWithRetry("convert");
      } catch {
        restoreLastDoc();
        return;
      }
      if (cancelled) return;
      if (outcome.state === "none" || outcome.state === "offline") {
        restoreLastDoc();
        return;
      }
      if (outcome.state === "lost") {
        clearActiveJob("convert");
        setJobNote(t("Прошлая фоновая задача не найдена — движок перезапускался."));
        restoreLastDoc();
        return;
      }
      if (outcome.state === "error") {
        clearActiveJob("convert");
        setError(outcome.job.error || t("Фоновая задача завершилась с ошибкой"));
        return;
      }
      if (outcome.state === "done") {
        clearActiveJob("convert"); // результат забрали — слот освобождаем
        const res = outcome.job.result as TaskResult;
        if (res?.file) {
          setResultFile(res.file);
          setResultName(fileNameFromUrl(res.file, "output"));
          setJobNote(t("Фоновая конвертация завершилась, пока вас не было — файл готов."));
        } else {
          setJobNote(res?.message || t("Фоновая задача завершилась."));
        }
        return;
      }
      // running — переподключаемся к фоновой задаче
      setBusy(true);
      setProgress(1);
      setProgressText(t("Переподключение к фоновой задаче…"));
      setJobNote(t("Задача выполнялась в фоне — снова следим за ней."));
      try {
        const res = await watchJobToCompletion<TaskResult>(
          outcome.record.jobId,
          (p: EngineProgress) => {
            setProgress(p.percent);
            setProgressText(p.stage || t("Конвертация…"));
          },
          "convert"
        );
        if (cancelled) return;
        if (res.status !== "success" || !res.file) {
          throw new Error(res.message || t("Движок вернул ошибку"));
        }
        clearActiveJob("convert");
        const fname = fileNameFromUrl(res.file, "output");
        setResultFile(res.file);
        setResultName(fname);
        setProgress(100);
        setProgressText(t("Готово"));
        persistLastDoc(res.file, fname);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? t("Ошибка фоновой задачи"));
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

  async function handleFile(f: File) {
    setFile(f);
    setError(null);
    setLocalResult(null);
    setResultFile(null);
    setDownloadError(null);
    setJobNote(null);
    setProgress(0);
    setProgressText("");
    const kind = docKindOf(f.name);
    if (kind) setTarget(DOC_TARGETS[kind][0].ext);
    if (kind === "text") {
      try {
        const dec = await decodeTextFile(f);
        setPreview({ text: dec.text.slice(0, 4000), encoding: dec.encoding });
      } catch {
        setPreview(null);
      }
    } else {
      setPreview(null);
    }
  }

  async function convert() {
    if (!file) return;
    const kind = docKindOf(file.name);
    if (!kind) {
      setError(t("Неподдерживаемый формат файла. Возьмите DOCX, DOC, PDF, TXT, MD, CSV, RTF или ODT."));
      return;
    }
    const spec = DOC_TARGETS[kind].find((x) => x.ext === target);
    setBusy(true);
    setError(null);
    setLocalResult(null);
    setResultFile(null);
    setProgress(0);
    setJobNote(null);

    try {
      // ── Локальные текст-преобразования: работают даже без движка ──
      if (spec && !spec.engine) {
        setProgressText(t("Читаем файл…"));
        setProgress(30);
        const { text } = await decodeTextFile(file);
        let out = text;
        if (target === "json") {
          try {
            out = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            out = JSON.stringify({ content: text }, null, 2);
          }
        }
        const blob = new Blob([out], { type: "text/plain;charset=utf-8" });
        const base = file.name.replace(/\.[^.]+$/, "");
        setLocalResult({ name: `${base}.${target}`, sizeKB: blob.size, blob });
        setProgress(100);
        setProgressText(t("Готово"));
        return;
      }

      // ── Документные конвертации — только через движок ──
      if (!engineServerOnline) {
        throw new Error(
          t("Для конвертации документов (Word, PDF) нужен запущенный локальный движок — конвертация идёт на вашем компьютере, файлы никуда не отправляются. Установить: Настройки → «Установить движок».")
        );
      }
      if (engineServerHealth?.docs === false) {
        throw new Error(
          t("Установленный движок собран без библиотек конвертации документов. Обновите его: Настройки → «Доступно обновление движка» (та же команда установки, 1–3 минуты).")
        );
      }

      setProgressText(t("Загружаем файл на движок…"));
      setProgress(10);
      const filePath = await uploadFileToEngine(file, file.name);
      setProgress(25);
      setProgressText(t("Конвертация на движке…"));

      const result = await convertViaEngine(
        filePath,
        target,
        (p: EngineProgress) => {
          setProgress(Math.max(25, p.percent));
          setProgressText(p.stage || t("Конвертация…"));
          setJobNote((n) =>
            p.stage?.startsWith("В очереди")
              ? t("Задача стоит в очереди — движок выполняет другую задачу. Она начнётся автоматически: ничего не пропадёт.")
              : n?.startsWith("Задача стоит в очереди")
                ? null
                : n
          );
        },
        file.name
      );

      if (result.status !== "success" || !result.file) {
        throw new Error(result.message || t("Движок вернул ошибку"));
      }
      const fname = fileNameFromUrl(result.file, `output.${target}`);
      setResultFile(result.file);
      setResultName(fname);
      setProgress(100);
      setProgressText(t("Готово"));
      persistLastDoc(result.file, fname);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? t("Ошибка конвертации"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun() {
    setProgressText(t("Отменяем задачу…"));
    try {
      await cancelActiveJob("convert");
    } catch {
      /* ignore */
    }
    setBusy(false);
    setProgress(0);
    setProgressText("");
    setJobNote(t("Задача отменена."));
  }

  function download() {
    if (localResult) {
      const url = URL.createObjectURL(localResult.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = localResult.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (resultFile && engineServerOnline) {
      setDownloadError(null);
      downloadEngineFile(resultFile, resultName || `output.${target}`).catch((e: any) => {
        console.error(e);
        setDownloadError(e?.message ?? t("Не удалось скачать файл"));
      });
    }
  }

  function openDirect() {
    if (!resultFile) return;
    window.open(engineFileUrl(resultFile), "_blank", "noopener");
  }

  const kind = file ? docKindOf(file.name) : null;
  const targets = kind ? DOC_TARGETS[kind] : [];

  return (
    <div className="space-y-5">
      <div className="text-xs px-3 py-2 rounded-lg bg-[#1b2334] text-muted-foreground inline-block">
        {engineServerOnline ? (
          <>{t("🟢 Документы конвертируются на вашем компьютере (движок) — Word ↔ PDF ↔ TXT, никуда не отправляются")}</>
        ) : (
          <>{t("🟡 Движок не запущен: Word/PDF недоступны, текстовые форматы (TXT/MD/CSV/JSON) конвертируются в браузере")}</>
        )}
      </div>

      {/* Баннер обновления движка перенесён в Настройки — вкладки не засоряем сообщениями */}

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
            accept={DOC_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-4">
            <FileText className="w-8 h-8 text-[#7c5bf5]" />
          </div>
          <h3 className="font-semibold mb-1">{t("Загрузите документ")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("Word (DOCX/DOC), PDF, TXT, RTF, ODT, MD, CSV — конвертация локально на вашем компьютере")} </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-4">
              <FileText className="w-10 h-10 text-[#7c5bf5] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{file.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)}  {t("КБ")} {preview
                    ? t(" · {enc} · {n}+ символов", { enc: preview.encoding, n: preview.text.length })
                    : t(" · бинарный формат (конвертация на движке)")}
                </div>
              </div>
              <button
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                  setLocalResult(null);
                  setResultFile(null);
                  setError(null);
                }}
                className="p-2 rounded-lg text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {preview && (
              <details className="mt-3 text-xs">
                <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                  {t("Предпросмотр (")}{preview.encoding})
                </summary>
                <pre className="max-h-40 overflow-y-auto mt-2 whitespace-pre-wrap break-words text-[11px] text-muted-foreground bg-[#0b0f19] p-3 rounded-lg font-mono">
                  {preview.text}
                </pre>
              </details>
            )}
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("В формат")}</label>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-2 text-sm"
                >
                  {targets.map((t) => (
                    <option key={t.ext} value={t.ext}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={convert}
                disabled={busy}
                className="bg-gradient-primary text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />  {t("Конвертация…")} </>
                ) : (
                  t("Сконвертировать")
                )}
              </button>
            </div>

            {busy && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span>{progressText}</span>
                  <span className="text-[#7c5bf5] font-mono font-bold">{progress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#1b2334] overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-primary"
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                {engineServerOnline && supportsJobs && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-emerald-300/90">
                      {t("Задача на движке: вкладку можно переключить или закрыть — файл дождётся вас здесь.")} </span>
                    <button
                      onClick={cancelRun}
                      className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
                    >
                      <Square className="w-3 h-3" />
                      {t("Отменить")} </button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 text-sm text-red-400 bg-red-500/10 p-3 rounded-lg">{error}</div>
            )}

            {jobNote && !busy && (
              <div className="mt-4 p-3 rounded-lg border border-[#7c5bf5]/30 bg-[#7c5bf5]/10 text-xs text-[#cfc2ff] flex items-start gap-2">
                <History className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span className="flex-1">{jobNote}</span>
                <button
                  onClick={() => setJobNote(null)}
                  className="p-0.5 rounded hover:bg-white/10 flex-shrink-0"
                  title={t("Скрыть")}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {((localResult && !busy) || (resultFile && !busy)) && (
              <div className="mt-5 pt-5 border-t border-[#263147] flex items-center justify-between">
                <div className="text-sm">
                  <div className="font-medium">{localResult?.name || resultName}</div>
                  <div className="text-xs text-muted-foreground">
                    {localResult
                      ? t("{n} КБ · UTF-8", { n: (localResult.sizeKB / 1024).toFixed(1) })
                      : t("Готово — файл ждёт на диске движка")}
                  </div>
                </div>
                <button
                  onClick={download}
                  className="bg-emerald-500/15 text-emerald-400 px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2 hover:bg-emerald-500/25"
                >
                  <Download className="w-4 h-4" />
                  {t("Скачать")} </button>
              </div>
            )}
            {resultFile && !localResult && !busy && downloadError && (
              <DownloadErrorCard
                error={downloadError}
                onRetryDirect={openDirect}
                onClose={() => setDownloadError(null)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Карточка ошибки скачивания с движка — вместо молчащей кнопки объясняем
 * что произошло и что делать: фолбэк уже попробован напрямую.
 */
function DownloadErrorCard({
  error,
  onRetryDirect,
  onClose,
}: {
  error: string;
  onRetryDirect: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="glass-card rounded-2xl p-4 mt-3 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-amber-200 font-medium mb-1">{t("Скачивание не удалось")}</p>
          <p className="text-xs text-amber-200/80 mb-2">{error}</p>
          <ul className="text-xs text-amber-200/70 leading-relaxed list-disc pl-4 space-y-0.5 mb-3">
            <li>{t("Мы уже попробовали скачать файл напрямую — проверьте загрузки браузера.")}</li>
            <li>{t("Движок мог перезапуститься и удалить файл — запустите конвертацию заново.")}</li>
            <li>{t("Движок до 1.2.2 не умеет отдавать файлы с русскими названиями — обновите его (Настройки → «Доступно обновление движка»).")}</li>
          </ul>
          <button
            onClick={onRetryDirect}
            className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {t("Открыть файл напрямую")} </button>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/10 flex-shrink-0"
          title={t("Скрыть")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
