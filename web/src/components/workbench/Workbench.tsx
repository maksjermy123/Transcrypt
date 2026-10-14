"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, FileAudio, FileArchive, Home, Server, ServerOff } from "lucide-react";
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
  const { selectedModel, reset, engineServerOnline, setEngineServerOnline, setEngineServerHealth } = useOnboarding();
  const [tab, setTab] = useState<WorkTab>("transcribe");
  const [checking, setChecking] = useState(true);

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
    }
    void check();
    // Пингуем каждые 30 сек — чтобы поймать момент, когда пользователь запустит движок
    const interval = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setEngineServerOnline, setEngineServerHealth]);

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
            {/* Индикатор движка */}
            <div
              className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                engineServerOnline
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-amber-500/10 text-amber-400"
              } ${checking ? "opacity-60" : ""}`}
              title={
                engineServerOnline
                  ? "Локальный Python-движок запущен — все функции доступны, включая URL-задачи с YouTube"
                  : "Локальный движок не найден — URL-задачи не доступны, но локальные файлы работают через браузерный Whisper"
              }
            >
              {engineServerOnline ? (
                <>
                  <Server className="w-3.5 h-3.5" />
                  Движок online
                </>
              ) : (
                <>
                  <ServerOff className="w-3.5 h-3.5" />
                  Только браузер
                </>
              )}
            </div>

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
      {!engineServerOnline && !checking && tab !== "convert" && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-3 text-center text-sm text-amber-300">
          <span className="font-medium">Хотите работать с YouTube/TikTok URL?</span>{" "}
          Запустите локальный движок — он обходит блокировки YouTube.{" "}
          <a
            href="https://github.com/maksjermy123/Transcrypt#-локальный-движок-опционально-для-url-задач"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-amber-200 hover:text-amber-100 font-medium"
          >
            Как запустить →
          </a>
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
