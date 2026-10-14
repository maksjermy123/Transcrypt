"use client";

import { useSyncExternalStore } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { Workbench } from "@/components/workbench/Workbench";

const emptySubscribe = () => () => {};

export default function Home() {
  const {
    completed,
    setCompleted,
    selectedModel,
  } = useOnboarding();
  // Гидратация: на сервере mounted=false (рендер заглушки), на клиенте true.
  // useSyncExternalStore безопасно различает SSR и клиент без setState в эффекте —
  // первый клиентский кадр совпадает с серверным, затем показываем реальный UI.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // Решаем, что показывать: если онбординг завершён — рабочая страница.
  // Движок подтягивается сам: Workbench автоматически пингует 127.0.0.1:8765,
  // браузерная модель загружается лениво при первом использовании.
  const ready = mounted && completed && !!selectedModel;
  const view = ready ? "workbench" : "onboarding";

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Загрузка Transcrypt…</div>
      </div>
    );
  }

  if (view === "workbench") {
    return (
      <Workbench
        onExit={() => {
          setCompleted(false);
        }}
      />
    );
  }

  return (
    <OnboardingWizard
      onStart={() => {
        setCompleted(true);
      }}
    />
  );
}
