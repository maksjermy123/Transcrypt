"use client";

import { AnimatePresence } from "framer-motion";
import { useOnboarding, type OnboardingStep } from "@/lib/onboarding-store";
import { WelcomeStep } from "./WelcomeStep";
import { ResourcesStep } from "./ResourcesStep";
import { EngineStep } from "./EngineStep";
import { ModelChoiceStep } from "./ModelChoiceStep";
import { ModelDownloadStep } from "./ModelDownloadStep";
import { DoneStep } from "./DoneStep";

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "resources",
  "engine",
  "model-choice",
  "model-download",
  "done",
];

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: "Что умеет",
  resources: "Ресурсы ПК",
  engine: "Движок",
  "model-choice": "Модель",
  "model-download": "Загрузка",
  done: "Готово",
};

export function OnboardingWizard({ onStart }: { onStart: () => void }) {
  const { step, setStep } = useOnboarding();
  const idx = STEP_ORDER.indexOf(step);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky header with step indicator */}
      <header className="sticky top-0 z-50 bg-[#0b0f19]/85 backdrop-blur-xl border-b border-[#263147]/60">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-semibold">Transcrypt</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              · настройка
            </span>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-1.5">
            {STEP_ORDER.map((s, i) => (
              <div key={s} className="flex items-center">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    i < idx
                      ? "w-6 bg-[#7c5bf5]"
                      : i === idx
                      ? "w-10 bg-gradient-primary"
                      : "w-6 bg-[#263147]"
                  }`}
                  title={STEP_LABELS[s]}
                />
                {i < STEP_ORDER.length - 1 && (
                  <div className="w-1.5 h-px bg-transparent" />
                )}
              </div>
            ))}
          </div>

          <div className="text-xs text-muted-foreground hidden md:block">
            {idx + 1} / {STEP_ORDER.length}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <AnimatePresence mode="wait">
          {step === "welcome" && (
            <WelcomeStep key="welcome" onNext={() => setStep("resources")} />
          )}
          {step === "resources" && (
            <ResourcesStep key="resources" onNext={() => setStep("engine")} />
          )}
          {step === "engine" && (
            <EngineStep key="engine" onNext={() => setStep("model-choice")} />
          )}
          {step === "model-choice" && (
            <ModelChoiceStep
              key="model-choice"
              onNext={() => setStep("model-download")}
            />
          )}
          {step === "model-download" && (
            <ModelDownloadStep
              key="model-download"
              onNext={() => setStep("done")}
            />
          )}
          {step === "done" && <DoneStep key="done" onStart={onStart} />}
        </AnimatePresence>
      </main>
    </div>
  );
}
