"use client";

import { motion } from "framer-motion";
import { Zap, Gauge, HardDrive, Lock, Server } from "lucide-react";
import { useOnboarding, MODEL_INFO, type WhisperModelId } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";

type ModelCard = {
  id: WhisperModelId;
  badge: string;
  badgeTone: "amber" | "violet" | "emerald";
  recommended?: boolean;
};

const ENGINE_MODELS: ModelCard[] = [
  { id: "tiny", badge: "Самая быстрая", badgeTone: "amber" },
  { id: "base", badge: "Быстрая", badgeTone: "violet" },
  { id: "small", badge: "Рекомендуется", badgeTone: "violet", recommended: true },
  { id: "medium", badge: "Высокая точность", badgeTone: "emerald" },
  { id: "large-v3", badge: "Максимум", badgeTone: "emerald" },
];

const BROWSER_MODELS: ModelCard[] = [
  { id: "tiny", badge: "Самая быстрая", badgeTone: "amber" },
  { id: "base", badge: "Рекомендуется", badgeTone: "violet", recommended: true },
  { id: "small", badge: "Максимальная точность в браузере", badgeTone: "emerald" },
];

export function ModelChoiceStep({ onNext }: { onNext: () => void }) {
  const { t } = useI18n();
  const { setSelectedModel, selectedModel, modelStatus, mode } = useOnboarding();
  const isEngine = mode === "engine";
  const cards = isEngine ? ENGINE_MODELS : BROWSER_MODELS;

  function choose(id: WhisperModelId) {
    setSelectedModel(id);
    onNext();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-5xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-3">{t("Выберите уровень Whisper")}</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Модель — это «мозг» распознавателя. Чем выше уровень, тем точнее
          результат, но дольше обработка и больше расход ОЗУ. Уровень можно
          сменить в любой момент — выберите сейчас подходящий стартовый.
          {isEngine && (
            <>
              {" "}Модель будет загружена <span className="text-foreground font-medium">локальным движком автоматически</span> при
              первой транскрибации — вручную ничего скачивать не нужно.
            </>
          )}
        </p>
        {isEngine && (
          <div className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
            <Server className="w-3.5 h-3.5" />
            Режим локального движка — доступны все 5 уровней, включая Large-v3
          </div>
        )}
      </div>

      <div className={`grid gap-4 mb-8 ${isEngine ? "md:grid-cols-3 lg:grid-cols-5" : "md:grid-cols-3"}`}>
        {cards.map((m, i) => {
          const info = MODEL_INFO[m.id];
          const isSelected = selectedModel === m.id;
          const sizeMB = isEngine ? info.engineSizeMB : info.sizeMB;
          const sizeLabel = sizeMB >= 1000 ? `${(sizeMB / 1000).toFixed(1)} ГБ` : `${sizeMB} МБ`;
          return (
            <motion.button
              key={m.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 * i }}
              onClick={() => choose(m.id)}
              className={`glass-card rounded-2xl p-5 text-left transition-all hover:scale-[1.02] hover:border-[#7c5bf5]/50 ${
                isSelected ? "border-[#7c5bf5] glow-primary" : ""
              }`}
            >
              <div className="flex items-start justify-between mb-3 gap-2">
                <h3 className="text-lg font-bold leading-tight">
                  {info.name.replace("Whisper ", "")}
                </h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                    m.badgeTone === "amber"
                      ? "bg-amber-500/15 text-amber-400"
                      : m.badgeTone === "emerald"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-[#7c5bf5]/20 text-[#7c5bf5]"
                  }`}
                >
                  {m.badge}
                </span>
              </div>

              <div className="space-y-2 mb-4">
                <SpecLine icon={HardDrive} label="Размер" value={sizeLabel} />
                <SpecLine icon={Gauge} label="ОЗУ" value={`~${info.ramGB} ГБ`} />
                <SpecLine icon={Zap} label="Скорость" value={info.speed} />
              </div>

              <div className="text-xs text-muted-foreground leading-snug mb-4 min-h-[2.5rem]">
                {info.accuracy}
              </div>

              <div
                className={`w-full py-2 rounded-xl text-center font-medium text-sm transition-colors ${
                  isSelected
                    ? "bg-gradient-primary text-white"
                    : "bg-[#1b2334] text-muted-foreground hover:bg-[#263147] hover:text-foreground"
                }`}
              >
                {isSelected ? (modelStatus === "downloaded" ? "В кеше ✓ — выбрано" : "Выбрано ✓") : "Выбрать →"}
              </div>
            </motion.button>
          );
        })}
      </div>

      {!isEngine && (
        <div className="text-center text-xs text-muted-foreground max-w-2xl mx-auto">
          <Lock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          Уровни Medium и Large-v3 работают только с локальным движком — вы сможете
          включить их в любой момент, установив движок на странице «Медиа».
          Начните с <span className="text-foreground font-medium">Base</span> — она точна
          и почти не нагружает ПК.
        </div>
      )}
      {isEngine && (
        <div className="text-center text-xs text-muted-foreground">
          Боитесь за ресурсы ПК? Начните с <span className="text-foreground font-medium">Small</span> —
          лучший баланс точности и скорости для русского языка.
        </div>
      )}
    </motion.div>
  );
}

function SpecLine({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="w-3.5 h-3.5 text-[#7c5bf5] flex-shrink-0" />
      <span className="text-muted-foreground w-14">{label}</span>
      <span className="font-medium flex-1">{value}</span>
    </div>
  );
}
