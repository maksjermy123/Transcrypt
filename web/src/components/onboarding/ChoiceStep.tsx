"use client";

import { motion } from "framer-motion";
import {
  Check,
  X,
  Minus,
  Globe,
  Server,
  MonitorSmartphone,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Mode = "browser" | "engine" | "desktop";

/**
 * Честный обзор каждого пути — то, что реально даёт режим.
 * Важно: не приукрашиваем — пользователь должен сразу понимать, что получает.
 */
const PATHS: Array<{
  mode: Mode;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  pros: string[];
  cons: string[];
  cta: string;
  recommended: boolean;
}> = [
  {
    mode: "browser",
    icon: Globe,
    title: "В браузере — без установки",
    subtitle: "Начать за минуту",
    pros: [
      "Работает сразу — ничего не устанавливать",
      "Транскрипция локальных файлов (Whisper прямо в браузере)",
      "Перевод, конвертация, генератор промптов для AI-конспекта",
      "Файлы не покидают браузер",
    ],
    cons: [
      "Без YouTube/TikTok: нет задач по ссылке и скачивания",
      "Вкладка должна оставаться открытой — фоновой работы нет",
      "Медленнее и только короткие файлы (модели tiny–small)",
    ],
    cta: "Продолжить в браузере",
    recommended: false,
  },
  {
    mode: "engine",
    icon: Server,
    title: "Браузер + локальный движок",
    subtitle: "Полный функционал",
    pros: [
      "Всё из режима слева — и быстро (нативный Whisper, в 5+ раз быстрее)",
      "YouTube/TikTok: транскрипция по ссылке, скачивание видео/аудио",
      "Фоновые задачи — вкладку можно закрыть",
      "Файлы не покидают компьютер",
    ],
    cons: [
      "Нужна установка: Python-движок ~800 МБ (установщик делает всё сам)",
      "Движок стартует вместе с системой (автозапуск)",
    ],
    cta: "Установить движок →",
    recommended: true,
  },
  {
    mode: "desktop",
    icon: MonitorSmartphone,
    title: "Программа на компьютер",
    subtitle: "Полностью локально",
    pros: [
      "Всё выше — в отдельной программе: сайт и браузер не нужны",
      "Своё окно, как у обычного приложения",
      "Работает офлайн (модель Whisper докачается при первом запуске)",
      "Бесплатна, исходники открыты",
    ],
    cons: [
      "Установщик большой: ~1–2 ГБ (Whisper и все библиотеки внутри)",
      "Windows 64-bit / macOS 12+ (Intel и Apple Silicon) / Linux",
    ],
    cta: "Скачать программу →",
    recommended: false,
  },
];

/**
 * Таблица сравнения трёх путей. Значения: boolean | строка-пояснение.
 */
const COMPARISON: Array<{
  feature: string;
  browser: string | boolean;
  engine: string | boolean;
  desktop: string | boolean;
}> = [
  {
    feature: "Транскрипция локальных файлов",
    browser: "Короткие (до ~200 МБ)",
    engine: true,
    desktop: true,
  },
  {
    feature: "Скорость распознавания",
    browser: "Средняя (WASM)",
    engine: "Быстро (нативный Whisper)",
    desktop: "Быстро (нативный Whisper)",
  },
  { feature: "Whisper medium / large-v3", browser: false, engine: true, desktop: true },
  { feature: "Транскрипция по URL (YouTube, TikTok…)", browser: false, engine: true, desktop: true },
  { feature: "Скачивание видео/аудио", browser: false, engine: true, desktop: true },
  {
    feature: "Конвертация медиа",
    browser: "Через ffmpeg.wasm (медленно)",
    engine: true,
    desktop: true,
  },
  { feature: "Конвертация изображений и текстов", browser: true, engine: true, desktop: true },
  { feature: "Перевод текста и файлов", browser: true, engine: true, desktop: true },
  { feature: "Фоновые задачи (вкладку можно закрыть)", browser: false, engine: true, desktop: true },
  {
    feature: "Транскрипция без интернета",
    browser: "После загрузки модели в кеш",
    engine: "Да, для локальных файлов",
    desktop: "Да, для локальных файлов",
  },
  {
    feature: "Приватность",
    browser: "Файлы не покидают браузер",
    engine: "Файлы не покидают ваш компьютер",
    desktop: "Файлы не покидают ваш компьютер",
  },
  {
    feature: "Установка",
    browser: "Не нужна",
    engine: "~800 МБ на диске + автозапуск",
    desktop: "~1–2 ГБ, одна программа",
  },
];

export function ChoiceStep({ onSelect }: { onSelect: (mode: Mode) => void }) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-5xl mx-auto px-6 py-10"
    >
      {/* Hero — что это и зачем выбор */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-primary mb-5">
          <span className="text-white font-bold text-xl">V</span>
        </div>
        <h2 className="text-3xl font-bold mb-3">{t("Добро пожаловать в VoxPaperAi")}</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {t("Транскрипция, перевод и конвертация для студентов. Бесплатно. Выберите, как работать, — на каждом пути честно показано, что вы получите. Сменить режим можно в любой момент в настройках.")}
        </p>
      </div>

      {/* Три карточки путей */}
      <div className="grid md:grid-cols-3 gap-5 mb-10">
        {PATHS.map((p) => (
          <PathCard key={p.mode} path={p} onSelect={() => onSelect(p.mode)} />
        ))}
      </div>

      {/* Таблица сравнения */}
      <div className="glass-card rounded-2xl p-6 overflow-x-auto">
        <h3 className="font-semibold mb-4 text-sm">{t("Подробное сравнение")}</h3>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-[#263147]">
              <th className="text-left py-2 px-3 text-muted-foreground font-medium">{t("Функция")}</th>
              <th className="text-center py-2 px-3 text-muted-foreground font-medium">
                <Globe className="w-4 h-4 mx-auto mb-1" />
                {t("Браузер")}
              </th>
              <th className="text-center py-2 px-3 text-[#7c5bf5] font-medium">
                <Server className="w-4 h-4 mx-auto mb-1" />
                {t("Браузер + движок")}
              </th>
              <th className="text-center py-2 px-3 text-muted-foreground font-medium">
                <MonitorSmartphone className="w-4 h-4 mx-auto mb-1" />
                {t("Программа")}
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-[#1b2334]/30" : ""}>
                <td className="py-2.5 px-3 text-foreground/90">{t(row.feature)}</td>
                <td className="py-2.5 px-3 text-center">
                  <FeatureCell value={row.browser} />
                </td>
                <td className="py-2.5 px-3 text-center">
                  <FeatureCell value={row.engine} />
                </td>
                <td className="py-2.5 px-3 text-center">
                  <FeatureCell value={row.desktop} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-[#7c5bf5]" />
        <span>
          {t("В любом режиме ваши файлы не покидают устройство. Программа бесплатна. Подробнее —")}{" "}
          <a
            href="/Transcrypt/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#7c5bf5] hover:underline"
          >
            {t("Политика конфиденциальности")}
          </a>
        </span>
      </div>
    </motion.div>
  );
}

function PathCard({
  path,
  onSelect,
}: {
  path: (typeof PATHS)[number];
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const Icon = path.icon;
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.99 }}
      onClick={onSelect}
      className={`glass-card rounded-2xl p-5 text-left flex flex-col transition-all hover:border-[#7c5bf5]/50 ${
        path.recommended ? "border-[#7c5bf5]/40 glow-primary" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-11 h-11 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-[#7c5bf5]" />
        </div>
        {path.recommended && (
          <span className="text-xs px-2 py-1 rounded-full bg-[#7c5bf5]/20 text-[#7c5bf5] font-medium">
            {t("Рекомендуется")}
          </span>
        )}
      </div>
      <h3 className="text-lg font-bold mb-0.5">{t(path.title)}</h3>
      <p className="text-xs text-muted-foreground mb-3">{t(path.subtitle)}</p>
      <ul className="space-y-1.5 mb-4 flex-1">
        {path.pros.map((pro, i) => (
          <li key={`p${i}`} className="text-xs leading-relaxed flex items-start gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
            <span>{t(pro)}</span>
          </li>
        ))}
        {path.cons.map((con, i) => (
          <li key={`c${i}`} className="text-xs leading-relaxed text-muted-foreground flex items-start gap-1.5">
            <Minus className="w-3.5 h-3.5 text-amber-500/80 flex-shrink-0 mt-0.5" />
            <span>{t(con)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 text-[#7c5bf5] font-medium text-sm mt-auto">
        {t(path.cta)}
        <ArrowRight className="w-4 h-4" />
      </div>
    </motion.button>
  );
}

function FeatureCell({ value }: { value: string | boolean }) {
  const { t } = useI18n();
  if (value === true) return <Check className="w-4 h-4 text-emerald-500 mx-auto" />;
  if (value === false) return <X className="w-4 h-4 text-red-500/70 mx-auto" />;
  return <span className="text-xs text-muted-foreground">{t(value)}</span>;
}
