"use client";

import { useEffect } from "react";
import { applyTheme, getStoredTheme } from "@/lib/theme";

/**
 * Ре-применяет сохранённую тему сразу после гидратации.
 *
 * Bootstrap-скрипт в layout добавляет класс light до первой отрисовки (без FOUC),
 * но React при гидратации сбрасывает className у <html> на серверное значение
 * ("dark") — без этого компонента светлая тема «слетала» при каждой перезагрузке
 * страницы, пока пользователь снова не щёлкнул бы тумблер.
 */
export function ThemeSync() {
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);
  return null;
}
