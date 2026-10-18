"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, FileAudio, FileArchive, Server, ServerOff, Zap, X, Languages, Wrench, Info, ShieldCheck } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { checkEngineHealth } from "@/lib/engine-bridge";
import { useI18n } from "@/lib/i18n";
import { TranscribeTab } from "./TranscribeTab";
import { MediaTab } from "./MediaTab";
import { ConvertTab } from "./ConvertTab";
import { TranslateTab } from "./TranslateTab";
import { SettingsTab } from "./SettingsTab";
import { AboutTab } from "./AboutTab";
import { ThemeToggle } from "./ThemeToggle";
import { LangToggle } from "./LangToggle";
import { SiteFooter } from "@/components/SiteFooter";

type WorkTab = "transcribe" | "media" | "convert" | "translate" | "settings" | "about";

const TABS: { id: WorkTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: "transcribe", label: "Транскрипция", icon: Mic, hint: "Whisper превратит голос в текст с таймкодами" },
  { id: "media", label: "Медиа", icon: FileAudio, hint: "Скачивание видео/аудио по ссылкам через локальный движок" },
  { id: "convert", label: "Конвертер", icon: FileArchive, hint: "Медиа через ffmpeg, изображения, документы" },
  { id: "translate", label: "Перевод", icon: Languages, hint: "Текст и файлы TXT/DOCX/PDF, включая LAYOUT с разметкой" },
  { id: "settings", label: "Настройки", icon: Wrench, hint: "Железо, движок, модели Whisper, переводчик" },
  { id: "about", label: "О программе", icon: Info, hint: "Возможности, архитектура и ограничения" },
];

export function Workbench({
  onExit,
  onGoHome,
}: {
  /** Открыть стартовый экран (например, перед установкой движка) — настройку не сбрасывает */
  onExit: () => void;
  /** «На стартовую страницу» из Настроек — показать стартовый экран с быстрым возвратом */
  onGoHome?: () => void;
}) {
  const { selectedModel, reset, engineServerOnline, setEngineServerOnline, setEngineServerHealth, setStep } = useOnboarding();
  const { t } = useI18n();
  const [tab, setTab] = useState<WorkTab>("transcribe");
  const [checking, setChecking] = useState(true);
  const [showBanner, setShowBanner] = useState(true);

  // Последняя активная вкладка восстанавливается после перезагрузки страницы:
  // перезагрузка из «Медиа» возвращает в «Медиа», а не в «Транскрипцию».
  // Эффект вместо ленивого useState — иначе SSR-кадр разошёлся бы с клиентом.
  useEffect(() => {
    try {
      const v = localStorage.getItem("transcrypt.activeTab");
      if (v && TABS.some((x) => x.id === v)) setTab(v as WorkTab);
    } catch {
      /* ignore */
    }
  }, []);

  function switchTab(id: WorkTab) {
    setTab(id);
    try {
      localStorage.setItem("transcrypt.activeTab", id);
    } catch {
      /* ignore */
    }
  }

  // Авто-пинг локального движка при загрузке
  // Гистерезис: «движок online» ставится сразу при первом успехе, а «движка нет» —
  // только после 3 неудачных опросов ПОДРЯД. Один медленный/пропавший ответ
  // (антивирус, холодный старт, нагрузка) больше не мигает индикатором.
  const failStreakRef = useRef(0);
  const inFlightRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    async function check() {
      // Одна проверка за раз: интервал + возврат на вкладку не должны
      // запускать параллельные опросы (двойное setChecking мигает спиннером)
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setChecking(true);
      try {
        const health = await checkEngineHealth();
        if (cancelled) return;
        const online = !!health && health.status === "ok";
        if (online) failStreakRef.current = 0;
        else failStreakRef.current += 1;
        const wasOnline = useOnboarding.getState().engineServerOnline;
        const showOnline = online || (wasOnline && failStreakRef.current < 3);
        setEngineServerOnline(showOnline);
        setEngineServerHealth(showOnline ? health : null);
        // Если движок появился — скрываем баннер
        if (online) setShowBanner(false);
      } finally {
        inFlightRef.current = false;
        if (!cancelled) setChecking(false);
      }
    }
    void check();
    // Пингуем каждые 30 сек — чтобы поймать момент, когда пользователь запустит движок
    const interval = setInterval(check, 30000);
    // Возврат на вкладку — мгновенная проверка. После установки/обновления движка
    // установщик НЕ открывает новое окно: пользователь просто переключается на
    // уже открытую вкладку, и она сразу подхватывает движок. В фоновой вкладке
    // браузер замедляет таймеры, поэтому одного интервала мало.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [setEngineServerOnline, setEngineServerHealth]);

  // Перейти к шагу установки локального движка (engine step в онбординге)
  function goToEngineInstall() {
    // Выходим в онбординг и прыгаем на шаг engine
    setStep("engine");
    onExit();
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Шапка */}
      <header className="sticky top-0 z-50 bg-[#0b0f19]/85 backdrop-blur-xl border-b border-[#263147]/60">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Бренд — кликабельный: ведёт на страницу Транскрипции (главную вкладку).
              Кнопка «На стартовую страницу» живёт в Настройках. */}
          <button
            onClick={() => switchTab("transcribe")}
            className="flex items-center gap-2.5 rounded-xl px-1.5 py-1 -mx-1.5 -my-1 hover:bg-[#1b2334] transition-colors flex-shrink-0"
            title={t("VoxPaperAi — на страницу Транскрипции")}
            aria-label={t("На страницу Транскрипции")}
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">V</span>
            </div>
            <span className="font-semibold">VoxPaperAi</span>
          </button>

          {/* Tabs */}
          <nav className="flex items-center gap-1 bg-[#1b2334] rounded-xl p-1 overflow-x-auto max-w-full">
            {TABS.map((t2) => {
              const Icon = t2.icon;
              return (
                <button
                  key={t2.id}
                  onClick={() => switchTab(t2.id)}
                  title={t(t2.hint)}
                  className={`px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors inline-flex items-center gap-1.5 flex-shrink-0 ${
                    tab === t2.id
                      ? "bg-gradient-primary text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden xl:inline">{t(t2.label)}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {/* Индикатор движка — КЛИКАБЕЛЬНЫЙ */}
            {/* Удаление движка перенесено в Настройки → «Удаление VoxPaperAi» */}
            <button
              onClick={engineServerOnline ? undefined : goToEngineInstall}
              disabled={engineServerOnline}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                engineServerOnline
                  ? "bg-emerald-500/15 text-emerald-400 cursor-default"
                  : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 cursor-pointer"
              } ${checking ? "opacity-60" : ""}`}
              title={
                engineServerOnline
                  ? t("Локальный Python-движок запущен — все функции доступны, включая URL-задачи с YouTube")
                  : t("Локальный движок не найден. Нажмите чтобы установить.")
              }
            >
              {engineServerOnline ? (
                <>
                  <Server className="w-3.5 h-3.5 hidden 2xl:block" />
                  <span className="hidden 2xl:inline">{t("Движок online")}</span>
                  <Server className="w-3.5 h-3.5 2xl:hidden" />
                </>
              ) : (
                <>
                  <ServerOff className="w-3.5 h-3.5" />
                  <span className="hidden 2xl:inline">{t("Только браузер — нажмите чтобы установить движок")}</span>
                  <span className="2xl:hidden">{t("Только браузер")}</span>
                </>
              )}
            </button>

            {/* Приватность: вся обработка на компьютере пользователя — ключевой аргумент для студентов */}
            <span
              className="hidden 2xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 cursor-help"
              title={t("Вся обработка идёт на вашем компьютере: аудио не загружается на серверы, записи не покидают устройство. Работает даже без интернета.")}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {t("100% локально")}
            </span>

            <LangToggle />

            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Баннер с предложением установить движок, если он не запущен */}
      {!engineServerOnline && !checking && showBanner && (
        <div className="bg-gradient-to-r from-amber-500/15 to-amber-500/5 border-b border-amber-500/30">
          <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center gap-3 text-sm">
            <Zap className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-amber-200 font-medium">{t("Хотите URL-задачи с YouTube/TikTok и быструю транскрипцию длинных файлов?")}</span>{" "}
              <span className="text-amber-300/80">{t("Установите локальный движок — он работает в 5-10 раз быстрее и не зависает на длинных аудио.")}</span>
            </div>
            <button
              onClick={goToEngineInstall}
              className="bg-gradient-primary text-white px-4 py-1.5 rounded-lg text-xs font-medium hover:opacity-90 whitespace-nowrap inline-flex items-center gap-1.5"
            >
              <Zap className="w-3 h-3" />
              {t("Установить движок")}
            </button>
            <button
              onClick={() => setShowBanner(false)}
              className="p-1 rounded-md text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10"
              title={t("Скрыть")}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Контент */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {tab === "transcribe" && <TranscribeTab onInstallEngine={goToEngineInstall} />}
            {tab === "media" && <MediaTab />}
            {tab === "convert" && <ConvertTab />}
            {tab === "translate" && <TranslateTab />}
            {tab === "settings" && <SettingsTab onInstallEngine={goToEngineInstall} onGoHome={onGoHome} />}
            {tab === "about" && <AboutTab />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Футер */}
      <SiteFooter
        localLine={`VoxPaperAi · ${t("работает локально на вашем компьютере")} · Whisper ${selectedModel}${
          engineServerOnline ? ` · 🟢 ${t("Локальный движок online")}` : ` · 🟡 ${t("Только браузерный режим")}`
        }`}
        onReset={reset}
      />
    </div>
  );
}
