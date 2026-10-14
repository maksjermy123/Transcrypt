"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TranslateProvider } from "./translate";

/**
 * Настройки перевода (веб-аналог секции «Перевод» из settings_tab.py).
 * Хранится в localStorage — переживает перезагрузки.
 */

interface SettingsState {
  provider: TranslateProvider;
  deeplKey: string;
  defaultTargetLang: string;
  pdfMode: "LAYOUT" | "FAST";

  setProvider: (p: TranslateProvider) => void;
  setDeeplKey: (k: string) => void;
  setDefaultTargetLang: (l: string) => void;
  setPdfMode: (m: "LAYOUT" | "FAST") => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      provider: "google",
      deeplKey: "",
      defaultTargetLang: "ru",
      pdfMode: "LAYOUT",

      setProvider: (provider) => set({ provider }),
      setDeeplKey: (deeplKey) => set({ deeplKey }),
      setDefaultTargetLang: (defaultTargetLang) => set({ defaultTargetLang }),
      setPdfMode: (pdfMode) => set({ pdfMode }),
    }),
    { name: "transcrypt-settings" }
  )
);
