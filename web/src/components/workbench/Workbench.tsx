"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, FileAudio, FileArchive, Home, Server, ServerOff, Zap, X } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { checkEngineHealth } from "@/lib/engine-bridge";
import { TranscribeTab } from "./TranscribeTab";
import { MediaTab } from "./MediaTab";
import { ConvertTab } from "./ConvertTab";

type WorkTab = "transcribe" | "media" | "convert";

const TABS: { id: WorkTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: "transcribe", label: "Транскрипция", icon: Mic, hint: "Whisper превратит голос в текст с таймкодами" },
  { id: "media", label: "Медиа", icon: FileAudio, hint: "Скачать видео/аудио, очистить аудио, вшить субтитры" },
  { id: "convert", label: "Конвертер", icon: FileArchive, hint: "Медиа через ffmpeg, изображения, текст" },
];

export function Workbench({ onExit }: { onExit: () => void }) {
  const { selectedModel, reset, engineServerOnline, setEngineServerOnline, setEngineServerHealth, setStep } = useOnboarding();
  const [tab, setTab] = useState<WorkTab>("transcribe");
  const [checking, setChecking] = useState(true);
  const [showBanner, setShowBanner] = useState(true);

  // Авто-пинг локального движка при загрузке
  useEffect(() => {
    let cancelled = false;
    async function check() {
      setChecking(true);
      const health = await checkEngineHealth();
      if (cancelled) return;
      const online = !!health && health.status === "ok";
      setEngineServerOnline(online);
      setEngineServerHealth(online ? health : null);
      setChecking(false);
      // Если движок появился — скрываем баннер
      if (online) setShowBanner(false);
    }
    void check();
    // Пингуем каждые 30 сек — чтобы поймать момент, когда пользователь запустит движок
    const interval = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setEngineServerOnline, setEngineServerHealth]);

  // Перейти к шагу установки локального движка (engine step в онбординге)
  function goToEngineInstall() {
    // Выходим в онбординг и прыгаем на шаг engine
    setStep("engine");
    onExit();
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Шапка */}
      <header className="sticky top-0 z-50 bg-[#0b0f19]/85 backdrop-blur-xl border-b border-[#263147]/60">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">Transcrypt</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                · Whisper {selectedModel}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex items-center gap-1 bg-[#1b2334] rounded-xl p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2 ${
                    tab === t.id
                      ? "bg-gradient-primary text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {/* Индикатор движка — КЛИКАБЕЛЬНЫЙ */}
            <button
              onClick={engineServerOnline ? undefined : goToEngineInstall}
              disabled={engineServerOnline}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                engineServerOnline
                  ? "bg-emerald-500/15 text-emerald-400 cursor-default"
                  : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 cursor-pointer"
              } ${checking ? "opacity-60" : ""}`}
              title={
                engineServerOnline
                  ? "Локальный Python-движок запущен — все функции доступны, включая URL-задачи с YouTube"
                  : "Локальный движок не найден. Нажмите чтобы установить."
              }
            >
              {engineServerOnline ? (
                <>
                  <Server className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Движок online</span>
                  <Server className="w-3.5 h-3.5 md:hidden" />
                </>
              ) : (
                <>
                  <ServerOff className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Только браузер — нажмите чтобы установить движок</span>
                  <span className="md:hidden">Только браузер</span>
                </>
              )}
            </button>

            <button
              onClick={onExit}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[#1b2334]"
              title="В начало / пройти онбординг заново"
            >
              <Home className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Баннер с предложением установить движок, если он не запущен */}
      {!engineServerOnline && !checking && showBanner && (
        <div className="bg-gradient-to-r from-amber-500/15 to-amber-500/5 border-b border-amber-500/30">
          <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center gap-3 text-sm">
            <Zap className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-amber-200 font-medium">Хотите URL-задачи с YouTube/TikTok и быструю транскрипцию длинных файлов?</span>{" "}
              <span className="text-amber-300/80">Установите локальный движок — он работает в 5-10 раз быстрее и не зависает на длинных аудио.</span>
            </div>
            <button
              onClick={goToEngineInstall}
              className="bg-gradient-primary text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:opacity-90 whitespace-nowrap inline-flex items-center gap-1.5"
            >
              <Zap className="w-3 h-3" />
              Установить движок
            </button>
            <button
              onClick={() => setShowBanner(false)}
              className="p-1 rounded-md text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10"
              title="Скрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Контент */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {tab === "transcribe" && <TranscribeTab />}
            {tab === "media" && <MediaTab />}
            {tab === "convert" && <ConvertTab />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Футер */}
      <footer className="border-t border-[#263147]/60 py-4 px-6 text-center text-xs text-muted-foreground">
        Transcrypt · работает локально на вашем компьютере · Whisper {selectedModel}
        {engineServerOnline ? " · 🟢 Локальный движок online" : " · 🟡 Только браузерный режим"}
        {" · "}
        <button
          onClick={reset}
          className="text-[#7c5bf5] hover:underline"
        >
          Сбросить настройки
        </button>
      </footer>
    </div>
  );
}
