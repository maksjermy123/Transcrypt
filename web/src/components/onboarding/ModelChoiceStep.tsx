"use client";

import { motion } from "framer-motion";
import { Check, Zap, Gauge, HardDrive } from "lucide-react";
import { useOnboarding, MODEL_INFO, type WhisperModelId } from "@/lib/onboarding-store";

const models: Array<{
  id: WhisperModelId;
  recommended?: boolean;
  badge: string;
}> = [
  {
    id: "tiny",
    badge: "Самая быстрая",
  },
  {
    id: "base",
    recommended: true,
    badge: "Рекомендуется",
  },
];

export function ModelChoiceStep({ onNext }: { onNext: () => void }) {
  const { setSelectedModel, selectedModel, modelStatus } = useOnboarding();

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
      className="max-w-4xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold mb-3">Выберите модель Whisper</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Модель — это «мозг» распознавателя. Чем больше модель, тем точнее
          результат, но дольше обработка и больше расход ОЗУ. Модель можно
          сменить позже — старая автоматически удалится из кеша.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-8">
        {models.map((m, i) => {
          const info = MODEL_INFO[m.id];
          const cached = modelStatus === "downloaded";
          const isSelected = selectedModel === m.id;
          return (
            <motion.button
              key={m.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 * i }}
              onClick={() => choose(m.id)}
              className={`glass-card rounded-2xl p-6 text-left transition-all hover:scale-[1.02] hover:border-[#7c5bf5]/50 ${
                isSelected ? "border-[#7c5bf5] glow-primary" : ""
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold">{info.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {m.recommended ? "Рекомендуется большинству" : "Для слабых ПК и быстрой проверки"}
                  </p>
                </div>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    m.recommended
                      ? "bg-[#7c5bf5]/20 text-[#7c5bf5]"
                      : "bg-amber-500/15 text-amber-400"
                  }`}
                >
                  {m.badge}
                </span>
              </div>

              <div className="space-y-2.5 mb-5">
                <SpecLine icon={HardDrive} label="Размер" value={`${info.sizeMB} МБ`} />
                <SpecLine icon={Gauge} label="ОЗУ" value={`${info.ramGB} ГБ`} />
                <SpecLine icon={Zap} label="Скорость" value={info.speed} />
                <SpecLine icon={Check} label="Точность" value={info.accuracy} />
              </div>

              <div
                className={`w-full py-2.5 rounded-xl text-center font-medium text-sm transition-colors ${
                  isSelected
                    ? "bg-gradient-primary text-white"
                    : "bg-[#1b2334] text-muted-foreground hover:bg-[#263147] hover:text-foreground"
                }`}
              >
                {cached ? "Уже в кеше ✓ — Выбрать" : "Выбрать эту модель →"}
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="text-center text-xs text-muted-foreground">
        Боитесь за ресурсы ПК? Начните с <span className="text-foreground font-medium">Tiny</span> —
        она работает даже на слабых ноутбуках.
      </div>
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
    <div className="flex items-center gap-3 text-sm">
      <Icon className="w-4 h-4 text-[#7c5bf5] flex-shrink-0" />
      <span className="text-muted-foreground w-20">{label}</span>
      <span className="font-medium flex-1">{value}</span>
    </div>
  );
}
