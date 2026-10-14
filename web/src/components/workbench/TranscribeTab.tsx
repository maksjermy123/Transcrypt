"use client";

import { motion } from "framer-motion";
import {
  Upload,
  FileAudio,
  Loader2,
  Download,
  Play,
  Trash2,
  Mic,
  Settings2,
  Link2,
  Globe,
  Zap,
  ServerOff,
  Server,
  AlertTriangle,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useOnboarding, MODEL_INFO, browserSafeModel, type WhisperModelId } from "@/lib/onboarding-store";
import { transcribeAudio, loadWhisperPipeline } from "@/lib/whisper";
import {
  transcribeViaEngine,
  downloadEngineFile,
  type EngineProgress,
} from "@/lib/engine-bridge";
import {
  segmentsToSRT,
  segmentsToVTT,
  segmentsToPlainText,
  downloadFile,
  formatDuration,
} from "@/lib/subtitles";

type Phase = "idle" | "loading-engine" | "running" | "done" | "error";
type Seg = { text: string; timestamp: [number, number | null] };

export function TranscribeTab({
  onInstallEngine,
}: {
  /** Переход к шагу установки движка (из воркбенча) */
  onInstallEngine?: () => void;
}) {
  const { selectedModel, setSelectedModel, engineServerOnline } = useOnboarding();
  const [mode, setMode] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | Blob | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<Seg[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [language, setLanguage] = useState("auto");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const handleFile = useCallback(
    (f: File) => {
      setFile(f);
      setFileName(f.name);
      setFileSize(f.size);
      setText("");
      setSegments([]);
      setError(null);
      setProgress(0);
      setPhase("idle");
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(f));
    },
    [audioUrl]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f && (f.type.startsWith("audio/") || f.type.startsWith("video/"))) {
        handleFile(f);
      }
    },
    [handleFile]
  );

  function isUrl(s: string) {
    try {
      const u = new URL(s.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function detectSource(url: string): { label: string; icon: string } {
    const u = url.toLowerCase();
    if (u.includes("youtube.com") || u.includes("youtu.be")) return { label: "YouTube", icon: "🎬" };
    if (u.includes("tiktok.com")) return { label: "TikTok", icon: "🎵" };
    if (u.includes("instagram.com")) return { label: "Instagram", icon: "📸" };
    return { label: "URL", icon: "🔗" };
  }

  /**
   * Запуск транскрипции.
   *
   * Логика:
   *  - URL + движок online → /api/transcribe (Subtitles-First стратегия на сервере)
   *  - URL + движок offline → ошибка (нельзя YouTube через браузер из-за CORS)
   *  - Локальный файл + движок online → /api/transcribe (использует нативный Whisper, быстрее)
   *  - Локальный файл + движок offline → Whisper в браузере (transformers.js)
   */
  async function run() {
    setError(null);
    setProgress(0);
    setProgressLog([]);
    setText("");
    setSegments([]);

    const urlValue = url.trim();
    const useUrl = mode === "url" && urlValue && isUrl(urlValue);

    if (mode === "url" && !urlValue) {
      setError("Введите URL видео");
      return;
    }
    if (mode === "url" && !isUrl(urlValue)) {
      setError("Некорректный URL (нужно http:// или https://)");
      return;
    }
    if (mode === "file" && !file) {
      setError("Загрузите файл");
      return;
    }

    // URL-задача требует локальный движок
    if (useUrl && !engineServerOnline) {
      setError(
        "URL-задачи (YouTube, TikTok) требуют локальный движок — yt-dlp с impersonate Chrome. Запустите engine_server.py на компьютере и обновите страницу."
      );
      return;
    }

    setPhase(useUrl ? "running" : "loading-engine");
    setProgressText(useUrl ? "Запрос к локальному движку…" : "Подгружаем Whisper из кеша…");

    try {
      if (engineServerOnline) {
        // ===== Локальный движок: Subtitles-First стратегия для URL, нативный Whisper для файлов =====
        setPhase("running");
        setProgress(5);
        setProgressText("Локальный движок: запускаем задачу…");

        let filePath: string | undefined;
        if (mode === "file" && file) {
          // Загружаем файл на движок
          setProgressText("Загружаем файл на движок…");
          setProgress(15);
          const { uploadFileToEngine } = await import("@/lib/engine-bridge");
          filePath = await uploadFileToEngine(file as File, fileName);
          setProgress(25);
        }

        const result = await transcribeViaEngine(
          {
            url: useUrl ? urlValue : undefined,
            file_path: filePath,
            model: selectedModel ?? "base",
            language,
            translate_to: "-", // Перевод не нужен
          },
          (p: EngineProgress) => {
            setProgress(p.percent);
            setProgressText(p.stage || "");
            if (p.log?.length) {
              setProgressLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
            }
          }
        );

        if (result.status !== "success") {
          throw new Error("Движок вернул ошибку");
        }

        setText(result.text || "");
        setSourceLabel(result.source || "Локальный движок");

        // Сегментов нет в ответе движка (он отдаёт только text + файлы), но можно скачать SRT.
        // Загружаем SRT-файл и парсим для отображения.
        if (result.files?.srt) {
          try {
            const { fetchEngineFile } = await import("@/lib/engine-bridge");
            const blob = await fetchEngineFile(result.files.srt);
            const srtText = await blob.text();
            const parsed = parseSrt(srtText);
            setSegments(parsed);
          } catch (e) {
            console.warn("Не удалось загрузить SRT:", e);
          }
        }

        setPhase("done");
        setProgress(100);
        setProgressText("Готово");
        return;
      }

      // ===== Браузерный режим: только локальные файлы =====
      if (!file) {
        setError("В браузерном режиме можно распознавать только локальные файлы");
        return;
      }
      setPhase("loading-engine");
      setProgress(5);
      setProgressText("Подгружаем Whisper из кеша…");

      await loadWhisperPipeline(browserSafeModel(selectedModel));
      setPhase("running");
      setProgress(10);
      setProgressText("Распознавание речи…");
      const result = await transcribeAudio(file, language, (p) => {
        setProgress(10 + Math.round(p * 0.9));
        if (p > 0) setProgressText(`Распознавание речи… ${p}%`);
      });
      setText(result.text || "");
      const segs: Seg[] = (result.chunks || []).map((c: any) => ({
        text: c.text || "",
        timestamp: [
          Array.isArray(c.timestamp) ? c.timestamp[0] : 0,
          Array.isArray(c.timestamp) ? (c.timestamp[1] ?? null) : null,
        ],
      }));
      setSegments(segs);
      setSourceLabel(`Whisper ${browserSafeModel(selectedModel)} (браузер)`);
      setPhase("done");
      setProgress(100);
      setProgressText("Готово");
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? "Ошибка распознавания");
      setPhase("error");
    }
  }

  function downloadSRT() {
    downloadFile("transcrypt.srt", segmentsToSRT(segments), "text/plain");
  }
  function downloadVTT() {
    downloadFile("transcrypt.vtt", segmentsToVTT(segments), "text/plain");
  }
  function downloadTXT() {
    downloadFile("transcrypt.txt", text || segmentsToPlainText(segments), "text/plain");
  }

  async function downloadResultFile(kind: "txt" | "srt" | "vtt" | "json") {
    if (engineServerOnline && phase === "done") {
      // Если был движок — файлы лежат на нём, скачиваем оттуда
      // (но мы не сохраняем URL ответа. Поэтому для простоты используем локальную генерацию из сегментов.)
      if (kind === "txt") downloadTXT();
      else if (kind === "srt") downloadSRT();
      else if (kind === "vtt") downloadVTT();
    } else {
      if (kind === "txt") downloadTXT();
      else if (kind === "srt") downloadSRT();
      else if (kind === "vtt") downloadVTT();
    }
  }

  const totalDuration = segments.length
    ? Math.max(...segments.map((s) => s.timestamp[1] ?? s.timestamp[0]))
    : 0;

  function reset() {
    setFile(null);
    setFileName("");
    setFileSize(0);
    setUrl("");
    setSegments([]);
    setText("");
    setSourceLabel("");
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setPhase("idle");
    setProgress(0);
    setProgressLog([]);
    setError(null);
  }

  // ═════════ Общие блоки для обоих режимов (файл / URL) ═════════
  const busy = phase === "loading-engine" || phase === "running";
  const urlValue = url.trim();
  const urlValid = !!urlValue && isUrl(urlValue);
  const canRun = mode === "url"
    ? engineServerOnline && urlValid && !busy
    : !!file && !busy;

  const langSelect = (
    <div className="flex items-center gap-3">
      <Mic className="w-5 h-5 text-[#7c5bf5]" />
      <div>
        <div className="font-medium text-sm">Исходный язык</div>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-1.5 text-sm mt-1"
        >
          <option value="auto">Автоопределение</option>
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
          <option value="ar">العربية</option>
          <option value="zh">中文</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
        </select>
      </div>
    </div>
  );

  const runButton = (
    <button
      onClick={run}
      disabled={!canRun}
      title={
        mode === "url" && !urlValid
          ? "Вставьте корректную ссылку на видео"
          : undefined
      }
      className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 justify-center glow-primary"
    >
      {busy ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Обработка…
        </>
      ) : (
        <>
          <Play className="w-4 h-4" />
          Распознать речь
        </>
      )}
    </button>
  );

  const progressBlock = busy ? (
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
  ) : null;

  const errorBlock = error ? (
    <div className="glass-card rounded-2xl p-4 border-red-500/40">
      <div className="text-sm text-red-400">Ошибка: {error}</div>
    </div>
  ) : null;

  const resultBlock = phase === "done" ? (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {sourceLabel && (
        <div className="glass-card rounded-2xl p-3 px-4 text-xs text-muted-foreground">
          Источник: <span className="text-foreground font-medium">{sourceLabel}</span>
        </div>
      )}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between">
        <div className="text-sm">
          Найдено сегментов: <span className="font-mono font-bold text-[#7c5bf5]">{segments.length || "—"}</span>
          {totalDuration > 0 && (
            <span className="text-muted-foreground ml-3">
              длительность ≈ {formatDuration(totalDuration)}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <ExportBtn onClick={() => downloadResultFile("srt")} label="SRT" />
          <ExportBtn onClick={() => downloadResultFile("vtt")} label="VTT" />
          <ExportBtn onClick={() => downloadResultFile("txt")} label="TXT" />
        </div>
      </div>

      {text && (
        <div className="glass-card rounded-2xl p-5">
          <h3 className="font-semibold mb-3 text-sm">Полный текст</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      )}

      {segments.length > 0 && (
        <div className="glass-card rounded-2xl p-5">
          <h3 className="font-semibold mb-3 text-sm">Сегменты с таймкодами</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
            {segments.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-[#1b2334] transition-colors"
              >
                <span className="font-mono text-xs text-[#7c5bf5] mt-0.5 flex-shrink-0 tabular-nums">
                  {formatDuration(s.timestamp[0])}
                </span>
                <span className="text-sm text-foreground/90">{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  ) : null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Транскрипция аудио и видео</h1>
          <p className="text-sm text-muted-foreground">
            Whisper превратит голос в текст с таймкодами. URL-задачи (YouTube и др.) — через локальный движок со стратегией «сначала субтитры».
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Модель:</span>
          <select
            value={engineServerOnline ? (selectedModel ?? "base") : browserSafeModel(selectedModel)}
            onChange={(e) => setSelectedModel(e.target.value as WhisperModelId)}
            className="bg-[#1b2334] border border-[#263147] rounded-lg px-3 py-1.5 text-sm font-medium hover:border-[#7c5bf5]/50"
          >
            {(engineServerOnline
              ? (["tiny", "base", "small", "medium", "large-v3"] as const)
              : (["tiny", "base", "small"] as const)
            ).map((id) => {
              const mi = MODEL_INFO[id];
              const size = engineServerOnline ? mi.engineSizeMB : mi.sizeMB;
              const sizeLabel = size >= 1000 ? `${(size / 1000).toFixed(1)} ГБ` : `${size} МБ`;
              return (
                <option key={id} value={id}>
                  {mi.name.replace("Whisper ", "")} — {sizeLabel}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Статус движка */}
      <div
        className={`mb-5 p-3 rounded-xl flex items-center gap-3 text-sm ${
          engineServerOnline
            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
            : "bg-amber-500/10 border border-amber-500/20 text-amber-300"
        }`}
      >
        {engineServerOnline ? (
          <>
            <Server className="w-4 h-4 flex-shrink-0" />
            <span>
              <strong>Локальный движок online.</strong> URL-задачи доступны со стратегией «сначала субтитры» — сначала ищем субтитры на выбранном языке (или ru/en/uk как fallback), и только если их нет — скачиваем аудио и распознаём через Whisper. Это быстрее и обходит блокировки YouTube.
            </span>
          </>
        ) : (
          <>
            <ServerOff className="w-4 h-4 flex-shrink-0" />
            <span>
              <strong>Локальный движок не найден.</strong> Доступна только транскрипция локальных файлов через браузерный Whisper. Для URL (YouTube, TikTok) запустите <code className="px-1.5 py-0.5 rounded bg-amber-500/20 font-mono text-xs">python engine_server.py</code> из репозитория и обновите страницу.
            </span>
          </>
        )}
      </div>

      {!file && (
        <div className="flex gap-2 mb-5 bg-[#1b2334] p-1 rounded-xl w-fit">
          <ModeBtn active={mode === "file"} onClick={() => setMode("file")} icon={Upload} label="Файл с компьютера" />
          <ModeBtn
            active={mode === "url"}
            onClick={() => setMode("url")}
            icon={Link2}
            label={engineServerOnline ? "URL (YouTube и др.)" : "URL (нужен движок)"}
          />
        </div>
      )}

      {/* URL Input */}
      {!file && mode === "url" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 mb-5"
        >
          <label className="text-xs text-muted-foreground mb-2 block">Ссылка на видео (YouTube, TikTok, Instagram, Vimeo и др.)</label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Link2 className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=… или https://youtu.be/…"
                className="w-full bg-[#0b0f19] border border-[#263147] rounded-xl pl-10 pr-3 py-3 text-sm focus:outline-none focus:border-[#7c5bf5]/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canRun) run();
                }}
              />
            </div>
          </div>

          {urlValid && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="w-3.5 h-3.5 text-[#7c5bf5]" />
              <span>Источник: <span className="text-foreground font-medium">{detectSource(urlValue).icon} {detectSource(urlValue).label}</span></span>
              <span>·</span>
              <span>Стратегия: сначала субтитры → fallback на Whisper</span>
            </div>
          )}

          {engineServerOnline ? (
            <div className="mt-4 pt-4 border-t border-[#263147]/60 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
              {langSelect}
              {runButton}
            </div>
          ) : (
            <div className="mt-4 rounded-xl p-4 border-amber-500/30 bg-amber-500/5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-amber-200 font-medium mb-1">Для ссылок нужен локальный движок</p>
                  <p className="text-xs text-amber-200/80 leading-relaxed mb-3">
                    Распознавание по ссылке работает через движок на вашем компьютере
                    (yt-dlp + Whisper): браузер технически не может скачать видео с YouTube напрямую —
                    это блокируют CORS и защита от ботов. Установка — одна команда, без архивов.
                  </p>
                  {onInstallEngine && (
                    <button
                      onClick={onInstallEngine}
                      className="bg-gradient-primary text-white px-4 py-2 rounded-lg text-xs font-medium hover:opacity-90 inline-flex items-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      Установить движок за 1 команду
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {progressBlock}
          {errorBlock}
          {resultBlock}
        </motion.div>
      )}

      {/* File drop zone */}
      {!file && mode === "file" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`glass-card rounded-2xl p-12 text-center cursor-pointer transition-all ${
            dragOver ? "border-[#7c5bf5] glow-primary scale-[1.01]" : ""
          }`}
          onClick={() => inputRef.current?.click()}
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
          <motion.div
            initial={{ scale: 1 }}
            animate={dragOver ? { scale: 1.05 } : { scale: 1 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-4"
          >
            <Upload className="w-8 h-8 text-[#7c5bf5]" />
          </motion.div>
          <h3 className="font-semibold mb-1">Перетащите аудио или видео сюда</h3>
          <p className="text-sm text-muted-foreground mb-3">
            MP3, WAV, M4A, MP4, WebM, MOV — до 500 МБ (через движок) или 200 МБ (браузер)
          </p>
          <button className="text-[#7c5bf5] text-sm font-medium hover:underline">
            или нажмите, чтобы выбрать файл
          </button>
        </div>
      )}

      {/* Файл загружен */}
      {file && (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
              <FileAudio className="w-6 h-6 text-[#7c5bf5]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{fileName}</div>
              <div className="text-xs text-muted-foreground">
                {(fileSize / 1024 / 1024).toFixed(2)} МБ
              </div>
            </div>
            {file.type.startsWith("audio/") && audioUrl && (
              <audio controls src={audioUrl} className="max-w-xs h-10 hidden md:block" />
            )}
            <button
              onClick={reset}
              className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              title="Убрать файл"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Предупреждение для длинных файлов в браузерном режиме */}
          {!engineServerOnline && (fileSize / 1024 / 1024) > 50 && (
            <div className="glass-card rounded-2xl p-4 border-amber-500/30 bg-amber-500/5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-1">Большой файл для браузерного режима</p>
                  <p className="text-xs text-amber-200/80 leading-relaxed">
                    Браузерный Whisper (WASM) работает медленно для файлов длиннее 10-15 минут и
                    может зависать на очень длинных аудио (более 30 минут). Для длинных файлов
                    рекомендуется установить локальный движок — он работает в 5-10 раз быстрее
                    и не блокирует браузер. Нажмите на индикатор «Только браузер» в шапке
                    справа для перехода к установке.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="glass-card rounded-2xl p-5 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
            {langSelect}
            {runButton}
          </div>

          {progressBlock}
          {errorBlock}
          {resultBlock}
        </div>
      )}
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
  disabledHint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2 ${
        active
          ? "bg-gradient-primary text-white"
          : disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function ExportBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
    >
      <Download className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

/**
 * Простой SRT-парсер: переводит .srt в массив сегментов с таймкодами.
 */
function parseSrt(content: string): Seg[] {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const segs: Seg[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (lines.length < 2) continue;
    // Первая строка — номер, вторая — таймкод
    const tsLine = lines.find((l) => l.includes("-->"));
    if (!tsLine) continue;
    const [startStr, endStr] = tsLine.split("-->").map((s) => s.trim());
    const text = lines.slice(lines.indexOf(tsLine) + 1).join(" ").trim();
    if (!text) continue;
    segs.push({
      text,
      timestamp: [parseSrtTime(startStr), parseSrtTime(endStr)],
    });
  }
  return segs;
}

function parseSrtTime(t: string): number {
  // 00:01:23,456 → 83.456
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return (
    parseInt(m[1]) * 3600 +
    parseInt(m[2]) * 60 +
    parseInt(m[3]) +
    parseInt(m[4]) / 1000
  );
}

// Чтобы избежать TS-ругани на неиспользуемый импорт
void downloadEngineFile;
void Globe;
