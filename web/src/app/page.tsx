"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { Workbench } from "@/components/workbench/Workbench";
import { applyTheme, getStoredTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";

const emptySubscribe = () => () => {};

export default function Home() {
  const {
    completed,
    setCompleted,
    selectedModel,
  } = useOnboarding();
  const { t } = useI18n();
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

  // Домашняя страница (приветствие/онбординг) — всегда ТЁМНАЯ: это брендовая
  // идентичность. Сохранённый выбор темы не трогаем — при входе в рабочую
  // область возвращаем то, что выбрал пользователь.
  useEffect(() => {
    if (view === "onboarding") {
      applyTheme("dark");
    } else {
      applyTheme(getStoredTheme());
    }
  }, [view]);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">{t("Загрузка VoxPaperAi…")}</div>
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
