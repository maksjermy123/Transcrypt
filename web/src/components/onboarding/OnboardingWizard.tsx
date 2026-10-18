"use client";

import { AnimatePresence } from "framer-motion";
import { ArrowLeft, X } from "lucide-react";
import { useOnboarding, type OnboardingStep } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { LangToggle } from "@/components/workbench/LangToggle";
import { SiteFooter } from "@/components/SiteFooter";
import { ChoiceStep } from "./ChoiceStep";
import { ConsentStep } from "./ConsentStep";
import { ResourcesStep } from "./ResourcesStep";
import { EngineStep } from "./EngineStep";
import { ModelChoiceStep } from "./ModelChoiceStep";
import { ModelDownloadStep } from "./ModelDownloadStep";
import { DoneStep } from "./DoneStep";
import { DesktopStep } from "./DesktopStep";

/**
 * Первый экран онбординга — выбор одного из ТРЁХ путей (ChoiceStep):
 *  1. Только браузер (без установки) — честный обзор возможностей и ограничений.
 *  2. Браузер + локальный движок — полный функционал.
 *  3. Настольная программа — скачивание установщика под ОС/процессор с GitHub Releases.
 *
 * Пути:
 *  browser → resources → engine → model-choice → model-download → done
 *  engine  → consent → resources → engine → … → done
 *  desktop → consent → desktop → done
 */
const STEP_ORDER: OnboardingStep[] = [
  "choice",
  "consent",
  "desktop",
  "resources",
  "engine",
  "model-choice",
  "model-download",
  "done",
];

const STEP_LABELS: Record<OnboardingStep, string> = {
  choice: "Режим",
  consent: "Согласие",
  desktop: "Программа",
  resources: "Ресурсы ПК",
  engine: "Движок",
  "model-choice": "Модель",
  "model-download": "Загрузка",
  done: "Готово",
};

/**
 * Логика перехода назад:
 *  - с choice — некуда (это первый шаг)
 *  - с consent → choice
 *  - с desktop → consent
 *  - с resources → consent (если mode === engine) или choice (если mode === browser)
 *  - с engine → resources
 *  - с model-choice → engine
 *  - с model-download → model-choice
 *  - с done → desktop (режим desktop) или model-download
 */
function getPrevStep(current: OnboardingStep, mode: "browser" | "engine" | "desktop" | null): OnboardingStep | null {
  switch (current) {
    case "choice":
      return null;
    case "consent":
      return "choice";
    case "desktop":
      return "consent";
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
      return mode === "desktop" ? "desktop" : "model-download";
    default:
      return null;
  }
}

export function OnboardingWizard({
  onStart,
  onReturnToWork,
}: {
  onStart: () => void;
  /** Вернуться на рабочую страницу без повторной настройки — доступно,
   *  когда онбординг уже был завершён (бренд в шапке и баннер на первом шаге). */
  onReturnToWork?: () => void;
}) {
  const { step, setStep, mode, completed, selectedModel } = useOnboarding();
  const { t } = useI18n();
  const idx = STEP_ORDER.indexOf(step);
  const prevStep = getPrevStep(step, mode);
  // Шаги ленты прогресса: всё после согласия, кроме desktop-пути (он короткий — без ленты).
  // Явная аннотация нужна: filter сам сужает тип и indexOf(step) перестаёт компилироваться.
  const visibleSteps: OnboardingStep[] = STEP_ORDER.slice(2).filter((s) => s !== "desktop");

  // На шаге welcome кнопки назад нет (это первый шаг)
  const canGoBack = prevStep !== null;

  /* Состояние «уже настроен»: онбординг завершён и есть всё нужное для работы.
     Такой пользователь не должен проходить мастер заново: бренд в шапке и баннер
     на первом шаге возвращают на рабочую страницу, а шаг согласия пропускается. */
  const configured = completed && (!!selectedModel || mode === "desktop");

  // Сброс онбординга в начало (из шапки)
  function resetToStart() {
    setStep("choice");
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
            ) : configured && onReturnToWork ? (
              /* Бренд кликабелен для уже настроенного пользователя — быстрый возврат к работе */
              <button
                onClick={onReturnToWork}
                className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 -mx-1.5 -my-1 hover:bg-[#1b2334] transition-colors"
                title={t("Вернуться к работе — настройки сохранены")}
              >
                <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center">
                  <span className="text-white font-bold text-sm">V</span>
                </div>
                <span className="font-semibold hidden sm:inline">VoxPaperAi</span>
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

          {/* Center: Stepper (шаги после согласия; в режиме desktop путь короткий — точки не нужны) */}
          <div className="flex items-center gap-1.5">
            {idx >= 2 && mode !== "desktop" && visibleSteps.map((s) => {
              const realIdx = STEP_ORDER.indexOf(s);
              return (
                <div key={s}>
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
                </div>
              );
            })}
          </div>

          {/* Right: Step counter + Lang + Reset */}
          <div className="flex items-center gap-3">
            {idx >= 2 && mode !== "desktop" && (
              <div className="text-xs text-muted-foreground hidden md:block">
                {visibleSteps.indexOf(step) + 1} /{" "}
                {visibleSteps.length}
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
          {step === "choice" && (
            <ChoiceStep
              key="choice"
              welcomeBack={configured}
              onReturnToWork={onReturnToWork}
              onSelect={(selectedMode) => {
                useOnboarding.getState().setMode(selectedMode);
                /* Согласие с политикой запрашивается один раз: если пользователь уже
                   соглашался — шаг consent пропускается, идём сразу к делу. */
                if (!useOnboarding.getState().consented) {
                  setStep("consent");
                  return;
                }
                setStep(selectedMode === "desktop" ? "desktop" : "resources");
              }}
            />
          )}
          {step === "consent" && (
            <ConsentStep
              key="consent"
              onAgree={() => {
                useOnboarding.getState().setConsented(true);
                setStep(mode === "desktop" ? "desktop" : "resources");
              }}
              onBack={() => setStep("choice")}
            />
          )}
          {step === "desktop" && (
            <DesktopStep
              key="desktop"
              onNext={() => setStep("done")}
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
