"use client";

import { motion } from "framer-motion";
import { Wrench, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { loadWhisperPipeline, type ProgressInfo } from "@/lib/whisper";
import { LocalEngineStep } from "./LocalEngineStep";

type Phase = "idle" | "downloading-wasm" | "downloading-model-base" | "ready" | "error";

export function EngineStep({ onNext }: { onNext: () => void }) {
  const { engineStatus, setEngineStatus, setEngineProgress, setEngineError, engineServerOnline } =
    useOnboarding();
  const [phase, setPhase] = useState<Phase>(
    engineStatus === "ready" ? "ready" : "idle"
  );
  const [progress, setProgress] = useState(engineStatus === "ready" ? 100 : 0);
  const [phaseText, setPhaseText] = useState(
    engineStatus === "ready"
      ? "Браузерный движок уже установлен"
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
      setPhaseText("Браузерный движок готов");
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

  const browserReady = phase === "ready" || engineStatus === "ready";
  const localReady = engineServerOnline;

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
          Transcrypt использует <span className="text-foreground font-medium">два движка</span>:
          браузерный (Whisper в WASM, для локальных файлов) и локальный Python-движок
          (для URL-задач с YouTube/TikTok, обходит блокировки).
        </p>
      </div>

      {/* Браузерный движок */}
      <div className="glass-card rounded-2xl p-6 mb-5">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            phase === "ready"
              ? "bg-emerald-500/15"
              : phase === "error"
              ? "bg-red-500/15"
              : "bg-[#7c5bf5]/15"
          }`}>
            {phase === "ready" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            ) : phase === "error" ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : phase === "idle" ? (
              <Wrench className="w-5 h-5 text-[#7c5bf5]" />
            ) : (
              <Loader2 className="w-5 h-5 text-[#7c5bf5] animate-spin" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm">Браузерный движок (Whisper)</h3>
            <div className="text-xs text-muted-foreground">{phaseText}</div>
          </div>
          <div className="text-2xl font-mono font-bold text-[#7c5bf5]">
            {progress}%
          </div>
        </div>

        <div className="w-full h-2 rounded-full bg-[#1b2334] overflow-hidden mb-4">
          <motion.div
            className="h-full bg-gradient-primary"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        </div>

        {phase === "idle" && (
          <button
            onClick={startInstall}
            className="bg-gradient-primary text-white px-6 py-2.5 rounded-xl font-medium hover:opacity-90 transition-opacity glow-primary inline-flex items-center gap-2"
          >
            <Wrench className="w-4 h-4" />
            Установить браузерный движок
          </button>
        )}
        {phase === "ready" && (
          <div className="text-sm text-emerald-400 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Готово — Whisper работает в браузере для локальных файлов
            <button
              onClick={() => {
                setPhase("idle");
                setProgress(0);
              }}
              className="text-xs text-muted-foreground hover:text-foreground ml-3"
            >
              Переустановить
            </button>
          </div>
        )}
        {phase === "error" && (
          <button
            onClick={startInstall}
            className="bg-gradient-primary text-white px-6 py-2.5 rounded-xl font-medium hover:opacity-90"
          >
            Повторить установку
          </button>
        )}
      </div>

      {/* Локальный движок — показывается после установки браузерного */}
      {browserReady && (
        <LocalEngineStep onSkip={onNext} />
      )}

      {/* Если локальный уже online — даём продолжить сразу */}
      {(browserReady && localReady && phase !== "idle") && (
        <div className="mt-5 text-center">
          <button
            onClick={onNext}
            className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity glow-primary inline-flex items-center gap-2"
          >
            Продолжить →
          </button>
        </div>
      )}
    </motion.div>
  );
}
