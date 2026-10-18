"use client";

import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  FileText,
  Image as ImageIcon,
  FileAudio,
  FileArchive,
  History,
  AlertTriangle,
  X,
  Square,
} from "lucide-react";
import { useState, useEffect } from "react";

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
  deleteEngineFiles,
  enginePathFromUrl,
  collectQueueFilesForDelete,
  type EngineProgress,
  type TaskResult,
} from "@/lib/engine-bridge";
import { InboxQueue, type QueueItem } from "@/components/workbench/InboxQueue";

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
      {/* Шапка вкладки — единый формат на всех вкладках */}
      <div className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
          <FileArchive className="w-5 h-5 text-[#7c5bf5]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold mb-1">{t("Конвертер")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Медиа (через локальный ffmpeg, если движок запущен — иначе ffmpeg.wasm), изображения (Canvas), документы Word ↔ PDF ↔ TXT.")} </p>
        </div>
      </div>

      {/* Переключатель разделов — тот же пилюльный стиль, что вкладки в шапке сайта */}
      <div className="inline-flex gap-1 bg-[#1b2334] rounded-xl p-1 mb-6 flex-wrap">
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
      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2 ${
        active
          ? "bg-gradient-primary text-white"
          : "text-muted-foreground hover:text-foreground"
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
  // Глобальный параметр конвертации (применяется ко всем MP3-записям при запуске)
  const [bitrate, setBitrate] = useState(192);
  // Слот фоновой задачи прошлых сессий (восстановление при возврате на вкладку)
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [resultName, setResultName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  // Отдельная заметка восстановления: её крестик чистит кеш и удаляет файл с диска движка
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [restoredConvertPath, setRestoredConvertPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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
      setRestoredConvertPath(enginePathFromUrl(r.file));
      const when = r.at ? new Date(r.at).toLocaleString() : "";
      setRestoreNote(t("Восстановлен последний готовый файл{when}.", { when: when ? t("(от {d})", { d: when }) : "" }));
    } catch {
      /* ignore */
    }
  }

  /** Крестик на баннере восстановления: кеш сбрасывается, файл удаляется с диска движка. */
  async function discardRestoredConvert() {
    setRestoreNote(null);
    try {
      localStorage.removeItem("transcrypt.lastConvert");
    } catch {
      /* ignore */
    }
    if (restoredConvertPath) {
      await deleteEngineFiles({ paths: [restoredConvertPath] });
      setRestoredConvertPath(null);
    }
  }
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
      // running — переподключаемся
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
            if (p.log?.length) setLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
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

  // ═════════ Очередь конвертации (InboxQueue, последовательная обработка) ═════════

  const runQueueItem = async (it: QueueItem, update: (patch: Partial<QueueItem>) => void) => {
    const f = it.file!;
    const outExt = it.option || "mp3";
    const base = f.name.replace(/\.[^.]+$/, "");

    if (engineServerOnline) {
      // ===== Через локальный движок (нативный ffmpeg) =====
      update({ stage: t("Загружаем файл на движок…"), percent: 10 });
      const filePath = await uploadFileToEngine(f, f.name);
      update({ percent: 25, stage: t("Конвертация на движке…") });

      const result = await convertViaEngine(
        filePath,
        outExt,
        (p: EngineProgress) => {
          update({ percent: p.percent, stage: p.stage || t("Конвертация…") });
          if (p.log?.length) setLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
        },
        f.name
      );

      if (result.status !== "success" || !result.file) {
        throw new Error(result.message || t("Движок вернул ошибку"));
      }
      const fname = fileNameFromUrl(result.file, `${base}.${outExt}`);
      persistLastConvert(result.file, fname);
      update({
        status: "done",
        percent: 100,
        stage: t("Готово"),
        finishedAt: Date.now(),
        result: { file: result.file, name: fname },
      });
      return;
    }

    // ===== Fallback на ffmpeg.wasm в браузере =====
    update({ stage: t("Загружаем ffmpeg.wasm…"), percent: 5 });
    await getFFmpeg();
    update({ percent: 15, stage: t("Конвертация через ffmpeg.wasm…") });

    const inBytes = new Uint8Array(await f.arrayBuffer());
    const outName = `output.${outExt}`;
    const isAudio = ["mp3", "wav", "aac", "ogg"].includes(outExt);
    const extra: string[] = [];
    if (isAudio) {
      if (outExt === "mp3") extra.push("-b:a", `${bitrate}k`);
      if (outExt === "wav") extra.push("-c:a", "pcm_s16le");
    } else {
      extra.push("-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac");
    }
    const out = await convertMedia(inBytes, f.name, outName, extra, (m) => {
      setLog((l) => [...l.slice(-50), m]);
    });

    const outFileName = `${base}.${outExt}`;
    const mime = isAudio ? `audio/${outExt}` : `video/${outExt}`;
    downloadBytes(outFileName, out, mime); // готовый файл сразу в загрузки
    update({
      status: "done",
      percent: 100,
      stage: t("Готово — скачано в загрузки"),
      finishedAt: Date.now(),
      result: { name: outFileName, sizeKB: Math.round((out.length / 1024) * 10) / 10, data: out, mime },
    });
  };

  /** Скачать файл карточки «последний результат» (слот прошлых сессий). */
  async function download() {
    if (!resultFile) return;
    setDownloadError(null);
    try {
      await downloadEngineFile(resultFile, resultName || "output");
    } catch (e: any) {
      console.error(e);
      setDownloadError(e?.message ?? t("Не удалось скачать файл"));
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

      {/* ЕДИНОЕ ПРИНИМАЮЩЕЕ ОКНО-ОЧЕРЕДЬ: файлы собираются в список, редактируются,
          и только кнопка «Сконвертировать» запускает обработку по очереди.
          Глобальный параметр «Битрейт MP3» — в шапке очереди (headerExtra). */}
      <InboxQueue
        title={t("Очередь конвертации")}
        intro={t("Перетащите аудио/видео файлы — можно несколько сразу. Выберите конечный формат напротив каждой записи и нажмите «Сконвертировать»: без нажатия ничего не запустится.")}
        headerExtra={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("Битрейт MP3:")} <span className="text-foreground font-medium">{bitrate} kbps</span>
            <input
              type="range"
              min={64}
              max={320}
              step={32}
              value={bitrate}
              onChange={(e) => setBitrate(Number(e.target.value))}
              className="w-28 ml-1"
            />
          </label>
        }
        acceptAttr="audio/*,video/*"
        fileFilter={(f) => {
          const mime = (f.type || "").toLowerCase();
          return mime.startsWith("audio/") || mime.startsWith("video/") || /\.(mp3|wav|m4a|m4b|aac|ogg|oga|opus|flac|wma|mp4|m4v|mkv|webm|mov|avi|flv|wmv|ts|3gp)$/i.test(f.name)
            ? null
            : t("не аудио и не видео");
        }}
        dropHint={t("Перетащите аудио/видео файлы сюда — можно несколько сразу")}
        itemOption={{
          label: t("Конечный формат"),
          title: t("В какой формат сконвертировать этот файл"),
          defaultValue: "mp3",
          options: MEDIA_FORMATS.map((f) => ({ value: f.ext, label: f.label })),
        }}
        mode="sequential"
        engineOnline={engineServerOnline}
        runItem={runQueueItem}
        startLabel={t("Сконвертировать")}
        runningLabel={t("Конвертируем…")}
        resultActions={(it, update) => {
          const r = it.result || {};
          if (r.file) {
            return (
              <button
                onClick={() => {
                  downloadEngineFile(r.file, r.name || "output").catch((e: any) => {
                    console.error(e);
                    update({ result: { ...r, downloadError: e?.message ?? t("Не удалось скачать файл") } });
                  });
                }}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-medium inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                {t("Скачать")}
              </button>
            );
          }
          if (r.data) {
            return (
              <button
                onClick={() => downloadBytes(r.name, r.data, r.mime)}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-medium inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                {t("Скачать снова")}
              </button>
            );
          }
          return null;
        }}
        footerNote={
          engineServerOnline
            ? t("Записи конвертируются по очереди на движке (нативный ffmpeg) — страница должна оставаться открытой, порядок соответствует списку.")
            : t("Записи конвертируются по очереди через ffmpeg.wasm в браузере — страница должна оставаться открытой; готовые файлы скачиваются автоматически.")
        }
        onDeleteJobFiles={(removed) => {
          // Удаление записи из списка — сконвертированный файл с движка тоже убираем
          const { paths } = collectQueueFilesForDelete(removed);
          if (paths.length) void deleteEngineFiles({ paths });
        }}
      />

      {/* Слот фоновой задачи прошлых сессий: баннеры, прогресс, результат */}
      {restoreNote && !busy && (
        <div className="glass-card rounded-2xl p-4 border border-[#7c5bf5]/30 flex items-start gap-3">
          <History className="w-4 h-4 mt-0.5 text-[#a78bfa] flex-shrink-0" />
          <span className="text-sm text-[#cfc2ff] flex-1">{restoreNote}</span>
          <button
            onClick={() => void discardRestoredConvert()}
            className="p-0.5 rounded hover:bg-white/10 flex-shrink-0"
            title={t("Скрыть и очистить: результат больше не восстановится, а его файл на диске движка будет удалён")}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      )}
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
      {busy && (
        <div className="glass-card rounded-2xl p-5">
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
        </div>
      )}
      {error && (
        <div className="glass-card rounded-2xl p-4 border-red-500/40">
          <div className="text-sm text-red-400">{t("Ошибка:")} {error}</div>
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
  );
}

function ImageConverter() {
  const { t } = useI18n();
  // Глобальный параметр: качество JPEG (применяется к JPEG-записям при запуске)
  const [quality, setQuality] = useState(0.92);

  // ═════════ Очередь конвертации изображений (Canvas, последовательно) ═════════

  const runQueueItem = async (it: QueueItem, update: (patch: Partial<QueueItem>) => void) => {
    const f = it.file!;
    const outExt = it.option || "png";
    update({ stage: t("Загружаем изображение…"), percent: 20 });
    const objectUrl = URL.createObjectURL(f);
    try {
      const img = new Image();
      img.src = objectUrl;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });

      update({ percent: 60, stage: t("Конвертация…") });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error(t("Canvas не поддерживается"));
      ctx.drawImage(img, 0, 0);

      const mime = `image/${outExt}`;
      const blob: Blob = await new Promise((res) =>
        canvas.toBlob(
          (b) => res(b as Blob),
          mime,
          outExt === "jpeg" ? quality : undefined
        )
      );
      if (!blob) throw new Error(t("Не удалось сконвертировать"));

      const baseName = f.name.replace(/\.[^.]+$/, "");
      const outName = `${baseName}.${outExt}`;
      // Готовый файл сразу в загрузки — как и в одиночном режиме раньше
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      update({
        status: "done",
        percent: 100,
        stage: t("Готово — скачано в загрузки"),
        finishedAt: Date.now(),
        result: { name: outName, sizeKB: Math.round((blob.size / 1024) * 10) / 10, blob },
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  return (
    <div className="space-y-5">
      {/* Глобальные параметры: применяются к JPEG-записям при запуске */}
      <div className="glass-card rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3">
        <label className="text-xs text-muted-foreground flex items-center gap-2 min-w-56 flex-1">
          {t("Качество JPEG:")} <span className="text-foreground font-medium">{Math.round(quality * 100)}%</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.01}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-full ml-2"
          />
        </label>
      </div>

      {/* ЕДИНОЕ ПРИНИМАЮЩЕЕ ОКНО-ОЧЕРЕДЬ: изображения собираются в список,
          редактируются, и только кнопка «Сконвертировать» запускает обработку. */}
      <InboxQueue
        title={t("Очередь конвертации изображений")}
        intro={t("Перетащите изображения — можно несколько сразу. Выберите конечный формат напротив каждой записи и нажмите «Сконвертировать»: без нажатия ничего не запустится.")}
        acceptAttr="image/*"
        fileFilter={(f) =>
          f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)
            ? null
            : t("не изображение (PNG, JPEG, WebP)")
        }
        dropHint={t("Перетащите изображения сюда — можно несколько сразу")}
        itemOption={{
          label: t("Конечный формат"),
          title: t("В какой формат сконвертировать это изображение"),
          defaultValue: "png",
          options: [
            { value: "png", label: t("PNG (без потерь)") },
            { value: "jpeg", label: t("JPEG (сжатие)") },
            { value: "webp", label: t("WebP (компактный)") },
          ],
        }}
        mode="sequential"
        engineOnline={false} // Canvas — всё в браузере, движок не нужен
        runItem={runQueueItem}
        startLabel={t("Сконвертировать")}
        runningLabel={t("Конвертируем…")}
        resultActions={(it) => {
          const r = it.result || {};
          if (!r.blob) return null;
          return (
            <button
              onClick={() => {
                const url = URL.createObjectURL(r.blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = r.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-medium inline-flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              {t("Скачать снова")}
            </button>
          );
        }}
        footerNote={t("Конвертация идёт в браузере (Canvas): записи обрабатываются по очереди, готовые файлы скачиваются автоматически. Страницу не закрывайте до завершения.")}
      />
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
  // Слот фоновой задачи прошлых сессий (восстановление при возврате на вкладку)
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  // Отдельная заметка восстановления: её крестик чистит кеш и удаляет файл с диска движка
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [restoredDocPath, setRestoredDocPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [resultName, setResultName] = useState("");

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
      setRestoredDocPath(enginePathFromUrl(r.file));
      const when = r.at ? new Date(r.at).toLocaleString() : "";
      setRestoreNote(t("Восстановлен последний готовый файл{when}.", { when: when ? t("(от {d})", { d: when }) : "" }));
    } catch {
      /* ignore */
    }
  }

  /** Крестик на баннере восстановления: кеш сбрасывается, файл удаляется с диска движка. */
  async function discardRestoredDoc() {
    setRestoreNote(null);
    try {
      localStorage.removeItem("transcrypt.lastConvert");
    } catch {
      /* ignore */
    }
    if (restoredDocPath) {
      await deleteEngineFiles({ paths: [restoredDocPath] });
      setRestoredDocPath(null);
    }
  }

  // ═══ Восстановление фоновой задачи (слот прошлых сессий) ═══
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

  // ═════════ Очередь конвертации документов (InboxQueue, последовательная) ═════════

  /** Опции формата зависят от типа файла: Word → PDF/TXT, PDF → DOCX/TXT, текст → TXT/JSON/MD. */
  const docOptionsFor = (it: QueueItem): { value: string; label: string }[] => {
    const kind = docKindOf(it.label) ?? "text";
    return DOC_TARGETS[kind].map((x) => ({ value: x.ext, label: x.label }));
  };

  const runQueueItem = async (it: QueueItem, update: (patch: Partial<QueueItem>) => void) => {
    const f = it.file!;
    const target = it.option;
    const kind = docKindOf(f.name);
    if (!kind) {
      throw new Error(t("Неподдерживаемый формат файла. Возьмите DOCX, DOC, PDF, TXT, MD, CSV, RTF или ODT."));
    }
    const spec = DOC_TARGETS[kind].find((x) => x.ext === target);
    if (!spec) {
      throw new Error(t("Выбранный формат не подходит для этого файла — выберите другой в списке."));
    }

    // ── Локальные текст-преобразования: работают даже без движка ──
    if (!spec.engine) {
      update({ stage: t("Читаем файл…"), percent: 30 });
      const { text } = await decodeTextFile(f);
      let out = text;
      if (target === "json") {
        try {
          out = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          out = JSON.stringify({ content: text }, null, 2);
        }
      }
      const blob = new Blob([out], { type: "text/plain;charset=utf-8" });
      const base = f.name.replace(/\.[^.]+$/, "");
      const outName = `${base}.${target}`;
      downloadBytes(outName, new Uint8Array(await blob.arrayBuffer()), "text/plain;charset=utf-8");
      update({
        status: "done",
        percent: 100,
        stage: t("Готово — скачано в загрузки"),
        finishedAt: Date.now(),
        result: { name: outName, sizeKB: blob.size },
      });
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

    update({ stage: t("Загружаем файл на движок…"), percent: 10 });
    const filePath = await uploadFileToEngine(f, f.name);
    update({ percent: 25, stage: t("Конвертация на движке…") });

    const result = await convertViaEngine(
      filePath,
      target,
      (p: EngineProgress) => {
        update({ percent: Math.max(25, p.percent), stage: p.stage || t("Конвертация…") });
      },
      f.name
    );

    if (result.status !== "success" || !result.file) {
      throw new Error(result.message || t("Движок вернул ошибку"));
    }
    const fname = fileNameFromUrl(result.file, `output.${target}`);
    persistLastDoc(result.file, fname);
    update({
      status: "done",
      percent: 100,
      stage: t("Готово"),
      finishedAt: Date.now(),
      result: { file: result.file, name: fname },
    });
  };

  /** Скачать файл карточки «последний результат» (слот прошлых сессий). */
  function download() {
    if (!resultFile) return;
    setDownloadError(null);
    downloadEngineFile(resultFile, resultName || "output").catch((e: any) => {
      console.error(e);
      setDownloadError(e?.message ?? t("Не удалось скачать файл"));
    });
  }

  function openDirect() {
    if (!resultFile) return;
    window.open(engineFileUrl(resultFile), "_blank", "noopener");
  }

  return (
    <div className="space-y-5">
      <div className="text-xs px-3 py-2 rounded-lg bg-[#1b2334] text-muted-foreground inline-block">
        {engineServerOnline ? (
          <>{t("🟢 Документы конвертируются на вашем компьютере (движок) — Word ↔ PDF ↔ TXT, никуда не отправляются")}</>
        ) : (
          <>{t("🟡 Движок не запущен: Word/PDF недоступны, текстовые форматы (TXT/MD/CSV/JSON) конвертируются в браузере")}</>
        )}
      </div>

      {/* ЕДИНОЕ ПРИНИМАЮЩЕЕ ОКНО-ОЧЕРЕДЬ: документы собираются в список, редактируются,
          и только кнопка «Сконвертировать» запускает обработку по очереди. */}
      <InboxQueue
        title={t("Очередь конвертации документов")}
        intro={t("Перетащите документы — можно несколько сразу. Формат напротив каждой записи зависит от типа файла; запуск — только по кнопке «Сконвертировать».")}
        acceptAttr={DOC_ACCEPT}
        fileFilter={(f) =>
          docKindOf(f.name) ? null : t("не документ (DOCX, DOC, PDF, TXT, MD, CSV, RTF, ODT)")
        }
        dropHint={t("Перетащите документы сюда — Word, PDF, TXT, RTF, ODT, MD, CSV")}
        itemOption={{
          label: t("Конечный формат"),
          title: t("Формат сохранения — список зависит от типа файла"),
          defaultValue: (meta) => DOC_TARGETS[docKindOf(meta.name) ?? "text"][0].ext,
          options: docOptionsFor,
        }}
        mode="sequential"
        engineOnline={engineServerOnline}
        runItem={runQueueItem}
        startLabel={t("Сконвертировать")}
        runningLabel={t("Конвертируем…")}
        resultActions={(it, update) => {
          const r = it.result || {};
          if (!r.file) return null;
          return (
            <button
              onClick={() => {
                downloadEngineFile(r.file, r.name || "output").catch((e: any) => {
                  console.error(e);
                  update({ result: { ...r, downloadError: e?.message ?? t("Не удалось скачать файл") } });
                });
              }}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-medium inline-flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              {t("Скачать")}
            </button>
          );
        }}
        footerNote={
          engineServerOnline
            ? t("Записи конвертируются по очереди на движке — страница должна оставаться открытой, порядок соответствует списку.")
            : t("Без движка конвертируются только текстовые форматы (TXT/MD/CSV/JSON) — готовые файлы скачиваются автоматически. Word и PDF требуют запущенный движок.")
        }
        onDeleteJobFiles={(removed) => {
          // Удаление записи из списка — сконвертированный файл с движка тоже убираем
          const { paths } = collectQueueFilesForDelete(removed);
          if (paths.length) void deleteEngineFiles({ paths });
        }}
      />

      {/* Слот фоновой задачи прошлых сессий: баннеры, прогресс, результат */}
      {restoreNote && !busy && (
        <div className="glass-card rounded-2xl p-4 border border-[#7c5bf5]/30 flex items-start gap-3">
          <History className="w-4 h-4 mt-0.5 text-[#a78bfa] flex-shrink-0" />
          <span className="text-sm text-[#cfc2ff] flex-1">{restoreNote}</span>
          <button
            onClick={() => void discardRestoredDoc()}
            className="p-0.5 rounded hover:bg-white/10 flex-shrink-0"
            title={t("Скрыть и очистить: результат больше не восстановится, а его файл на диске движка будет удалён")}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      )}
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
      {busy && (
        <div className="glass-card rounded-2xl p-5">
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
        </div>
      )}
      {error && (
        <div className="glass-card rounded-2xl p-4 border-red-500/40">
          <div className="text-sm text-red-400">{t("Ошибка:")} {error}</div>
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
