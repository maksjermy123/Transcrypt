"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, FileArchive, Languages, Settings2, Home } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { TranscribeTab } from "./TranscribeTab";
import { ConvertTab } from "./ConvertTab";
import { TranslateTab } from "./TranslateTab";

type WorkTab = "transcribe" | "convert" | "translate";

const TABS: { id: WorkTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: "transcribe", label: "Транскрипция", icon: Mic, hint: "Whisper превратит голос в текст с таймкодами" },
  { id: "convert", label: "Конвертер", icon: FileArchive, hint: "Изображения и текстовые форматы" },
  { id: "translate", label: "Перевод", icon: Languages, hint: "Перевод текста на 14 языков" },
];

export function Workbench({ onExit }: { onExit: () => void }) {
  const { selectedModel, reset } = useOnboarding();
  const [tab, setTab] = useState<WorkTab>("transcribe");

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

          <button
            onClick={onExit}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[#1b2334]"
            title="В начало / пройти онбординг заново"
          >
            <Home className="w-5 h-5" />
          </button>
        </div>
      </header>

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
            {tab === "convert" && <ConvertTab />}
            {tab === "translate" && <TranslateTab />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Футер */}
      <footer className="border-t border-[#263147]/60 py-4 px-6 text-center text-xs text-muted-foreground">
        Transcrypt · работает локально на вашем компьютере · Whisper {selectedModel}
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
