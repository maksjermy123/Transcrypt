"use client";

import { AnimatePresence } from "framer-motion";
import { ArrowLeft, X } from "lucide-react";
import { useOnboarding, type OnboardingStep } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { LangToggle } from "@/components/workbench/LangToggle";
import { SiteFooter } from "@/components/SiteFooter";
import { WelcomeStep } from "./WelcomeStep";
import { ChoiceStep } from "./ChoiceStep";
import { ConsentStep } from "./ConsentStep";
import { ResourcesStep } from "./ResourcesStep";
import { EngineStep } from "./EngineStep";
import { ModelChoiceStep } from "./ModelChoiceStep";
import { ModelDownloadStep } from "./ModelDownloadStep";
import { DoneStep } from "./DoneStep";

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "choice",
  "consent",
  "resources",
  "engine",
  "model-choice",
  "model-download",
  "done",
];

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: "Что умеет",
  choice: "Режим",
  consent: "Согласие",
  resources: "Ресурсы ПК",
  engine: "Движок",
  "model-choice": "Модель",
  "model-download": "Загрузка",
  done: "Готово",
};

/**
 * Логика перехода назад:
 *  - с welcome — некуда (это первый шаг)
 *  - с choice → welcome
 *  - с consent → choice
 *  - с resources → consent (если mode === engine) или choice (если mode === browser)
 *  - с engine → resources
 *  - с model-choice → engine
 *  - с model-download → model-choice
 *  - с done → model-download
 */
function getPrevStep(current: OnboardingStep, mode: "browser" | "engine" | null): OnboardingStep | null {
  switch (current) {
    case "welcome":
      return null;
    case "choice":
      return "welcome";
    case "consent":
      return "choice";
    case "resources":
      // Если пользователь выбрал "engine" — он прошёл через consent, иначе сразу с choice
      return mode === "engine" ? "consent" : "choice";
    case "engine":
      return "resources";
    case "model-choice":
      return "engine";
    case "model-download":
      return "model-choice";
    case "done":
      return "model-download";
    default:
      return null;
  }
}

export function OnboardingWizard({ onStart }: { onStart: () => void }) {
  const { step, setStep, mode } = useOnboarding();
  const { t } = useI18n();
  const idx = STEP_ORDER.indexOf(step);
  const prevStep = getPrevStep(step, mode);

  // На шаге welcome кнопки назад нет (это первый шаг)
  const canGoBack = prevStep !== null;

  // Сброс онбординга в начало (из шапки)
  function resetToStart() {
    setStep("welcome");
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky header with step indicator */}
      <header className="sticky top-0 z-50 bg-[#0b0f19]/85 backdrop-blur-xl border-b border-[#263147]/60">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Left: Logo + Back button */}
          <div className="flex items-center gap-2.5 min-w-0">
            {canGoBack ? (
              <button
                onClick={() => prevStep && setStep(prevStep)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[#1b2334] transition-colors"
                title={prevStep ? `${t("Назад к")}: ${t(STEP_LABELS[prevStep])}` : t("Назад")}
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-xs hidden sm:inline">{t("Назад")}</span>
              </button>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center">
                  <span className="text-white font-bold text-sm">V</span>
                </div>
                <span className="font-semibold hidden sm:inline">VoxPaperAi</span>
              </div>
            )}
          </div>

          {/* Center: Stepper (только после Choice) */}
          <div className="flex items-center gap-1.5">
            {idx >= 2 && STEP_ORDER.slice(2).map((s, i) => {
              const realIdx = i + 2;
              return (
                <div key={s} className="flex items-center">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      realIdx < idx
                        ? "w-6 bg-[#7c5bf5]"
                        : realIdx === idx
                        ? "w-10 bg-gradient-primary"
                        : "w-6 bg-[#263147]"
                    }`}
                    title={t(STEP_LABELS[s])}
                  />
                  {i < STEP_ORDER.length - 3 && <div className="w-1.5 h-px bg-transparent" />}
                </div>
              );
            })}
          </div>

          {/* Right: Step counter + Lang + Reset */}
          <div className="flex items-center gap-3">
            {idx >= 2 && (
              <div className="text-xs text-muted-foreground hidden md:block">
                {idx - 1} / {STEP_ORDER.length - 3}
              </div>
            )}
            <LangToggle />
            {canGoBack && (
              <button
                onClick={resetToStart}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[#1b2334]"
                title={t("В начало онбординга")}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <AnimatePresence mode="wait">
          {step === "welcome" && (
            <WelcomeStep
              key="welcome"
              onNext={() => setStep("choice")}
            />
          )}
          {step === "choice" && (
            <ChoiceStep
              key="choice"
              onSelect={(selectedMode) => {
                useOnboarding.getState().setMode(selectedMode);
                setStep(selectedMode === "engine" ? "consent" : "resources");
              }}
            />
          )}
          {step === "consent" && (
            <ConsentStep
              key="consent"
              onAgree={() => setStep("resources")}
              onBack={() => setStep("choice")}
            />
          )}
          {step === "resources" && (
            <ResourcesStep
              key="resources"
              onNext={() => setStep("engine")}
            />
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

      <SiteFooter localLine="VoxPaperAi" />
    </div>
  );
}
