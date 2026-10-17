"use client";

/**
 * Тема день/ночь с тремя режимами:
 *   auto (по умолчанию) — следовать системной настройке компьютера
 *                         (prefers-color-scheme: Windows/macOS сами меняют
 *                         оформление по времени суток — пользователь просил
 *                         «смена фона автоматически, релевантно настройкам компа»);
 *   dark / light        — ручной выбор.
 *
 * Светлая включается классом .light на <html> (переопределения в globals.css).
 * Выбор хранится в localStorage и применяется синхронным скриптом в layout.tsx
 * до первой отрисовки (без мигания). В режиме auto смена системы применяется
 * на лету через matchMedia- слушатель.
 */

export type Theme = "dark" | "light";
export type ThemeSetting = Theme | "auto";

const THEME_KEY = "transcrypt-theme";

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

/** Подписка для useSyncExternalStore (ThemeToggle). */
export function subscribeTheme(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getStoredSetting(): ThemeSetting {
  if (typeof window === "undefined") return "auto";
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true; // тёмная — визуальная идентичность по умолчанию
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(setting: ThemeSetting): Theme {
  if (setting === "auto") return systemPrefersDark() ? "dark" : "light";
  return setting;
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", theme === "light");
}

/** Резолв применённой сейчас темы (учитывает auto). */
export function getStoredTheme(): Theme {
  return resolveTheme(getStoredSetting());
}

/** Сменить режим темы (auto/dark/light), применить и уведомить подписчиков. */
export function setThemeSetting(setting: ThemeSetting) {
  try {
    localStorage.setItem(THEME_KEY, setting);
  } catch {
    /* ignore */
  }
  applyTheme(resolveTheme(setting));
  emit();
}

// Следим за системной темой: в режиме «авто» применяем смену сразу,
// без перезагрузки страницы (день/ночь переключила сама ОС — сайт догоняет).
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getStoredSetting() === "auto") {
        applyTheme(resolveTheme("auto"));
        emit();
      }
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange); // старые Safari
  } catch {
    /* ignore */
  }
}

/** Цикл переключения кнопкой: auto → dark → light → auto. */
export function cycleThemeSetting(current: ThemeSetting): ThemeSetting {
  return current === "auto" ? "dark" : current === "dark" ? "light" : "auto";
}

/**
 * Синхронный bootstrap — вставляется inline-скриптом до первой отрисовки.
 * Сохранённые "light"/"dark" применяются как есть; отсутствие ключа или "auto" —
 * по системной настройке (prefers-color-scheme).
 */
export const THEME_BOOTSTRAP_SNIPPET = `(function(){try{var s=localStorage.getItem("${THEME_KEY}");var light=s==="light"||((s===null||s==="auto")&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches);if(light)document.documentElement.classList.add("light")}catch(e){}})();`;
