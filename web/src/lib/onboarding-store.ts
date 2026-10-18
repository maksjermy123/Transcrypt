"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EngineHealth } from "./engine-bridge";

/**
 * Пять уровней Whisper:
 *  - tiny / base / small — доступны и в браузере (transformers.js, q8),
 *  - medium / large-v3 — только через локальный Python-движок (нативный Whisper).
 */
export type WhisperModelId = "tiny" | "base" | "small" | "medium" | "large-v3";

/** Модели, которые реально потянет браузер (WASM/WebGPU). */
export type BrowserModelId = "tiny" | "base" | "small";
export const BROWSER_MODEL_IDS: readonly WhisperModelId[] = ["tiny", "base", "small"];

export function isBrowserModel(id: WhisperModelId): id is BrowserModelId {
  return BROWSER_MODEL_IDS.includes(id);
}

/**
 * Если пользователь выбрал "тяжёлую" модель, доступную только движку,
 * а движок offline и работает браузерный fallback — подменяем на посильную.
 */
export function browserSafeModel(id: WhisperModelId | null): BrowserModelId {
  if (id && isBrowserModel(id)) return id;
  return "small";
}

export type OnboardingStep =
  | "choice"
  | "consent"
  | "desktop"
  | "resources"
  | "engine"
  | "model-choice"
  | "model-download"
  | "done";

/**
 * EngineStatus — статус **браузерного** движка (transformers.js).
 * Это отдельный концепт от локального Python-движка (engineServerOnline).
 */
export type EngineStatus =
  | "not-started"
  | "loading"
  | "ready"
  | "error";

export type ModelStatus =
  | "not-downloaded"
  | "downloading"
  | "downloaded"
  | "error";

type Mode = "browser" | "engine" | "desktop";

export interface HardwareInfo {
  cpuCores: number;
  deviceMemory: number | null; // ГБ, если доступно
  webgpu: boolean;
  threads: number; // рекомендация из runtime-логики
  userAgent: string;
  platform: string;
}

interface OnboardingState {
  step: OnboardingStep;
  mode: Mode | null; // выбор пользователя на шаге ChoiceStep
  engineStatus: EngineStatus;
  modelStatus: ModelStatus;
  selectedModel: WhisperModelId | null;
  hardware: HardwareInfo | null;
  engineError: string | null;
  modelError: string | null;
  engineProgress: number; // 0..100
  modelProgress: number; // 0..100
  modelProgressText: string;
  completed: boolean;
  /** Пользователь уже согласился с политикой — при повторном онбординге шаг согласия пропускается */
  consented: boolean;

  // Гибридный движок: локальный engine_server.py (Python на 127.0.0.1:8765)
  engineServerOnline: boolean; // запущен ли локальный Python-движок
  engineServerHealth: EngineHealth | null; // последнее известное состояние

  setStep: (s: OnboardingStep) => void;
  setMode: (m: Mode) => void;
  setEngineStatus: (s: EngineStatus) => void;
  setModelStatus: (s: ModelStatus) => void;
  setSelectedModel: (m: WhisperModelId) => void;
  setHardware: (h: HardwareInfo) => void;
  setEngineError: (e: string | null) => void;
  setModelError: (e: string | null) => void;
  setEngineProgress: (p: number) => void;
  setModelProgress: (p: number) => void;
  setModelProgressText: (t: string) => void;
  setCompleted: (c: boolean) => void;
  setConsented: (c: boolean) => void;
  setEngineServerOnline: (v: boolean) => void;
  setEngineServerHealth: (h: EngineHealth | null) => void;
  reset: () => void;
}

const initialState = {
  step: "choice" as OnboardingStep, // первый экран — выбор одного из трёх путей
  mode: null as Mode | null,
  engineStatus: "not-started" as EngineStatus,
  modelStatus: "not-downloaded" as ModelStatus,
  selectedModel: null as WhisperModelId | null,
  hardware: null as HardwareInfo | null,
  engineError: null,
  modelError: null,
  engineProgress: 0,
  modelProgress: 0,
  modelProgressText: "",
  completed: false,
  consented: false,
  engineServerOnline: false,
  engineServerHealth: null,
};

export const useOnboarding = create<OnboardingState>()(
  persist(
    (set) => ({
      ...initialState,
      setStep: (s) => set({ step: s }),
      setMode: (mode) => set({ mode }),
      setEngineStatus: (engineStatus) => set({ engineStatus }),
      setModelStatus: (modelStatus) => set({ modelStatus }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setHardware: (hardware) => set({ hardware }),
      setEngineError: (engineError) => set({ engineError }),
      setModelError: (modelError) => set({ modelError }),
      setEngineProgress: (engineProgress) => set({ engineProgress }),
      setModelProgress: (modelProgress) => set({ modelProgress }),
      setModelProgressText: (modelProgressText) => set({ modelProgressText }),
      setCompleted: (completed) => set({ completed }),
      setConsented: (consented) => set({ consented }),
      setEngineServerOnline: (engineServerOnline) => set({ engineServerOnline }),
      setEngineServerHealth: (engineServerHealth) => set({ engineServerHealth }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: "transcrypt-onboarding",
      partialize: (state) => ({
        completed: state.completed,
        consented: state.consented,
        selectedModel: state.selectedModel,
        step: state.completed ? "done" : state.step,
        mode: state.mode,
        engineStatus: state.engineStatus,
        modelStatus: state.modelStatus,
        engineServerOnline: state.engineServerOnline,
      }),
    }
  )
);

/**
 * Рекомендация числа потоков, повторяющая логику runtime.py из Python-проекта:
 * если CPU ≤ 2 — 1 поток; иначе резервируем 25% под систему (мин 1, макс 8).
 */
export function recommendedThreads(cpuCores: number): number {
  if (cpuCores <= 2) return 1;
  const reserve = Math.max(1, Math.floor(cpuCores / 4));
  return Math.max(1, Math.min(8, cpuCores - reserve));
}

export const MODEL_INFO: Record<
  WhisperModelId,
  {
    name: string;
    sizeMB: number; // размер для браузера (q8), 0 — недоступна в браузере
    engineSizeMB: number; // размер, который скачает локальный движок
    ramGB: number;
    speed: string;
    accuracy: string;
    accent: string; // цвет бейджа
  }
> = {
  tiny: {
    name: "Whisper Tiny",
    sizeMB: 40,
    engineSizeMB: 72,
    ramGB: 1,
    speed: "Очень быстрая",
    accuracy: "Базовая — хорошо для чистой речи и черновиков",
    accent: "amber",
  },
  base: {
    name: "Whisper Base",
    sizeMB: 77,
    engineSizeMB: 139,
    ramGB: 1.5,
    speed: "Быстрая",
    accuracy: "Хорошая — уверенный баланс для большинства задач",
    accent: "violet",
  },
  small: {
    name: "Whisper Small",
    sizeMB: 250,
    engineSizeMB: 461,
    ramGB: 2.5,
    speed: "Средняя",
    accuracy: "Заметно лучше Base — отличный выбор для русского языка",
    accent: "violet",
  },
  medium: {
    name: "Whisper Medium",
    sizeMB: 0, // в браузере не используется
    engineSizeMB: 1400,
    ramGB: 5,
    speed: "Медленная",
    accuracy: "Высокая — сложная лексика, шумные записи",
    accent: "emerald",
  },
  "large-v3": {
    name: "Whisper Large-v3",
    sizeMB: 0, // в браузере не используется
    engineSizeMB: 2900,
    ramGB: 10,
    speed: "Очень медленная",
    accuracy: "Максимальная — студийное качество распознавания",
    accent: "emerald",
  },
};
