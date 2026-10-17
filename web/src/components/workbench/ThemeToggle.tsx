"use client";

import { Sun, Moon, SunMoon } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  cycleThemeSetting,
  getStoredSetting,
  setThemeSetting,
  subscribeTheme,
  type ThemeSetting,
} from "@/lib/theme";
import { useI18n } from "@/lib/i18n";

/**
 * Переключатель темы в шапке: три состояния — «как в системе» (auto),
 * тёмная, светлая. В auto тема следует настройке компьютера (в т.ч.
 * автоматической смене день/ночь по времени суток) и меняется на лету.
 */
const TITLE_KEYS: Record<ThemeSetting, string> = {
  auto: "Тема: как в системе (меняется сама по настройкам компьютера)",
  dark: "Тема: тёмная",
  light: "Тема: светлая",
};

export function ThemeToggle() {
  const setting = useSyncExternalStore<ThemeSetting>(
    subscribeTheme,
    getStoredSetting,
    () => "auto" as ThemeSetting
  );
  const { t } = useI18n();

  return (
    <button
      onClick={() => setThemeSetting(cycleThemeSetting(setting))}
      title={t(TITLE_KEYS[setting])}
      aria-label={t(TITLE_KEYS[setting])}
      className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[#1b2334] transition-colors"
    >
      {setting === "auto" ? (
        <SunMoon className="w-[18px] h-[18px]" />
      ) : setting === "dark" ? (
        <Moon className="w-[18px] h-[18px]" />
      ) : (
        <Sun className="w-[18px] h-[18px]" />
      )}
    </button>
  );
}
