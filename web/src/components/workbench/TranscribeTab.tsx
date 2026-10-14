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
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useOnboarding, MODEL_INFO } from "@/lib/onboarding-store";
import { transcribeAudio, loadWhisperPipeline } from "@/lib/whisper";
import {
  segmentsToSRT,
  segmentsToVTT,
  segmentsToPlainText,
  downloadFile,
  formatDuration,
} from "@/lib/subtitles";

type Phase = "idle" | "loading-engine" | "transcribing" | "done" | "error";
type Seg = { text: string; timestamp: [number, number | null] };

export function TranscribeTab() {
  const { selectedModel, setSelectedModel } = useOnboarding();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<Seg[]>([]);
  const [language, setLanguage] = useState("auto");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setText("");
    setSegments([]);
    setError(null);
    setProgress(0);
    setPhase("idle");
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(f));
  }, [audioUrl]);

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

  async function run() {
    if (!file) return;
    setPhase("loading-engine");
    setProgress(5);
    setProgressText("Подгружаем движок из кеша…");
    setError(null);

    try {
      // Проверяем что движок готов
      await loadWhisperPipeline(selectedModel ?? "base");
      setPhase("transcribing");
      setProgress(10);
      setProgressText("Распознавание речи…");
      const result = await transcribeAudio(file, language, (p) => {
        setProgress(10 + Math.round(p * 0.9));
        if (p > 0) setProgressText(`Распознавание речи… ${p}%`);
      });
      setText(result.text || "");
      // Нормализуем chunks → segments
      const segs: Seg[] = (result.chunks || []).map((c: any) => ({
        text: c.text || "",
        timestamp: [
          Array.isArray(c.timestamp) ? c.timestamp[0] : 0,
          Array.isArray(c.timestamp) ? (c.timestamp[1] ?? null) : null,
        ],
      }));
      setSegments(segs);
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

  const totalDuration = segments.length
    ? Math.max(...segments.map((s) => s.timestamp[1] ?? s.timestamp[0]))
    : 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Заголовок и модель */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Транскрипция аудио и видео</h1>
          <p className="text-sm text-muted-foreground">
            Whisper превратит голос в текст с таймкодами. Все вычисления идут на
            вашем компьютере.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Модель:</span>
          <select
            value={selectedModel ?? "base"}
            onChange={(e) => setSelectedModel(e.target.value as "tiny" | "base")}
            className="bg-[#1b2334] border border-[#263147] rounded-lg px-3 py-1.5 text-sm font-medium hover:border-[#7c5bf5]/50"
          >
            <option value="tiny">Tiny — {MODEL_INFO.tiny.sizeMB} МБ (быстрее)</option>
            <option value="base">Base — {MODEL_INFO.base.sizeMB} МБ (точнее)</option>
          </select>
        </div>
      </div>

      {/* Drop zone */}
      {!file && (
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
            MP3, WAV, M4A, MP4, WebM, MOV — до 200 МБ
          </p>
          <button className="text-[#7c5bf5] text-sm font-medium hover:underline">
            или нажмите, чтобы выбрать файл
          </button>
        </div>
      )}

      {/* Аудио превью и запуск */}
      {file && (
        <div className="space-y-5">
          <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
              <FileAudio className="w-6 h-6 text-[#7c5bf5]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} МБ
              </div>
            </div>
            {file.type.startsWith("audio/") && audioUrl && (
              <audio controls src={audioUrl} className="max-w-xs h-10 hidden md:block" />
            )}
            <button
              onClick={() => {
                setFile(null);
                setSegments([]);
                setText("");
                if (audioUrl) URL.revokeObjectURL(audioUrl);
                setAudioUrl(null);
                setPhase("idle");
                setProgress(0);
              }}
              className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              title="Убрать файл"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Настройки запуска */}
          <div className="glass-card rounded-2xl p-5 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
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

            <button
              onClick={run}
              disabled={phase === "loading-engine" || phase === "transcribing"}
              className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 justify-center glow-primary"
            >
              {phase === "loading-engine" || phase === "transcribing" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Распознавание…
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Распознать речь
                </>
              )}
            </button>
          </div>

          {/* Прогресс */}
          {(phase === "loading-engine" || phase === "transcribing") && (
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
            </div>
          )}

          {error && (
            <div className="glass-card rounded-2xl p-4 border-red-500/40">
              <div className="text-sm text-red-400">Ошибка: {error}</div>
            </div>
          )}

          {/* Результат */}
          {phase === "done" && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {/* Кнопки экспорта */}
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
                  <ExportBtn onClick={downloadSRT} label="SRT" />
                  <ExportBtn onClick={downloadVTT} label="VTT" />
                  <ExportBtn onClick={downloadTXT} label="TXT" />
                </div>
              </div>

              {/* Текст целиком */}
              {text && (
                <div className="glass-card rounded-2xl p-5">
                  <h3 className="font-semibold mb-3 text-sm">Полный текст</h3>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
                </div>
              )}

              {/* Сегменты с таймкодами */}
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
          )}
        </div>
      )}
    </div>
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
