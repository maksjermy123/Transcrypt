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
    mode,
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
  // Режим desktop не требует модели (программа ставится отдельно) — модель не обязательна.
  const ready = mounted && completed && (!!selectedModel || mode === "desktop");
  const view = ready ? "workbench" : "onboarding";

  // Тема везде одна (включая онбординг): auto следует настройке компьютера
  // (prefers-color-scheme — ОС меняет оформление по времени суток), иначе
  // сохранённый ручной выбор. Без ветвления — иначе онбординг мигал бы
  // тёмным на светлой системе и наоборот.
  useEffect(() => {
    applyTheme(getStoredTheme());
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
