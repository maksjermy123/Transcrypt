"use client";

import { motion } from "framer-motion";
import {
  Download,
  FileAudio,
  FileVideo,
  Loader2,
  Music,
  Trash2,
  Upload,
  Link2,
  Sparkles,
  Film,
  Settings2,
  ServerOff,
  History,
  X,
  Square,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { EngineUpdateGuide, isEngineOutdated } from "@/components/workbench/EngineUpdateGuide";
import {
  mediaViaEngine,
  downloadEngineFile,
  engineFileUrl,
  uploadFileToEngine,
  resumeActiveJob,
  watchJobToCompletion,
  clearActiveJob,
  cancelActiveJob,
  type EngineProgress,
  type MediaAction,
  type TaskResult,
} from "@/lib/engine-bridge";

const ACTIONS: { id: MediaAction; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { id: "download_video", label: "Скачать видео", icon: FileVideo, desc: "Скачать видео с YouTube/TikTok/Instagram в MP4 через yt-dlp (impersonate Chrome)" },
  { id: "download_audio", label: "Скачать аудио", icon: Music, desc: "Извлечь аудиодорожку в MP3 192 kbps" },
  { id: "clean_audio", label: "Очистить аудио", icon: Sparkles, desc: "Шумоподавление + нормализация громкости через ffmpeg" },
  { id: "hardsub", label: "Вшить субтитры", icon: Film, desc: "Hardsub: рендер субтитров прямо в кадры видео. Субтитры берутся с YouTube или генерируются через Whisper" },
];

/** Аудио/видео расширения — для drag&drop, когда браузер не дал MIME-тип (macOS). */
const AV_EXT_RE = /\.(mp3|wav|m4a|m4b|aac|ogg|oga|opus|flac|wma|mp4|m4v|mkv|webm|mov|avi|flv|wmv|ts|3gp)$/i;
const VIDEO_EXT_RE = /\.(mp4|m4v|mkv|webm|mov|avi|flv|wmv|ts|3gp)$/i;
const SUB_EXT_RE = /\.(srt|vtt)$/i;

export function MediaTab() {
  const { engineServerOnline, selectedModel, engineServerHealth } = useOnboarding();
  const supportsJobs = !!engineServerHealth?.jobs;
  const supportsQueue = !!engineServerHealth?.queue; // движок ≥ 1.2.0: очереди задач
  const [action, setAction] = useState<MediaAction>("download_video");
  const [url, setUrl] = useState("");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localFileName, setLocalFileName] = useState("");
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [subtitleName, setSubtitleName] = useState("");
  const [subLang, setSubLang] = useState("ru");
  // Перевод субтитров при вшивании ("-" — без перевода)
  const [subTranslate, setSubTranslate] = useState("-");
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [dragFileOver, setDragFileOver] = useState(false);
  const [dragSubOver, setDragSubOver] = useState(false);

  /** Вытаскиваем имя файла из URL /api/download?file=/path/to/file.mp4 */
  function fileNameFromUrl(fileUrl: string): string {
    try {
      const u = new URL(fileUrl.startsWith("http") ? fileUrl : `http://x${fileUrl}`);
      const fp = u.searchParams.get("file") || u.pathname;
      return decodeURIComponent(fp.split("/").pop() || "output.bin");
    } catch {
      return "output.bin";
    }
  }

  function persistLastMedia(fileUrl: string, fname: string) {
    try {
      localStorage.setItem(
        "transcrypt.lastMedia",
        JSON.stringify({ at: Date.now(), file: fileUrl, name: fname, action })
      );
    } catch {
      /* ignore */
    }
  }

  function restoreLastMedia() {
    try {
      const raw = localStorage.getItem("transcrypt.lastMedia");
      if (!raw) return;
      const r = JSON.parse(raw);
      if (!r?.file) return;
      setResultFile(r.file);
      setResultName(r.name || "output.bin");
      setPhase("done");
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
        outcome = await resumeActiveJob("media");
      } catch {
        restoreLastMedia();
        return;
      }
      if (cancelled) return;
      if (outcome.state === "none" || outcome.state === "offline") {
        restoreLastMedia();
        return;
      }
      if (outcome.state === "lost") {
        clearActiveJob("media");
        setJobNote("Прошлая фоновая задача не найдена — движок перезапускался.");
        restoreLastMedia();
        return;
      }
      if (outcome.state === "error") {
        clearActiveJob("media");
        setError(outcome.job.error || "Фоновая задача завершилась с ошибкой");
        setPhase("error");
        return;
      }
      const rec = outcome.record;
      if (outcome.state === "done") {
        clearActiveJob("media"); // результат забрали — слот освобождаем
        const res = outcome.job.result as TaskResult;
        if (res?.file) {
          setResultFile(res.file);
          setResultName(fileNameFromUrl(res.file));
          setPhase("done");
          setProgress(100);
          setJobNote("Фоновая задача завершилась, пока вас не было — файл готов.");
        } else {
          setJobNote(res?.message || "Фоновая задача завершилась.");
        }
        return;
      }
      // running — переподключаемся
      setPhase("running");
      setProgress(1);
      setProgressText("Переподключение к фоновой задаче…");
      setJobNote("Задача выполнялась в фоне — снова следим за ней.");
      try {
        const res = await watchJobToCompletion<TaskResult>(
          rec.jobId,
          (p: EngineProgress) => {
            setProgress(p.percent);
            setProgressText(p.stage || "Обработка…");
            setJobNote((n) =>
              p.stage?.startsWith("В очереди")
                ? "Задача стоит в очереди — движок выполняет другую задачу (например, транскрипцию). Она начнётся автоматически: ничего не пропадёт."
                : n?.startsWith("Задача стоит в очереди")
                  ? null
                  : n
            );
            if (p.log?.length) setProgressLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
          },
          "media"
        );
        if (cancelled) return;
        if (res.status !== "success" || !res.file) {
          throw new Error(res.message || "Движок вернул ошибку");
        }
        setResultFile(res.file);
        setResultName(fileNameFromUrl(res.file));
        setPhase("done");
        setProgress(100);
        setProgressText("Готово");
        persistLastMedia(res.file, fileNameFromUrl(res.file));
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Ошибка фоновой задачи");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Предупреждение при закрытии/обновлении страницы во время задачи
  useEffect(() => {
    if (phase !== "running") return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);

  async function cancelRun() {
    setProgressText("Отменяем задачу…");
    try {
      await cancelActiveJob("media");
    } catch {
      /* ignore */
    }
    setPhase("idle");
    setProgress(0);
    setProgressText("");
    setJobNote("Задача отменена.");
  }

  function reset() {
    setLocalFile(null);
    setLocalFileName("");
    setSubtitleFile(null);
    setSubtitleName("");
    setResultFile(null);
    setResultName("");
    setProgress(0);
    setProgressText("");
    setError(null);
    setPhase("idle");
    setProgressLog([]);
    setJobNote(null);
    setDownloadError(null);
    try {
      localStorage.removeItem("transcrypt.lastMedia");
    } catch {
      /* ignore */
    }
  }

  function pickLocalFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLocalFile(f);
    setLocalFileName(f.name);
    setResultFile(null);
    setError(null);
  }

  function pickSubtitleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setSubtitleFile(f);
    setSubtitleName(f.name);
  }

  // ─── Drag&drop: macOS часто отдаёт файлы с пустым MIME — доверяем и расширению ───
  function dropMediaFile(e: React.DragEvent) {
    e.preventDefault();
    setDragFileOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    const t = (f.type || "").toLowerCase();
    if (action === "clean_audio") {
      const avOk = t.startsWith("audio/") || t.startsWith("video/") || AV_EXT_RE.test(f.name);
      if (!avOk) {
        setError("Перетащите аудио- или видео-файл (MP3, WAV, M4A, MP4, MKV…)");
        return;
      }
    } else if (!(t.startsWith("video/") || VIDEO_EXT_RE.test(f.name))) {
      setError("Для вшивания субтитров перетащите видео (MP4, MKV, WebM, MOV…)");
      return;
    }
    setLocalFile(f);
    setLocalFileName(f.name);
    setResultFile(null);
    setError(null);
  }

  function dropSubtitleFile(e: React.DragEvent) {
    e.preventDefault();
    setDragSubOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    const t = (f.type || "").toLowerCase();
    if (!(t.startsWith("text/") || SUB_EXT_RE.test(f.name))) {
      setError("Перетащите файл субтитров .srt или .vtt");
      return;
    }
    setSubtitleFile(f);
    setSubtitleName(f.name);
    setError(null);
  }

  async function run() {
    if (!engineServerOnline) {
      setError("Медиа-операции требуют локальный движок (engine_server.py). Запустите его и обновите страницу.");
      return;
    }

    setError(null);
    setResultFile(null);
    setProgressLog([]);
    setProgress(0);
    setPhase("running");
    setProgressText("Запускаем задачу на движке…");
    setJobNote(null);
    setDownloadError(null);

    try {
      let filePath: string | undefined;
      let subFilePath: string | undefined;

      // Для clean/hardsub: загружаем локальный файл если есть
      if (action === "clean_audio" || action === "hardsub") {
        if (localFile) {
          setProgressText("Загружаем файл на движок…");
          setProgress(15);
          filePath = await uploadFileToEngine(localFile, localFileName);
          setProgress(25);
        }
        if (action === "hardsub" && subtitleFile) {
          setProgressText("Загружаем субтитры на движок…");
          subFilePath = await uploadFileToEngine(subtitleFile, subtitleName);
          setProgress(30);
        }
      }

      setProgressText("Запуск обработки на движке…");
      const result = await mediaViaEngine(
        {
          action,
          url: url.trim() || undefined,
          file_path: filePath,
          sub_file: subFilePath,
          sub_lang: subLang,
          model: selectedModel ?? "base",
          translate_to: action === "hardsub" ? subTranslate : undefined,
        },
        (p: EngineProgress) => {
          setProgress(p.percent);
          setProgressText(p.stage || "Обработка…");
          setJobNote((n) =>
            p.stage?.startsWith("В очереди")
              ? "Задача стоит в очереди — движок выполняет другую задачу (например, транскрипцию). Она начнётся автоматически: ничего не пропадёт, можно переключать вкладки."
              : n?.startsWith("Задача стоит в очереди")
                ? null
                : n
          );
          if (p.log?.length) {
            setProgressLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
          }
        },
        url.trim() || localFileName || action
      );

      if (result.status !== "success" || !result.file) {
        throw new Error(result.message || "Движок вернул ошибку");
      }

      const fileUrl = result.file;
      const fname = fileNameFromUrl(fileUrl);
      setResultFile(fileUrl);
      setResultName(fname);
      setPhase("done");
      setProgress(100);
      setProgressText("Готово");
      persistLastMedia(fileUrl, fname);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Ошибка обработки");
      setPhase("error");
    }
  }

  async function download() {
    if (!resultFile) return;
    setDownloadError(null);
    try {
      await downloadEngineFile(resultFile, resultName || "output");
    } catch (e: any) {
      console.error(e);
      setDownloadError(e?.message ?? "Не удалось скачать файл");
    }
  }

  function openDirect() {
    if (!resultFile) return;
    window.open(engineFileUrl(resultFile), "_blank", "noopener");
  }

  const needsUrl = action === "download_video" || action === "download_audio" || !localFile;
  const needsFile = action === "clean_audio" || action === "hardsub";
  const needsSubs = action === "hardsub";

  // Если движок недоступен — показываем предупреждение
  if (!engineServerOnline) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Медиа операции</h1>
          <p className="text-sm text-muted-foreground">
            Скачать видео/аудио, очистить аудио, вшить субтитры — через локальный движок с yt-dlp и ffmpeg.
          </p>
        </div>

        <div className="glass-card rounded-2xl p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/15 mb-4">
            <ServerOff className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className="font-semibold mb-2">Локальный движок не найден</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
            Медиа-операции (скачивание с YouTube, очистка аудио, hardsub) работают через локальный Python-движок — только yt-dlp умеет обходить блокировки YouTube и только ffmpeg поддерживает все форматы.
          </p>
          <div className="text-left max-w-md mx-auto bg-[#0b0f19] rounded-xl p-4 font-mono text-xs space-y-1">
            <div className="text-muted-foreground"># Установить зависимости (один раз):</div>
            <div className="text-foreground">pip install -r requirements.txt</div>
            <div className="text-muted-foreground mt-2"># Запустить движок:</div>
            <div className="text-foreground">python engine_server.py</div>
            <div className="text-muted-foreground mt-2"># Движок откроется на http://127.0.0.1:8765</div>
            <div className="text-muted-foreground"># Обновите эту страницу — индикатор станет зелёным</div>
          </div>
          <a
            href="https://github.com/maksjermy123/Transcrypt#-локальный-движок-опционально-для-url-задач"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-5 text-[#7c5bf5] hover:underline text-sm"
          >
            Подробная инструкция в README →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Медиа операции</h1>
        <p className="text-sm text-muted-foreground">
          Скачать видео/аудио, очистить звук, вшить субтитры. Все операции через локальный движок с yt-dlp (обходит блокировки YouTube) и ffmpeg.
        </p>
      </div>

      {/* Старый движок — инструкция обновления раскрывается на месте */}
      {engineServerOnline && engineServerHealth && !supportsJobs && (
        <EngineUpdateGuide reason="no-jobs" health={engineServerHealth} />
      )}
      {engineServerOnline && engineServerHealth && supportsJobs && !supportsQueue && (
        <EngineUpdateGuide reason="no-queue" health={engineServerHealth} />
      )}
      {engineServerOnline && engineServerHealth && supportsJobs && supportsQueue && isEngineOutdated(engineServerHealth) && (
        <EngineUpdateGuide reason="outdated" health={engineServerHealth} />
      )}

      {/* Баннер восстановления фоновой задачи / результата */}
      {jobNote && (
        <div className="mb-5 p-3 rounded-xl border border-[#7c5bf5]/30 bg-[#7c5bf5]/10 text-sm text-[#cfc2ff] flex items-start gap-3">
          <History className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="flex-1">{jobNote}</span>
          <button
            onClick={() => setJobNote(null)}
            className="p-1 rounded-md hover:bg-white/10 flex-shrink-0"
            title="Скрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Выбор действия */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          const active = action === a.id;
          return (
            <button
              key={a.id}
              onClick={() => {
                setAction(a.id);
                reset();
              }}
              className={`p-4 rounded-xl text-left transition-all ${
                active
                  ? "bg-gradient-primary text-white glow-primary"
                  : "glass-card hover:border-[#7c5bf5]/50"
              }`}
            >
              <Icon className="w-5 h-5 mb-2" />
              <div className="font-medium text-sm mb-0.5">{a.label}</div>
              <div className={`text-xs ${active ? "text-white/80" : "text-muted-foreground"}`}>
                {a.desc}
              </div>
            </button>
          );
        })}
      </div>

      {/* URL input */}
      {needsUrl && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-5 mb-4"
        >
          <label className="text-xs text-muted-foreground mb-2 block">
            {action === "clean_audio" || action === "hardsub"
              ? "URL источника (опционально, если нет локального файла)"
              : "Ссылка на видео"}
          </label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Link2 className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
                className="w-full bg-[#0b0f19] border border-[#263147] rounded-xl pl-10 pr-3 py-3 text-sm focus:outline-none focus:border-[#7c5bf5]/50"
              />
            </div>
          </div>
        </motion.div>
      )}

      {/* Local file input (для clean/hardsub) */}
      {needsFile && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragFileOver(true);
          }}
          onDragLeave={() => setDragFileOver(false)}
          onDrop={dropMediaFile}
          className="glass-card rounded-2xl p-5 mb-4"
        >
          <label className="text-xs text-muted-foreground mb-2 block">
            {action === "clean_audio" ? "Аудио-файл (или используйте URL выше) — можно перетащить сюда" : "Видео-файл (или используйте URL выше) — можно перетащить сюда"}
          </label>
          {!localFile ? (
            <label className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragFileOver ? "border-[#7c5bf5] bg-[#7c5bf5]/5" : "border-[#263147] hover:border-[#7c5bf5]/50"
            }`}>
              <input
                type="file"
                accept={action === "clean_audio" ? "audio/*,video/*" : "video/*"}
                hidden
                onChange={pickLocalFile}
              />
              <Upload className={`w-6 h-6 mx-auto mb-2 ${dragFileOver ? "text-[#7c5bf5]" : "text-muted-foreground"}`} />
              <span className="text-sm text-foreground">
                {dragFileOver ? "Отпустите файл здесь" : "Нажмите или перетащите файл"}
              </span>
            </label>
          ) : (
            <div className="flex items-center gap-3">
              <FileAudio className="w-5 h-5 text-[#7c5bf5]" />
              <span className="text-sm flex-1 truncate">{localFileName}</span>
              <button
                onClick={() => {
                  setLocalFile(null);
                  setLocalFileName("");
                }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* Subtitle file (для hardsub) */}
      {needsSubs && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragSubOver(true);
          }}
          onDragLeave={() => setDragSubOver(false)}
          onDrop={dropSubtitleFile}
          className="glass-card rounded-2xl p-5 mb-4"
        >
          <label className="text-xs text-muted-foreground mb-2 block">
            Файл субтитров (.srt или .vtt) — опционально, можно перетащить
          </label>
          {!subtitleFile ? (
            <label className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragSubOver ? "border-[#7c5bf5] bg-[#7c5bf5]/5" : "border-[#263147] hover:border-[#7c5bf5]/50"
            }`}>
              <input
                type="file"
                accept=".srt,.vtt,text/vtt,application/x-subrip"
                hidden
                onChange={pickSubtitleFile}
              />
              <Film className={`w-6 h-6 mx-auto mb-2 ${dragSubOver ? "text-[#7c5bf5]" : "text-muted-foreground"}`} />
              <span className="text-sm text-foreground">
                {dragSubOver ? "Отпустите файл здесь" : "Загрузите .srt или .vtt"}
              </span>
              <span className="block text-xs text-muted-foreground mt-1">
                Если не указать, движок попробует скачать субтитры с YouTube (язык: {subLang}),
                а если их нет — сгенерирует через Whisper.
              </span>
            </label>
          ) : (
            <div className="flex items-center gap-3">
              <Film className="w-5 h-5 text-[#7c5bf5]" />
              <span className="text-sm flex-1 truncate">{subtitleName}</span>
              <button
                onClick={() => {
                  setSubtitleFile(null);
                  setSubtitleName("");
                }}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
              <label className="text-xs text-muted-foreground">Язык субтитров для поиска на YouTube:</label>
              <select
                value={subLang}
                onChange={(e) => setSubLang(e.target.value)}
                className="bg-[#0b0f19] border border-[#263147] rounded-lg px-2 py-1 text-xs"
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
                <option value="uk">Українська</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
                <option value="it">Italiano</option>
                <option value="pt">Português</option>
                <option value="pl">Polski</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Перевести субтитры на:</label>
              <select
                value={subTranslate}
                onChange={(e) => setSubTranslate(e.target.value)}
                className="bg-[#0b0f19] border border-[#263147] rounded-lg px-2 py-1 text-xs"
              >
                <option value="-">Без перевода</option>
                <option value="ru">Русский</option>
                <option value="en">English</option>
                <option value="uk">Українська</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
                <option value="it">Italiano</option>
                <option value="pt">Português</option>
                <option value="pl">Polski</option>
                <option value="tr">Türkçe</option>
              </select>
            </div>
          </div>
        </motion.div>
      )}

      {/* ffmpeg отсутствует на движке — hardsub/очистка не сработают */}
      {(action === "hardsub" || action === "clean_audio") && engineServerHealth && engineServerHealth.ffmpeg === false && (
        <div className="glass-card rounded-2xl p-4 mb-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-amber-200 font-medium mb-1">На движке нет ffmpeg</p>
              <p className="text-xs text-amber-200/80 leading-relaxed">
                Эта операция требует ffmpeg. Переустановите движок той же командой — установщик
                скачает его автоматически. Или вручную: <code className="font-mono">brew install ffmpeg</code> (macOS) /{" "}
                <code className="font-mono">apt install ffmpeg</code> (Linux).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Описание конвейера hardsub */}
      {action === "hardsub" && (
        <div className="text-xs text-muted-foreground mb-4 px-1 leading-relaxed">
          Конвейер: скачивание видео → субтитры (YouTube или Whisper) → перевод (по желанию) →{" "}
          <span className="text-foreground">умное вшивание</span>: субтитры внизу по центру с отступами
          и обводкой — не перекрывают центр кадра, размер шрифта подстраивается под разрешение.
        </div>
      )}

      {/* Run button */}
      <div className="flex justify-center mb-5">
        <button
          onClick={run}
          disabled={phase === "running"}
          className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 glow-primary"
        >
          {phase === "running" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {progressText || "Обработка…"}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              {action === "download_video" && "Скачать видео"}
              {action === "download_audio" && "Скачать аудио"}
              {action === "clean_audio" && "Очистить аудио"}
              {action === "hardsub" && "Вшить субтитры"}
            </>
          )}
        </button>
      </div>

      {/* Progress */}
      {phase === "running" && (
        <div className="glass-card rounded-2xl p-5 mb-4">
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
          {progressLog.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                Лог ({progressLog.length} строк)
              </summary>
              <div className="max-h-32 overflow-y-auto mt-2 font-mono text-[10px] text-muted-foreground bg-[#0b0f19] p-2 rounded-lg">
                {progressLog.map((l, i) => (
                  <div key={i} className="truncate">{l}</div>
                ))}
              </div>
            </details>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-emerald-300/90 inline-flex items-center gap-1.5">
              {supportsJobs
                ? supportsQueue
                  ? "Задача идёт на движке: можно переключать вкладки и запускать задачи в других разделах — они пойдут параллельно или встанут в очередь, ничего не пропадёт."
                  : "Задача выполняется на движке: можно переключать вкладки или закрыть браузер — файл дождётся вас здесь."
                : "Задача идёт в этой вкладке — не закрывайте её. Обновите движок, чтобы задачи выполнялись в фоне."}
            </span>
            <button
              onClick={cancelRun}
              className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
            >
              <Square className="w-3 h-3" />
              Отменить
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="glass-card rounded-2xl p-4 mb-4 border-red-500/40">
          <div className="text-sm text-red-400">Ошибка: {error}</div>
        </div>
      )}

      {/* Результат */}
      {phase === "done" && resultFile && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-5"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Download className="w-5 h-5 text-emerald-500" />
                <h3 className="font-semibold">Файл готов!</h3>
              </div>
              <div className="text-sm text-foreground">{resultName}</div>
            </div>
            <button
              onClick={download}
              className="bg-emerald-500/15 text-emerald-400 px-5 py-2.5 rounded-xl font-medium inline-flex items-center gap-2 hover:bg-emerald-500/25"
            >
              <Download className="w-4 h-4" />
              Скачать
            </button>
          </div>
        </motion.div>
      )}

      {/* Ошибка скачивания результата — раньше молчала, теперь объясняем что делать */}
      {phase === "done" && resultFile && downloadError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4 mt-3 border-amber-500/30 bg-amber-500/5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-200 font-medium mb-1">Скачивание не удалось</p>
              <p className="text-xs text-amber-200/80 mb-2">{downloadError}</p>
              <ul className="text-xs text-amber-200/70 leading-relaxed list-disc pl-4 space-y-0.5 mb-3">
                <li>Мы уже попробовали скачать файл напрямую — проверьте загрузки браузера.</li>
                <li>Движок мог перезапуститься и удалить файл — запустите задачу заново.</li>
                <li>Движок до 1.2.2 не умеет отдавать файлы с русскими названиями — обновите его (Настройки → «Доступно обновление движка»).</li>
              </ul>
              <button
                onClick={openDirect}
                className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Открыть файл напрямую
              </button>
            </div>
            <button
              onClick={() => setDownloadError(null)}
              className="p-1 rounded-md hover:bg-white/10 flex-shrink-0"
              title="Скрыть"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
