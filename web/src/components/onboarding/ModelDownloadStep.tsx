"use client";

import { motion } from "framer-motion";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { loadWhisperPipeline, type ProgressInfo } from "@/lib/whisper";

type Phase = "loading" | "ready" | "error";

export function ModelDownloadStep({ onNext }: { onNext: () => void }) {
  const {
    selectedModel,
    setModelStatus,
    setModelProgress,
    setModelProgressText,
    setModelError,
    modelProgress,
    modelProgressText,
  } = useOnboarding();
  const [phase, setPhase] = useState<Phase>("loading");
  const [currentFile, setCurrentFile] = useState<string>("");
  const [filesDone, setFilesDone] = useState<number>(0);
  const [filesTotal, setFilesTotal] = useState<number>(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !selectedModel) return;
    started.current = true;
    (async () => {
      try {
        setPhase("loading");
        setModelStatus("downloading");
        setModelProgress(0);
        setModelProgressText("Подготовка…");

        await loadWhisperPipeline(selectedModel, (info: ProgressInfo) => {
          if (info.status === "initiate" || info.status === "download") {
            setFilesTotal((n) => Math.max(n, 1));
            setModelProgressText("Загрузка файлов модели…");
          }
          if (info.status === "progress" && info.progress != null) {
            const pct = Math.round(info.progress * 100);
            setModelProgress(pct);
            if (info.file || info.name) {
              const fname = (info.file || info.name || "").split("/").pop() || "";
              setCurrentFile(fname);
              setModelProgressText(`Загружаем ${fname} — ${pct}%`);
            } else {
              setModelProgressText(`Загрузка модели… ${pct}%`);
            }
          }
          if (info.status === "done") {
            setFilesDone((n) => n + 1);
            setModelProgressText(`Файл готов. Загружаем следующий…`);
          }
          if (info.status === "ready") {
            setModelProgress(100);
            setModelProgressText("Модель загружена и готова к работе");
            setPhase("ready");
            setModelStatus("downloaded");
            setModelError(null);
          }
        });

        // Если колбэк ready не сработал — помечаем готово
        setModelProgress(100);
        setPhase("ready");
        setModelStatus("downloaded");
      } catch (err: any) {
        console.error(err);
        setPhase("error");
        setModelStatus("error");
        setModelError(err?.message ?? "Ошибка загрузки модели");
      }
    })();
  }, [selectedModel]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-2xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold mb-3">Загрузка модели Whisper</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Модель скачивается один раз и кешируется в IndexedDB. При следующем
          открытии страницы она загрузится мгновенно — без повторной загрузки из
          интернета.
        </p>
      </div>

      <div className="glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          {phase === "ready" ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          ) : phase === "error" ? (
            <AlertCircle className="w-6 h-6 text-red-500" />
          ) : (
            <Loader2 className="w-6 h-6 text-[#7c5bf5] animate-spin" />
          )}
          <div className="flex-1">
            <div className="font-medium text-sm">
              {phase === "ready"
                ? "Готово! Модель в кеше браузера."
                : phase === "error"
                ? "Ошибка загрузки"
                : modelProgressText || "Инициализация…"}
            </div>
            {currentFile && phase === "loading" && (
              <div className="text-xs text-muted-foreground truncate">
                Текущий файл: {currentFile}
              </div>
            )}
            {filesTotal > 0 && (
              <div className="text-xs text-muted-foreground">
                Загружено файлов: {filesDone} из {filesTotal}
              </div>
            )}
          </div>
          <div className="text-2xl font-mono font-bold text-[#7c5bf5]">
            {modelProgress}%
          </div>
        </div>

        <div className="w-full h-2 rounded-full bg-[#1b2334] overflow-hidden">
          <motion.div
            className="h-full bg-gradient-primary"
            initial={{ width: 0 }}
            animate={{ width: `${modelProgress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {phase === "ready" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <button
            onClick={onNext}
            className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity glow-primary"
          >
            Открыть рабочую страницу →
          </button>
        </motion.div>
      )}

      {phase === "error" && (
        <div className="text-center">
          <p className="text-sm text-red-400 mb-3">
            Не удалось загрузить модель. Проверьте интернет-соединение и попробуйте снова.
          </p>
          <button
            onClick={() => {
              started.current = false;
              setPhase("loading");
            }}
            className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90"
          >
            Повторить загрузку
          </button>
        </div>
      )}
    </motion.div>
  );
}
