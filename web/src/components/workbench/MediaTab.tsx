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
} from "lucide-react";
import { useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import {
  mediaViaEngine,
  downloadEngineFile,
  uploadFileToEngine,
  type EngineProgress,
  type MediaAction,
} from "@/lib/engine-bridge";

const ACTIONS: { id: MediaAction; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { id: "download_video", label: "Скачать видео", icon: FileVideo, desc: "Скачать видео с YouTube/TikTok/Instagram в MP4 через yt-dlp (impersonate Chrome)" },
  { id: "download_audio", label: "Скачать аудио", icon: Music, desc: "Извлечь аудиодорожку в MP3 192 kbps" },
  { id: "clean_audio", label: "Очистить аудио", icon: Sparkles, desc: "Шумоподавление + нормализация громкости через ffmpeg" },
  { id: "hardsub", label: "Вшить субтитры", icon: Film, desc: "Hardsub: рендер субтитров прямо в кадры видео. Субтитры берутся с YouTube или генерируются через Whisper" },
];

export function MediaTab() {
  const { engineServerOnline } = useOnboarding();
  const [action, setAction] = useState<MediaAction>("download_video");
  const [url, setUrl] = useState("");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localFileName, setLocalFileName] = useState("");
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [subtitleName, setSubtitleName] = useState("");
  const [subLang, setSubLang] = useState("ru");
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

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
          model: "base",
        },
        (p: EngineProgress) => {
          setProgress(p.percent);
          setProgressText(p.stage || "Обработка…");
          if (p.log?.length) {
            setProgressLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
          }
        }
      );

      if (result.status !== "success" || !result.file) {
        throw new Error(result.message || "Движок вернул ошибку");
      }

      // Извлекаем имя файла из URL /api/download?file=/path/to/file.mp4
      const fileUrl = result.file;
      let fname = "output.bin";
      try {
        const u = new URL(fileUrl.startsWith("http") ? fileUrl : `http://x${fileUrl}`);
        const fp = u.searchParams.get("file") || u.pathname;
        fname = decodeURIComponent(fp.split("/").pop() || "output.bin");
      } catch {
        /* ignore */
      }

      setResultFile(fileUrl);
      setResultName(fname);
      setPhase("done");
      setProgress(100);
      setProgressText("Готово");
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Ошибка обработки");
      setPhase("error");
    }
  }

  async function download() {
    if (!resultFile) return;
    await downloadEngineFile(resultFile, resultName || "output");
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
          className="glass-card rounded-2xl p-5 mb-4"
        >
          <label className="text-xs text-muted-foreground mb-2 block">
            {action === "clean_audio" ? "Аудио-файл (или используйте URL выше)" : "Видео-файл (или используйте URL выше)"}
          </label>
          {!localFile ? (
            <label className="block border-2 border-dashed border-[#263147] rounded-xl p-6 text-center cursor-pointer hover:border-[#7c5bf5]/50 transition-colors">
              <input
                type="file"
                accept={action === "clean_audio" ? "audio/*,video/*" : "video/*"}
                hidden
                onChange={pickLocalFile}
              />
              <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <span className="text-sm text-foreground">Нажмите, чтобы выбрать файл</span>
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
          className="glass-card rounded-2xl p-5 mb-4"
        >
          <label className="text-xs text-muted-foreground mb-2 block">
            Файл субтитров (.srt или .vtt) — опционально
          </label>
          {!subtitleFile ? (
            <label className="block border-2 border-dashed border-[#263147] rounded-xl p-6 text-center cursor-pointer hover:border-[#7c5bf5]/50 transition-colors">
              <input
                type="file"
                accept=".srt,.vtt,text/vtt,application/x-subrip"
                hidden
                onChange={pickSubtitleFile}
              />
              <Film className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <span className="text-sm text-foreground">Загрузите .srt или .vtt</span>
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

          <div className="mt-3 flex items-center gap-2">
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
        </motion.div>
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
    </div>
  );
}
