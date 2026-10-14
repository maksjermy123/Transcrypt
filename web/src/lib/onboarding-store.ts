"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EngineHealth } from "./engine-bridge";

export type WhisperModelId = "tiny" | "base";

export type OnboardingStep =
  | "welcome"
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

interface HardwareInfo {
  cpuCores: number;
  deviceMemory: number | null; // ГБ, если доступно
  webgpu: boolean;
  threads: number; // рекомендация из runtime-логики
  userAgent: string;
  platform: string;
}

interface OnboardingState {
  step: OnboardingStep;
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

  // Гибридный движок: локальный engine_server.py (Python на 127.0.0.1:8765)
  engineServerOnline: boolean; // запущен ли локальный Python-движок
  engineServerHealth: EngineHealth | null; // последнее известное состояние

  setStep: (s: OnboardingStep) => void;
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
  setEngineServerOnline: (v: boolean) => void;
  setEngineServerHealth: (h: EngineHealth | null) => void;
  reset: () => void;
}

const initialState = {
  step: "welcome" as OnboardingStep,
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
  engineServerOnline: false,
  engineServerHealth: null,
};

export const useOnboarding = create<OnboardingState>()(
  persist(
    (set) => ({
      ...initialState,
      setStep: (s) => set({ step: s }),
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
      setEngineServerOnline: (engineServerOnline) => set({ engineServerOnline }),
      setEngineServerHealth: (engineServerHealth) => set({ engineServerHealth }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: "transcrypt-onboarding",
      partialize: (state) => ({
        completed: state.completed,
        selectedModel: state.selectedModel,
        step: state.completed ? "done" : state.step,
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
  { name: string; sizeMB: number; ramGB: number; speed: string; accuracy: string }
> = {
  tiny: {
    name: "Whisper Tiny",
    sizeMB: 40,
    ramGB: 1,
    speed: "Очень быстрая",
    accuracy: "Базовая — хорошо для чистой речи и русских субтитров",
  },
  base: {
    name: "Whisper Base",
    sizeMB: 77,
    ramGB: 1.5,
    speed: "Быстрая",
    accuracy: "Хорошая — рекомендована для большинства задач",
  },
};
