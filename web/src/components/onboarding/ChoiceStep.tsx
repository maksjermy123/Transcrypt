"use client";

import { motion } from "framer-motion";
import { Check, X, Globe, Server, ArrowRight, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Mode = "browser" | "engine";

const COMPARISON: Array<{ feature: string; browser: string | boolean; engine: string | boolean }> = [
  { feature: "Транскрипция коротких локальных файлов (до 200 МБ)", browser: true, engine: true },
  { feature: "Транскрипция длинных файлов (1+ час)", browser: "Медленно", engine: "Быстро (нативный Whisper)" },
  { feature: "Транскрипция по URL (YouTube, TikTok, Instagram)", browser: false, engine: true },
  { feature: "Скачивание видео с YouTube/TikTok", browser: false, engine: true },
  { feature: "Скачивание аудио (MP3 192k)", browser: false, engine: true },
  { feature: "Конвертация медиа (mp4↔mp3, wav, ogg)", browser: "Через ffmpeg.wasm (медленно)", engine: "Через нативный ffmpeg (быстро)" },
  { feature: "Конвертация изображений (PNG/JPEG/WebP)", browser: true, engine: true },
  { feature: "Конвертация текстовых файлов", browser: true, engine: true },
  { feature: "Приватность", browser: "Файлы не покидают браузер", engine: "Файлы не покидают ваш компьютер" },
  { feature: "Установка", browser: "Не нужна (Whisper в браузере)", engine: "~800 МБ на диске + автозапуск" },
  { feature: "Скорость распознавания", browser: "Средняя (WASM)", engine: "Высокая (нативный Whisper)" },
];

export function ChoiceStep({ onSelect }: { onSelect: (mode: Mode) => void }) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-4xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold mb-3">{t("Выберите режим работы")}</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          {t("VoxPaperAi можно использовать двумя способами. Выберите подходящий — сменить режим можно в любой момент в настройках.")}
        </p>
      </div>

      {/* Две карточки выбора */}
      <div className="grid md:grid-cols-2 gap-5 mb-10">
        <ChoiceCard
          mode="browser"
          icon={Globe}
          title={t("Только браузер")}
          subtitle={t("Без установки")}
          desc={t("Whisper работает прямо в браузере через WebAssembly. Подходит для коротких локальных файлов, не требует установки Python.")}
          cta={t("Продолжить без установки")}
          recommended={false}
          onSelect={() => onSelect("browser")}
        />
        <ChoiceCard
          mode="engine"
          icon={Server}
          title={t("С локальным движком")}
          subtitle={t("Полный функционал")}
          desc={t("Установка локального Python-движка (~800 МБ). Доступны URL-задачи (YouTube, TikTok), скачивание видео и аудио, нативный Whisper (в 5+ раз быстрее).")}
          cta={t("Установить движок →")}
          recommended={true}
          onSelect={() => onSelect("engine")}
        />
      </div>

      {/* Таблица сравнения */}
      <div className="glass-card rounded-2xl p-6 overflow-x-auto">
        <h3 className="font-semibold mb-4 text-sm">{t("Подробное сравнение")}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#263147]">
              <th className="text-left py-2 px-3 text-muted-foreground font-medium">{t("Функция")}</th>
              <th className="text-center py-2 px-3 text-muted-foreground font-medium w-32">
                <Globe className="w-4 h-4 mx-auto mb-1" />
                {t("Только браузер")}
              </th>
              <th className="text-center py-2 px-3 text-[#7c5bf5] font-medium w-32">
                <Server className="w-4 h-4 mx-auto mb-1" />
                {t("С движком")}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-[#7c5bf5]" />
        <span>
          {t("В любом режиме ваши файлы не покидают устройство. Подробнее —")}{" "}
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

function ChoiceCard({
  icon: Icon,
  title,
  subtitle,
  desc,
  cta,
  recommended,
  onSelect,
}: {
  mode: Mode;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  desc: string;
  cta: string;
  recommended: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.99 }}
      onClick={onSelect}
      className={`glass-card rounded-2xl p-6 text-left transition-all hover:border-[#7c5bf5]/50 ${
        recommended ? "border-[#7c5bf5]/40 glow-primary" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center">
          <Icon className="w-6 h-6 text-[#7c5bf5]" />
        </div>
        {recommended && (
          <span className="text-xs px-2 py-1 rounded-full bg-[#7c5bf5]/20 text-[#7c5bf5] font-medium">
            {t("Рекомендуется")}
          </span>
        )}
      </div>
      <h3 className="text-xl font-bold mb-1">
        {title}
        <span className="text-sm text-muted-foreground font-normal ml-2">· {subtitle}</span>
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5">{desc}</p>
      <div className="flex items-center gap-2 text-[#7c5bf5] font-medium text-sm">
        {cta}
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
