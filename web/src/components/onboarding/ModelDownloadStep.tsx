"use client";

import { motion } from "framer-motion";
import { Loader2, CheckCircle2, AlertCircle, Server, ArrowRight, Info } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useOnboarding, MODEL_INFO, browserSafeModel } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { loadWhisperPipeline, type ProgressInfo } from "@/lib/whisper";

type Phase = "loading" | "ready" | "error";

export function ModelDownloadStep({ onNext }: { onNext: () => void }) {
  const { t } = useI18n();
  const {
    selectedModel,
    setModelStatus,
    setModelProgress,
    setModelProgressText,
    setModelError,
    modelProgress,
    modelProgressText,
    mode,
    engineServerOnline,
  } = useOnboarding();

  // Режим локального движка: браузер ничего не скачивает — модель загрузит
  // движок автоматически при первой транскрибации (нативный Whisper быстрее).
  const isEngine = mode === "engine";

  const [phase, setPhase] = useState<Phase>("loading");
  const [currentFile, setCurrentFile] = useState<string>("");
  const [filesDone, setFilesDone] = useState<number>(0);
  const [filesTotal, setFilesTotal] = useState<number>(0);
  const started = useRef(false);

  useEffect(() => {
    if (isEngine || started.current || !selectedModel) return;
    started.current = true;
    (async () => {
      try {
        setPhase("loading");
        setModelStatus("downloading");
        setModelProgress(0);
        setModelProgressText("Подготовка…");

        await loadWhisperPipeline(browserSafeModel(selectedModel), (info: ProgressInfo) => {
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
  }, [selectedModel, isEngine]);

  const info = selectedModel ? MODEL_INFO[selectedModel] : null;
  const engineSizeLabel = info
    ? info.engineSizeMB >= 1000
      ? `${(info.engineSizeMB / 1000).toFixed(1)} ГБ`
      : `${info.engineSizeMB} МБ`
    : "";

  // ═══════════ РЕЖИМ ДВИЖКА: без скачивания в браузере ═══════════
  if (isEngine) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.45 }}
        className="max-w-2xl mx-auto px-6 py-10"
      >
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold mb-3">{t("Модель готова к работе")}</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Всё настроено — вручную ничего скачивать не нужно.
          </p>
        </div>

        <div className="glass-card rounded-2xl p-6 mb-6">
          <div className="flex items-start gap-4 mb-5">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <Server className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-1">
                Уровень: {info?.name ?? `Whisper ${selectedModel}`}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Локальный движок загрузит модель{" "}
                <span className="text-foreground font-medium">автоматически при первой транскрибации</span>{" "}
                (~{engineSizeLabel}). Уже со второй задачи распознавание начнётся
                мгновенно — модель останется на диске.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 text-sm text-muted-foreground bg-[#0b0f19]/40 rounded-xl p-4 border border-[#263147]">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Нативный Whisper работает напрямую на вашем CPU — в разы быстрее браузерного.</span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <span>Никаких архивов и ручных загрузок — движок сам скачает модель с официального репозитория OpenAI.</span>
            </div>
            {engineServerOnline && (
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span>Движок сейчас online — можно работать сразу после завершения настройки.</span>
              </div>
            )}
          </div>
        </div>

        <div className="text-center">
          <button
            onClick={onNext}
            className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity glow-primary inline-flex items-center gap-2"
          >
            Завершить настройку
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    );
  }

  // ═══════════ БРАУЗЕРНЫЙ РЕЖИМ: загрузка модели в кеш браузера ═══════════
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-2xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold mb-3">{t("Загрузка модели Whisper")}</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Модель скачивается один раз и кешируется в браузере. При следующем
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

        <div className="mt-4 text-xs text-muted-foreground flex items-start gap-2">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Файлы приходят напрямую с Hugging Face в кеш браузера — никаких
            архивов на диск. Используются ресурсы вашего процессора при
            распознавании.
          </span>
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
            Открыть финальный шаг →
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
