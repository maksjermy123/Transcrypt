"use client";

import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { ShieldCheck, Lock, Server, FileText, AlertTriangle, ExternalLink } from "lucide-react";

export default function PrivacyPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-[#0b0f19] text-[#f0f4fc]">
      <header className="sticky top-0 z-50 bg-[#0b0f19]/85 backdrop-blur-xl border-b border-[#263147]/60">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-primary flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-semibold">{t("VoxPaperAi — Политика конфиденциальности")}</span>
          </div>
          <a
            href="/Transcrypt/"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            {t("← На главную")} </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-8"
        >
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-6 h-6 text-[#7c5bf5]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-2">{t("Политика конфиденциальности")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("Действует с 14 октября 2026. VoxPaperAi — opensource проект, лицензия MIT.")} </p>
            </div>
          </div>

          <Section icon={Lock} title={t("1. Что мы НЕ собираем")}>
            <ul className="space-y-2 list-disc list-inside text-sm text-muted-foreground">
              <li>{t("Мы не собираем персональные данные (имя, email, IP, location)")}</li>
              <li>{t("Мы не используем cookies для трекинга")}</li>
              <li>{t("Мы не отправляем аналитику, не встраиваем Google Analytics / Yandex Metrika")}</li>
              <li>{t("Мы не показываем рекламу")}</li>
              <li>{t("Мы не требуем регистрации или аккаунта")}</li>
            </ul>
          </Section>

          <Section icon={FileText} title={t("2. Браузерный режим (Whisper через transformers.js)")}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("Когда вы загружаете локальный аудио/видео файл для транскрипции — он обрабатывается")} <strong>{t("полностью в вашем браузере")}</strong>  {t("через WebAssembly. Файл не покидает ваше устройство, не отправляется на сервер, не сохраняется где-либо за пределами браузера.")} </p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              {t("Браузерный движок (transformers.js ~25 МБ + модель Whisper 40-77 МБ) скачивается один раз с CDN и кешируется в Cache API браузера. При повторном открытии страницы ничего повторно не скачивается.")} </p>
          </Section>

          <Section icon={Server} title={t("3. Локальный движок (engine_server.py)")}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("Если вы устанавливаете локальный движок для URL-задач (YouTube, TikTok, Instagram и др.) — он запускается на вашем компьютере как локальный Python-сервер на")} <code className="font-mono text-xs px-1 py-0.5 rounded bg-[#1b2334]">127.0.0.1:8765</code>{t(". Этот сервер:")} </p>
            <ul className="space-y-2 list-disc list-inside text-sm text-muted-foreground mt-3">
              <li>{t("Доступен только с вашего компьютера (loopback)")}</li>
              <li>{t("Не открывается в интернет (нет port forwarding)")}</li>
              <li>{t("Не отправляет ваши файлы ни на какой внешний сервер")}</li>
              <li>{t("Использует")} <code className="font-mono text-xs px-1 py-0.5 rounded bg-[#1b2334]">yt-dlp</code>  {t("с маскировкой под Chrome для скачивания контента с YouTube/TikTok — это значит, что ваш IP-адрес виден YouTube/TikTok (как и при обычном просмотре видео)")}</li>
              <li>{t("Все скачанные и обработанные файлы хранятся локально на вашем диске")}</li>
              <li>{t("Движок автоматически запускается при включении компьютера (LaunchAgent на macOS, запись в реестре на Windows, systemd user unit на Linux)")}</li>
              <li>{t("Удалить движок полностью:")} <code className="font-mono text-xs px-1 py-0.5 rounded bg-[#1b2334]">rm -rf ~/.transcrypt-engine</code></li>
            </ul>
          </Section>

          <Section icon={AlertTriangle} title={t("4. Что нужно знать про URL-задачи")}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("Скачивание контента с YouTube, TikTok, Instagram и других платформ может нарушать их Условия использования (ToS). VoxPaperAi использует")} <code className="font-mono text-xs px-1 py-0.5 rounded bg-[#1b2334] mx-1">yt-dlp</code>
              {t("— opensource инструмент, который обходит технические ограничения платформ. Юридическая ответственность за использование VoxPaperAi для скачивания защищённого авторским правом контента лежит на пользователе.")} </p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              {t("Рекомендуем использовать VoxPaperAi только для контента, на который у вас есть права, или который доступен под лицензией Creative Commons / Public Domain.")} </p>
          </Section>

          <Section icon={FileText} title={t("5. Отказ от ответственности")}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("ПРОГРАММНОЕ ОБЕСПЕЧЕНИЕ ПРЕДОСТАВЛЯЕТСЯ «КАК ЕСТЬ», БЕЗ КАКИХ-ЛИБО ГАРАНТИЙ, ЯВНЫХ ИЛИ ПОДРАЗУМЕВАЕМЫХ, ВКЛЮЧАЯ, НО НЕ ОГРАНИЧИВАЯСЬ ГАРАНТИЯМИ ТОВАРНОЙ ПРИГОДНОСТИ И ПРИГОДНОСТИ ДЛЯ КОНКРЕТНОЙ ЦЕЛИ.")} </p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              {t("Разработчики VoxPaperAi не несут ответственности за:")} </p>
            <ul className="space-y-1.5 list-disc list-inside text-sm text-muted-foreground mt-2">
              <li>{t("Блокировки со стороны YouTube/TikTok/Instagram (HTTP 429, бан аккаунтов)")}</li>
              <li>{t("Потерю данных в результате использования или неиспользования программы")}</li>
              <li>{t("Нарушение авторских прав или ToS платформ при скачивании контента")}</li>
              <li>{t("Недоступность движка или отдельных функций")}</li>
              <li>{t("Любой ущерб, прямой или косвенный, возникший в результате использования программы")}</li>
            </ul>
            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              {t("Используя VoxPaperAi, вы соглашаетесь с настоящей политикой и принимаете на себя всю ответственность за свои действия.")} </p>
          </Section>

          <Section icon={Lock} title={t("6. Контакты и исходный код")}>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("VoxPaperAi — opensource проект. Полный исходный код доступен на")}{" "}
              <a
                href="https://github.com/maksjermy123/Transcrypt"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#7c5bf5] hover:underline inline-flex items-center gap-1"
              >
                GitHub <ExternalLink className="w-3 h-3" />
              </a>
              {t(". Лицензия MIT — см.")} <code className="font-mono text-xs px-1 py-0.5 rounded bg-[#1b2334]">LICENSE</code>  {t("в репозитории.")} </p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-3">
              {t("Нашли ошибку в политике или уязвимость? Создайте Issue в репозитории на GitHub.")} </p>
          </Section>

          <div className="pt-8 border-t border-[#263147]">
            <a
              href="/Transcrypt/"
              className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 inline-flex items-center gap-2"
            >
              {t("← Понятно, вернуться к VoxPaperAi")} </a>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-card rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-[#7c5bf5]/15 flex items-center justify-center">
          <Icon className="w-5 h-5 text-[#7c5bf5]" />
        </div>
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}
