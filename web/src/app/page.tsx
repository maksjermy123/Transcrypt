"use client";

import { useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { Workbench } from "@/components/workbench/Workbench";

export default function Home() {
  const {
    completed,
    setCompleted,
    selectedModel,
  } = useOnboarding();
  // Гидратация zustand/persist: первый кадр показывает заглушку, дальше реальные данные.
  const [hydrated] = useState(() => {
    if (typeof window === "undefined") return false;
    // persisted-данные уже синхронно восстановлены из localStorage при первом рендере
    return true;
  });

  // Решаем, что показывать: если онбординг завершён — рабочая страница.
  // Движок подтягивается сам: Workbench автоматически пингует 127.0.0.1:8765,
  // браузерная модель загружается лениво при первом использовании.
  const ready = hydrated && completed && !!selectedModel;
  const view = ready ? "workbench" : "onboarding";

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Загрузка…</div>
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
