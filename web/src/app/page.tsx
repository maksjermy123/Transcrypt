"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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

  /* Стартовая страница как режим просмотра, а не сброс: showHome лишь показывает
     стартовый экран ПОВЕРХ сохранённой настройки. completed остаётся true — настройки,
     модель и согласие не трогаются, а онбординг с нуля начинается только по явному
     сбросу (Настройки → Сброс / Очистка данных). Перезагрузка страницы возвращает
     на рабочую страницу, а не в мастер настройки. */
  const [showHome, setShowHome] = useState(false);

  // Решаем, что показывать: если онбординг завершён — рабочая страница.
  // Движок подтягивается сам: Workbench автоматически пингует 127.0.0.1:8765,
  // браузерная модель загружается лениво при первом использовании.
  // Режим desktop не требует модели (программа ставится отдельно) — модель не обязательна.
  const ready = mounted && completed && (!!selectedModel || mode === "desktop");
  const view = ready && !showHome ? "workbench" : "onboarding";

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
        /* Установка движка: мастер открывается на шаге engine, настройка не сбрасывается.
           После установки DoneStep → onStart вернёт на рабочую страницу. */
        onExit={() => setShowHome(true)}
        /* «На стартовую страницу» из Настроек: показываем стартовый экран с быстрым
           возвратом («Перейти к работе»), без повторного прохождения онбординга. */
        onGoHome={() => {
          useOnboarding.getState().setStep("choice");
          setShowHome(true);
        }}
      />
    );
  }

  return (
    <OnboardingWizard
      onStart={() => {
        setCompleted(true);
        setShowHome(false);
      }}
      onReturnToWork={() => setShowHome(false)}
    />
  );
}
