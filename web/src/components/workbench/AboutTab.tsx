"use client";

/**
 * Вкладка «О программе» — веб-порт about_tab.py из десктопа.
 * Встроенная справка: возможности, гибридная архитектура, ограничения, приватность.
 */

import { Mic, FileAudio, FileArchive, Languages, Wrench, ShieldCheck, Zap, Globe } from "lucide-react";
import { useOnboarding, MODEL_INFO } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";

const FEATURES = [
  {
    icon: Mic,
    title: "Транскрипция",
    text: "Голос → текст с таймкодами. Локальные файлы (аудио/видео) — прямо в браузере через Whisper. Ссылки YouTube/TikTok — через локальный движок со стратегией Subtitles-First: если у видео есть субтитры, результат готов за секунды без распознавания.",
  },
  {
    icon: FileAudio,
    title: "Медиа",
    text: "Скачивание видео (MP4) и аудио (MP3 192k), очистка звука (шумоподавление afftdn, нормализация EBU R128), вшивание субтитров в кадр (hardsub). URL-операции — через движок, локальные файлы — через ffmpeg.wasm в браузере.",
  },
  {
    icon: FileArchive,
    title: "Конвертер",
    text: "Медиа (mp3/wav/mp4/mkv/webm/ogg/…), изображения (PNG/JPEG/WebP через Canvas) и документы. Медиа можно конвертировать даже без движка — ffmpeg работает прямо на вашей машине внутри вкладки браузера.",
  },
  {
    icon: Languages,
    title: "Перевод",
    text: "Текст и файлы TXT/DOCX/PDF (Google или DeepL). PDF читается прямо в браузере (pdf.js), а режим LAYOUT накладывает перевод на оригинальные страницы с сохранением картинок и разметки — Microsoft Word и LibreOffice не нужны.",
  },
  {
    icon: Wrench,
    title: "Движок и настройки",
    text: "Локальный Python-движок устанавливается одной командой без архивов и сам подтягивается при каждом открытии страницы. В настройках — диагностика железа, управление моделями Whisper и провайдер перевода.",
  },
  {
    icon: ShieldCheck,
    title: "Приватность",
    text: "Файлы обрабатываются на вашем компьютере: Whisper и ffmpeg работают в браузере, движок — на вашей машине. В сеть уходят только: веса моделей (один раз), текст для перевода и URL-задачи.",
  },
];

export function AboutTab() {
  const { t } = useI18n();
  const { selectedModel, engineServerOnline } = useOnboarding();

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Шапка */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-primary flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-xl">T</span>
        </div>
        <div>
          <h2 className="text-2xl font-bold">VoxPaperAi</h2>
          <p className="text-sm text-muted-foreground">
            {t("Транскрибация, медиа-обработка, конвертация и перевод — на ресурсах вашего компьютера, без серверов и без скачивания архивов.")} </p>
          <div className="flex flex-wrap gap-2 mt-2.5">
            <span className="text-xs px-2.5 py-1 rounded-lg bg-[#7c5bf5]/15 text-[#b9a8f7]">
              {MODEL_INFO[selectedModel ?? "base"].name}
            </span>
            <span
              className={`text-xs px-2.5 py-1 rounded-lg ${
                engineServerOnline
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-amber-500/10 text-amber-400"
              }`}
            >
              {engineServerOnline ? t("Движок online") : t("Браузерный режим")}
            </span>
          </div>
        </div>
      </div>

      {/* Возможности */}
      <div className="grid sm:grid-cols-2 gap-3">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.title}
              className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-4"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-[#7c5bf5]" />
                </div>
                <h3 className="font-semibold text-sm">{t(f.title)}</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{t(f.text)}</p>
            </div>
          );
        })}
      </div>

      {/* Как это работает */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#7c5bf5]" />  {t("Как это работает")} </h3>
        <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
          <p>
            <b className="text-foreground">{t("Браузерный режим.")}</b>  {t("Whisper (transformers.js, WASM/WebGPU) и ffmpeg (ffmpeg.wasm) выполняются внутри вкладки — задействуются CPU/GPU и память вашего компьютера. Модель скачивается один раз и кешируется: при следующих открытиях страницы движок подтягивается мгновенно, повторных загрузок нет.")} </p>
          <p>
            <b className="text-foreground">{t("Режим с движком.")}</b>  {t("Локальный Python-движок (engine_server.py) добавляет URL-задачи через yt-dlp с impersonate Chrome, нативный Whisper (в 5–10 раз быстрее WASM) и системный ffmpeg. Страница сама пингует 127.0.0.1:8765 и подключается, как только движок запущен.")} </p>
          <p>
            <b className="text-foreground">Subtitles-First.</b>  {t("Для ссылок сначала проверяются субтитры платформы (ru → en → uk): если они есть, готовый текст с таймкодами возвращается за секунды. Whisper включается только когда субтитров нет.")} </p>
        </div>
      </section>

      {/* Ограничения */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4 text-[#7c5bf5]" />  {t("Ограничения")} </h3>
        <ul className="space-y-2 text-xs text-muted-foreground leading-relaxed">
          <li className="flex gap-2">
            <span className="text-[#7c5bf5]">•</span>
            {t("URL-задачи (YouTube/TikTok) требуют локальный движок — браузер один не справится из-за CORS и bot-защиты платформ.")} </li>
          <li className="flex gap-2">
            <span className="text-[#7c5bf5]">•</span>
            {t("В браузере доступны модели Tiny/Base/Small; Medium и Large-v3 — через движок (нативный Whisper).")} </li>
          <li className="flex gap-2">
            <span className="text-[#7c5bf5]">•</span>
            {t("Перевод идёт через онлайн-API (Google/DeepL) — как и в десктопной версии. Текст уходит в сеть, сами файлы остаются на компьютере.")} </li>
          <li className="flex gap-2">
            <span className="text-[#7c5bf5]">•</span>
            {t("PDF LAYOUT лучше всего работает с текстовыми PDF; для сканов без текстового слоя используйте FAST-режим после OCR.")} </li>
        </ul>
      </section>
    </div>
  );
}
