"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Cpu,
  HardDrive,
  Zap,
  ShieldCheck,
  ExternalLink,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { useState } from "react";

export function ConsentStep({
  onAgree,
  onBack,
}: {
  onAgree: () => void;
  onBack: () => void;
}) {
  const [consented, setConsented] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const canProceed = consented && acknowledged;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-2xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/15 mb-5">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
        </div>
        <h2 className="text-3xl font-bold mb-3">Внимание: ресурсы и ответственность</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Локальный движок задействует ресурсы вашего компьютера. Перед установкой
          важно понять, что произойдёт.
        </p>
      </div>

      {/* Что произойдёт */}
      <div className="glass-card rounded-2xl p-6 mb-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-amber-400" />
          Что задействует локальный движок
        </h3>
        <div className="space-y-3">
          <ResourceLine
            icon={HardDrive}
            title="~800 МБ на диске"
            text="Whisper + yt-dlp + ffmpeg-python + зависимости. Устанавливаются в ~/.transcrypt-engine/"
          />
          <ResourceLine
            icon={Cpu}
            title="CPU/RAM при работе"
            text="Whisper загружает CPU до 90% и занимает 1-4 ГБ RAM во время распознавания. После завершения задачи ресурсы освобождаются."
          />
          <ResourceLine
            icon={Zap}
            title="Автозапуск с системой"
            text="Движок стартует автоматически при включении компьютера (LaunchAgent/реестр/systemd). Удалить автозапуск: rm -rf ~/.transcrypt-engine/"
          />
          <ResourceLine
            icon={ShieldCheck}
            title="Сетевые запросы"
            text="При URL-задачах (YouTube) движок обращается к YouTube с вашего IP через yt-dlp с маскировкой под Chrome. Ваши файлы не отправляются ни на какой сервер."
          />
        </div>
      </div>

      {/* Политика конфиденциальности — краткая + ссылка */}
      <div className="glass-card rounded-2xl p-5 mb-5">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#7c5bf5]" />
          Политика конфиденциальности
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          <strong className="text-foreground">Кратко:</strong> мы не собираем
          персональные данные, не используем cookies для трекинга, не показываем
          рекламу. Локальные файлы обрабатываются в браузере, не покидают ваше
          устройство. URL-задачи идут через локальный движок с вашего IP. Полный
          текст политики — по ссылке ниже.
        </p>
        <a
          href="/Transcrypt/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-[#7c5bf5] hover:underline"
        >
          Открыть полный текст политики
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Отказ от ответственности */}
      <div className="glass-card rounded-2xl p-5 mb-5">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          Отказ от ответственности
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Программа предоставляется «как есть», без гарантий. Разработчики не несут
          ответственности за блокировки YouTube/TikTok, потерю данных, нарушение
          авторских прав, недоступность движка. Скачивание контента с YouTube/TikTok
          может нарушать их ToS — юридическая ответственность лежит на пользователе.
        </p>
      </div>

      {/* Чекбоксы согласия */}
      <div className="glass-card rounded-2xl p-5 mb-6 space-y-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-1 w-4 h-4 accent-[#7c5bf5] cursor-pointer"
          />
          <span className="text-sm">
            Я прочитал(а) и принимаю{" "}
            <a
              href="/Transcrypt/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#7c5bf5] hover:underline"
            >
              Политику конфиденциальности
            </a>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-1 w-4 h-4 accent-[#7c5bf5] cursor-pointer"
          />
          <span className="text-sm">
            Я понимаю, что использую программу на свой риск и принимаю отказ от
            ответственности. Скачивание контента с YouTube/TikTok/Instagram может
            нарушать их условия — ответственность за это лежит на мне.
          </span>
        </label>
      </div>

      {/* Кнопки */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Назад
        </button>
        <button
          onClick={onAgree}
          disabled={!canProceed}
          className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-2 glow-primary"
        >
          Принять и продолжить
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {!canProceed && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          Чтобы продолжить — отметьте обе галочки выше
        </p>
      )}
    </motion.div>
  );
}

function ResourceLine({
  icon: Icon,
  title,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-[#0b0f19]/40">
      <div className="w-8 h-8 rounded-lg bg-[#1b2334] flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-amber-400" />
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{text}</div>
      </div>
    </div>
  );
}
