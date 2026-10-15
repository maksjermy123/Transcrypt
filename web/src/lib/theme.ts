"use client";

/**
 * Тема день/ночь. Тёмная — дефолт и визуальная идентичность продукта;
 * светлая включается классом .light на <html> (переопределения в globals.css).
 * Выбор хранится в localStorage и применяется синхронным скриптом в layout.tsx
 * до первой отрисовки (без мигания тёмным при светлой теме).
 */

export type Theme = "dark" | "light";

const THEME_KEY = "transcrypt-theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", theme === "light");
}

/** Переключить тему и вернуть новую. */
export function toggleTheme(): Theme {
  const next: Theme = getStoredTheme() === "light" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  applyTheme(next);
  return next;
}

/** Синхронный bootstrap — вставляется inline-скриптом до первой отрисовки. */
export const THEME_BOOTSTRAP_SNIPPET = `(function(){try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.classList.add("light")}catch(e){}})();`;
