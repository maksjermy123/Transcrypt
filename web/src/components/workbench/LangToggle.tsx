"use client";

/**
 * Переключатель языка RU / EN для всего сайта.
 * Кнопка-цикл: клик переключает язык, выбор хранится в localStorage (vpai-lang).
 */
import { Globe } from "lucide-react";
import { useI18n, setLang, type Lang } from "@/lib/i18n";

export function LangToggle() {
  const { lang } = useI18n();
  const next: Lang = lang === "ru" ? "en" : "ru";
  return (
    <button
      onClick={() => setLang(next)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#1b2334] text-muted-foreground hover:text-foreground hover:bg-[#263147] transition-colors"
      title={lang === "ru" ? "Switch to English" : "Переключить на русский"}
    >
      <Globe className="w-3.5 h-3.5" />
      {lang === "ru" ? "EN" : "RU"}
    </button>
  );
}
