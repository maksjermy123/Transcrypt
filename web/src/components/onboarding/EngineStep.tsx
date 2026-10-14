"use client";

import { motion } from "framer-motion";
import { Wrench, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { loadWhisperPipeline, type ProgressInfo } from "@/lib/whisper";

type Phase = "idle" | "downloading-wasm" | "downloading-model-base" | "ready" | "error";

export function EngineStep({ onNext }: { onNext: () => void }) {
  const { engineStatus, setEngineStatus, setEngineProgress, setEngineError } =
    useOnboarding();
  // Если движок уже готов из предыдущей сессии — стартуем с фазы ready.
  const [phase, setPhase] = useState<Phase>(
    engineStatus === "ready" ? "ready" : "idle"
  );
  const [progress, setProgress] = useState(engineStatus === "ready" ? 100 : 0);
  const [phaseText, setPhaseText] = useState(
    engineStatus === "ready"
      ? "Движок уже установлен и готов"
      : "Готов к запуску"
  );

  async function startInstall() {
    setPhase("downloading-wasm");
    setPhaseText("Загружаем WASM-рантайм transformers.js…");
    setEngineStatus("loading");
    setProgress(10);
    setEngineProgress(10);

    try {
      await loadWhisperPipeline("base", (info: ProgressInfo) => {
        if (info.status === "progress" && info.progress != null) {
          const pct = 10 + Math.round(info.progress * 70);
          setProgress(pct);
          setEngineProgress(pct);
          setPhase("downloading-model-base");
          setPhaseText(
            `Скачиваем Whisper Base… ${Math.round(info.progress * 100)}%`
          );
        } else if (info.status === "done") {
          setProgress(85);
          setEngineProgress(85);
        } else if (info.status === "ready") {
          setProgress(95);
          setEngineProgress(95);
        }
      });

      setPhase("ready");
      setPhaseText("Движок установлен и готов к работе");
      setProgress(100);
      setEngineProgress(100);
      setEngineStatus("ready");
      setEngineError(null);
    } catch (err: any) {
      console.error(err);
      setPhase("error");
      setPhaseText(err?.message ?? "Ошибка установки движка");
      setEngineStatus("error");
      setEngineError(err?.message ?? "Ошибка установки движка");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-2xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-5">
          <Wrench className="w-8 h-8 text-[#7c5bf5]" />
        </div>
        <h2 className="text-3xl font-bold mb-3">Установить движок</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Движок — это библиотека{" "}
          <span className="text-foreground font-mono text-sm">transformers.js</span>{" "}
          (~5 МБ) и WASM-бинарник (~20 МБ). Скачиваются один раз и кешируются в
          браузере. Никаких exe, dmg, zip — только кеш браузера.
        </p>
      </div>

      {/* Прогресс-бар */}
      <div className="glass-card rounded-2xl p-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          {phase === "ready" ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          ) : phase === "error" ? (
            <AlertCircle className="w-6 h-6 text-red-500" />
          ) : phase === "idle" ? (
            <Wrench className="w-6 h-6 text-[#7c5bf5]" />
          ) : (
            <Loader2 className="w-6 h-6 text-[#7c5bf5] animate-spin" />
          )}
          <div className="flex-1">
            <div className="font-medium text-sm">{phaseText}</div>
            <div className="text-xs text-muted-foreground">
              {phase === "ready"
                ? "Движок в кеше браузера. Модель можно сменить в любой момент."
                : phase === "error"
                ? "Попробуйте обновить страницу или сменить сеть."
                : "Не закрывайте вкладку до завершения установки."}
            </div>
          </div>
          <div className="text-2xl font-mono font-bold text-[#7c5bf5]">
            {progress}%
          </div>
        </div>

        <div className="w-full h-2 rounded-full bg-[#1b2334] overflow-hidden">
          <motion.div
            className="h-full bg-gradient-primary"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>
      </div>

      <div className="text-center space-y-3">
        {phase === "idle" && (
          <button
            onClick={startInstall}
            className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity glow-primary"
          >
            Установить движок
          </button>
        )}
        {phase === "ready" && (
          <>
            <button
              onClick={onNext}
              className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity glow-primary"
            >
              Движок готов — выбрать Whisper →
            </button>
            <button
              onClick={() => {
                setPhase("idle");
                setProgress(0);
              }}
              className="block mx-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Переустановить движок
            </button>
          </>
        )}
        {phase === "error" && (
          <button
            onClick={startInstall}
            className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity"
          >
            Повторить установку
          </button>
        )}
        {(phase === "downloading-wasm" || phase === "downloading-model-base") && (
          <p className="text-xs text-muted-foreground">
            Идёт установка… Не закрывайте вкладку.
          </p>
        )}
      </div>
    </motion.div>
  );
}
