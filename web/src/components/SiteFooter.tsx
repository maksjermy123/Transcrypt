"use client";

/**
 * Общий футер сайта: работает на лендинге (онбординг) и в рабочей области.
 * Слева — статус и сброс, справа — контакты проекта VoxPaperAi:
 * благодарность автору, сообщество и второй продукт (для админов TG-каналов).
 */
import { Heart, Users, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function SiteFooter({
  localLine,
  onReset,
}: {
  /** Строка слева: статус/брендинг (уже переведённая вызывающей стороной) */
  localLine?: string;
  onReset?: () => void;
}) {
  const { t } = useI18n();
  return (
    <footer className="border-t border-[#263147]/60 py-4 px-6">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted-foreground text-center">
        {localLine && <span>{localLine}</span>}
        {onReset && (
          <>
            <span className="text-[#263147]">·</span>
            <button onClick={onReset} className="text-[#7c5bf5] hover:underline">
              {t("Сбросить настройки")}
            </button>
          </>
        )}
      </div>
      <div className="max-w-6xl mx-auto mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs">
        <a
          href="https://t.me/MaksErem"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-[#a78bfa] transition-colors"
        >
          <Heart className="w-3.5 h-3.5 text-rose-400/80" />
          {t("Выразить благодарность")}
        </a>
        <a
          href="https://t.me/Chtenie_Preobrazenie"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-[#a78bfa] transition-colors"
        >
          <Users className="w-3.5 h-3.5 text-sky-400/80" />
          {t("Присоединиться к сообществу")}
        </a>
        <a
          href="https://tinyurl.com/oglavlenie"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-[#a78bfa] transition-colors"
        >
          <Send className="w-3.5 h-3.5 text-emerald-400/80" />
          {t("Посмотреть другой продукт (для админов Телеграм-каналов)")}
        </a>
      </div>
    </footer>
  );
}
