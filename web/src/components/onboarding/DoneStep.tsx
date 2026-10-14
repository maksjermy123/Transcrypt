"use client";

import { motion } from "framer-motion";
import { Bookmark, BookmarkCheck, PartyPopper, ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";

export function DoneStep({ onStart }: { onStart: () => void }) {
  const { selectedModel, setCompleted } = useOnboarding();
  const [bookmarked, setBookmarked] = useState(false);
  const [canPress, setCanPress] = useState(false);

  // Проверяем, доступна ли закладка (CTRL/CMD+D) — мы не можем её программно установить,
  // но можем поощрить пользователя и подтвердить через dialog.
  useEffect(() => {
    // Небольшая задержка перед тем, как кнопка "Открыть рабочую страницу" станет активной.
    const t = setTimeout(() => setCanPress(true), 800);
    return () => clearTimeout(t);
  }, []);

  function handleAddBookmark() {
    // Открываем системный диалог добавления закладки, если поддерживается
    if (typeof window !== "undefined" && (window as any).sidebar?.addPanel) {
      // Firefox legacy
      (window as any).sidebar.addPanel("Transcrypt", window.location.href, "");
    } else if (typeof window !== "undefined" && (window.external as any)?.AddFavorite) {
      // IE
      (window.external as any).AddFavorite(window.location.href, "Transcrypt");
    } else {
      // Современные браузеры: показываем подсказку
      alert(
        `Чтобы добавить Transcrypt в закладки:\n\n• Windows/Linux: нажмите Ctrl + D\n• macOS: нажмите Cmd + D\n\nЗатем в появившемся окне нажмите "Готово".`
      );
    }
    setBookmarked(true);
  }

  function handleEnter() {
    setCompleted(true);
    onStart();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-2xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-10">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 14 }}
          className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-emerald-500/15 mb-5"
        >
          <PartyPopper className="w-10 h-10 text-emerald-400" />
        </motion.div>
        <h2 className="text-3xl font-bold mb-3">Готово! Всё настроено</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Модель <span className="text-foreground font-medium">Whisper {selectedModel}</span>{" "}
          загружена и кеширована. Движок установлен. Теперь страница готова к
          работе — каждый раз при открытии движок будет подтягиваться
          автоматически.
        </p>
      </div>

      <div className="glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
            {bookmarked ? (
              <BookmarkCheck className="w-5 h-5 text-emerald-500" />
            ) : (
              <Bookmark className="w-5 h-5 text-[#7c5bf5]" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold mb-1">Добавьте страницу в закладки</h3>
            <p className="text-sm text-muted-foreground">
              Так Transcrypt всегда будет под рукой — достаточно открыть
              закладку, и движок сам подтянется из кеша браузера.
            </p>
          </div>
        </div>
        <button
          onClick={handleAddBookmark}
          className={`w-full py-2.5 rounded-xl font-medium text-sm transition-colors ${
            bookmarked
              ? "bg-emerald-500/15 text-emerald-400 cursor-default"
              : "bg-[#1b2334] hover:bg-[#263147] text-foreground"
          }`}
        >
          {bookmarked ? "Закладка добавлена ✓" : "Добавить в закладки"}
        </button>
      </div>

      <div className="glass-card rounded-2xl p-5 mb-8">
        <h3 className="font-medium mb-3 text-sm">Что произойдёт при следующем открытии:</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <Step n={1} text="Браузер открывает страницу из кеша (даже без интернета)" />
          <Step n={2} text="Движок transformers.js автоматически инициализируется из IndexedDB" />
          <Step n={3} text="Модель Whisper берётся из кеша — повторной загрузки не будет" />
          <Step n={4} text="Вы сразу можете начать работать — без настройки" />
        </ul>
      </div>

      <div className="text-center">
        <button
          onClick={handleEnter}
          disabled={!canPress}
          className="bg-gradient-primary text-white px-10 py-4 rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed glow-primary inline-flex items-center gap-2"
        >
          Открыть рабочую страницу
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </motion.div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#7c5bf5]/20 text-[#7c5bf5] text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <span>{text}</span>
    </li>
  );
}
