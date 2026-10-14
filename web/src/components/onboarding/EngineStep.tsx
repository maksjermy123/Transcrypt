"use client";

import { motion } from "framer-motion";
import { Wrench, Loader2, CheckCircle2, AlertCircle, Globe, Server, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { loadWhisperPipeline, type ProgressInfo } from "@/lib/whisper";
import { LocalEngineStep } from "./LocalEngineStep";

type Phase = "idle" | "downloading-wasm" | "downloading-model-base" | "ready" | "error";

export function EngineStep({ onNext }: { onNext: () => void }) {
  const { engineStatus, setEngineStatus, setEngineProgress, setEngineError, engineServerOnline, mode } =
    useOnboarding();
  const isEngine = mode === "engine";

  const [phase, setPhase] = useState<Phase>(
    engineStatus === "ready" ? "ready" : "idle"
  );
  const [progress, setProgress] = useState(engineStatus === "ready" ? 100 : 0);
  const [phaseText, setPhaseText] = useState(
    engineStatus === "ready"
      ? "Браузерный движок уже установлен"
      : "Готов к установке"
  );
  // Авто-переход после подключения локального движка
  const [showConnected, setShowConnected] = useState(false);
  const announcedRef = useRef(false);
  // Флаг: установка браузерного движка запускалась на ЭТОМ монтировании шага
  // (нужен, чтобы при заходе с уже кешированным движком не выкидывать пользователя
  // авто-переходом, а показать кнопку «Продолжить»)
  const installedHere = useRef(false);

  async function startInstall() {
    installedHere.current = true;
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

  // ─── Авто-переход: движок подключился → через 2.5 сек сами идём дальше ───
  const connected = isEngine && engineServerOnline;
  useEffect(() => {
    if (!connected || announcedRef.current) return;
    announcedRef.current = true;
    const raf = requestAnimationFrame(() => setShowConnected(true));
    const t = setTimeout(onNext, 2500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [connected]);

  // ─── Авто-переход в браузерном режиме: движок установился прямо на этом шаге ───
  useEffect(() => {
    if (isEngine || !installedHere.current || phase !== "ready" || announcedRef.current) return;
    announcedRef.current = true;
    const t = setTimeout(onNext, 2500);
    return () => clearTimeout(t);
  }, [phase, isEngine]);

  const browserReady = phase === "ready" || engineStatus === "ready";

  // ═════════════ РЕЖИМ ЛОКАЛЬНОГО ДВИЖКА ═════════════
  if (isEngine) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        transition={{ duration: 0.45 }}
        className="max-w-2xl mx-auto px-6 py-10"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-5">
            <Wrench className="w-8 h-8 text-[#7c5bf5]" />
          </div>
          <h2 className="text-3xl font-bold mb-3">Установить движок</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Локальный движок — это сердце Transcrypt. Он будет работать на вашем
            компьютере: распознавание через нативный Whisper, скачивание с
            YouTube/TikTok, ffmpeg-операции. Никаких архивов скачивать не нужно —{" "}
            <span className="text-foreground font-medium">одна команда, и всё установится само</span>.
          </p>
        </div>

        {/* Авто-переход: движок подключён */}
        {showConnected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <span className="text-sm text-emerald-300 font-medium">
                Движок подключён! Переходим к выбору Whisper…
              </span>
            </div>
            <div className="w-full h-1 rounded-full bg-emerald-500/20 overflow-hidden mt-3">
              <motion.div
                className="h-full bg-emerald-400"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 2.4, ease: "linear" }}
              />
            </div>
          </motion.div>
        )}

        {/* ГЛАВНОЕ: локальный движок */}
        <LocalEngineStep hero onSkip={onNext} />

        {/* Опционально: браузерный движок (свёрнут, для запасного варианта) */}
        <details className="glass-card rounded-2xl p-5 mt-5">
          <summary className="cursor-pointer flex items-center gap-3 text-sm font-medium">
            <Globe className="w-4 h-4 text-[#7c5bf5]" />
            <span className="flex-1">
              Браузерный движок — {browserReady ? "установлен ✓" : "необязательно, запасной вариант"}
            </span>
            <span className="text-xs text-muted-foreground">~120 МБ в кеш браузера</span>
          </summary>
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Распознаёт локальные файлы прямо в браузере, даже если движок не
              запущен. Не обязательно — локальный движок тоже умеет работать с
              файлами и делает это быстрее.
            </p>
            {browserReady ? (
              <div className="text-sm text-emerald-400 inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Готово — Whisper работает в браузере
              </div>
            ) : phase === "error" ? (
              <div className="space-y-3">
                <div className="text-sm text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {phaseText}
                </div>
                <button
                  onClick={startInstall}
                  className="bg-gradient-primary text-white px-5 py-2 rounded-xl text-sm font-medium hover:opacity-90"
                >
                  Повторить установку
                </button>
              </div>
            ) : phase === "idle" ? (
              <button
                onClick={startInstall}
                className="bg-[#1b2334] hover:bg-[#263147] text-foreground px-5 py-2 rounded-xl text-sm font-medium transition-colors inline-flex items-center gap-2"
              >
                <Globe className="w-4 h-4" />
                Установить браузерный движок
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <Loader2 className="w-4 h-4 text-[#7c5bf5] animate-spin" />
                <div className="flex-1">
                  <div className="text-sm">{phaseText}</div>
                  <div className="w-full h-1.5 rounded-full bg-[#1b2334] overflow-hidden mt-2">
                    <motion.div
                      className="h-full bg-gradient-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                  </div>
                </div>
                <span className="text-lg font-mono font-bold text-[#7c5bf5]">{progress}%</span>
              </div>
            )}
          </div>
        </details>
      </motion.div>
    );
  }

  // ═════════════ БРАУЗЕРНЫЙ РЕЖИМ ═════════════
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
          <Globe className="w-8 h-8 text-[#7c5bf5]" />
        </div>
        <h2 className="text-3xl font-bold mb-3">Установить браузерный движок</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Браузерный движок — это{" "}
          <span className="text-foreground font-mono text-sm">transformers.js</span>{" "}
          (~5 МБ) и WASM-бинарник (~20 МБ). Скачиваются один раз и кешируются в
          браузере. Никаких exe, dmg, zip — только кеш браузера.
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
              <Globe className="w-5 h-5 text-[#7c5bf5]" />
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
            <Globe className="w-4 h-4" />
            Установить браузерный движок
          </button>
        )}
        {phase === "ready" && (
          <div className="text-sm text-emerald-400 inline-flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Готово — Whisper работает в браузере
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

      {/* Опционально: локальный движок */}
      {!engineServerOnline && <LocalEngineStep onSkip={onNext} />}

      {/* Если движок уже online — даём продолжить */}
      {engineServerOnline && (
        <div className="mt-5 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center gap-3 text-sm text-emerald-300">
          <Server className="w-5 h-5 flex-shrink-0" />
          Локальный движок тоже online — доступны все функции, включая YouTube
        </div>
      )}

      {/* Продолжить: браузерный движок готов (свежеустановлен или уже из кеша) */}
      {browserReady && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mt-8"
        >
          <button
            onClick={onNext}
            className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity glow-primary inline-flex items-center gap-2"
          >
            Продолжить — выбрать уровень Whisper
            <ArrowRight className="w-5 h-5" />
          </button>
          <p className="text-xs text-muted-foreground mt-3">
            Следующий шаг: выбор одного из 5 уровней модели Whisper.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
