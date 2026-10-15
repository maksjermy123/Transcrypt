"use client";

import { Sun, Moon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { getStoredTheme, toggleTheme, type Theme } from "@/lib/theme";

/** Мини-стор темы: localStorage — источник истины, подписка — для перерисовки кнопки. */
const themeStore = {
  listeners: new Set<() => void>(),
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  },
  emit() {
    this.listeners.forEach((l) => l());
  },
  snapshot: (): Theme => getStoredTheme(),
  serverSnapshot: (): Theme => "dark",
};

/** Переключатель день/ночь в шапке. Тема применяется к <html> и переживает перезагрузку. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(
    (l) => themeStore.subscribe(l),
    themeStore.snapshot,
    themeStore.serverSnapshot
  );
  const isLight = theme === "light";

  return (
    <button
      onClick={() => {
        toggleTheme();
        themeStore.emit();
      }}
      title={isLight ? "Включить тёмную тему" : "Включить светлую тему"}
      aria-label={isLight ? "Включить тёмную тему" : "Включить светлую тему"}
      className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[#1b2334] transition-colors"
    >
      {isLight ? <Moon className="w-[18px] h-[18px]" /> : <Sun className="w-[18px] h-[18px]" />}
    </button>
  );
}
