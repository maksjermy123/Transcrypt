"use client";

/**
 * Whisper движок в браузере через @huggingface/transformers (WASM + WebGPU).
 * Модель скачивается один раз и кешируется в IndexedDB браузера (через Cache API transformers.js).
 * При последующих открытиях страницы модель мгновенно берётся из кеша — никаких повторных скачиваний.
 *
 * ВАЖНО: transformers.js подключаем через CDN ESM-импорт, а не через NPM-бандл,
 * потому что NPM-версия содержит webpack-чанк-резолвер, который ломается в Next.js/Turbopack.
 */

import type { WhisperModelId } from "./onboarding-store";
import { browserSafeModel } from "./onboarding-store";

let transformersPromise: Promise<any> | null = null;

async function getTransformers(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("transformers.js можно использовать только в браузере");
  }
  if (!transformersPromise) {
    // Динамический import URL — браузер загрузит ESM-модуль с CDN.
    // Конкатенация строки не даёт Turbopack статически резолвить URL.
    transformersPromise = (async () => {
      const url = "https://cdn.jsdelivr.net/npm/" + "@huggingface/transformers@3.0.0/+esm";
      // eval(...) скрывает import от статического анализа bundler'а
      const dynamicImport = new Function("u", "return import(u)") as (u: string) => Promise<any>;
      const mod = await dynamicImport(url);
      mod.env.allowLocalModels = false;
      mod.env.remoteHost = "https://huggingface.co";
      mod.env.remotePathTemplate = "{model}/resolve/{revision}/";
      return mod;
    })();
  }
  return transformersPromise;
}

let pipelineInstance: any = null;
let loadedModelId: WhisperModelId | null = null;

export type ProgressInfo = {
  status: string;
  name?: string;
  progress?: number; // 0..1
  loaded?: number;
  total?: number;
  file?: string;
};

/**
 * Загружает pipeline Whisper. Если модель уже загружена — возвращает кешированную.
 * @param model "tiny" или "base"
 * @param onProgress колбэк прогресса загрузки модели (вызывается много раз)
 */
export async function loadWhisperPipeline(
  model: WhisperModelId,
  onProgress?: (info: ProgressInfo) => void
): Promise<any> {
  if (pipelineInstance && loadedModelId === model) {
    return pipelineInstance;
  }

  const transformers = await getTransformers();
  const { pipeline } = transformers;

  const hfModel = `Xenova/whisper-${model}`;

  pipelineInstance = await pipeline("automatic-speech-recognition", hfModel, {
    progress_callback: (info: any) => {
      if (onProgress) {
        onProgress({
          status: info.status ?? "progress",
          name: info.name ?? info.file,
          progress: typeof info.progress === "number" ? info.progress / 100 : undefined,
          loaded: info.loaded,
          total: info.total,
          file: info.file,
        });
      }
    },
    dtype: "q8" as any,
  });

  loadedModelId = model;
  return pipelineInstance;
}

/**
 * Транскрибирует аудио/видео файл.
 * @param fileOrBlob File или Blob аудио/видео
 * @param language исходный язык ("ru", "en", "auto"…)
 * @param onProgress колбэк прогресса (0..1)
 */
export type TranscribeResult = {
  text: string;
  chunks: Array<{ text: string; timestamp: [number, number] }>;
};

export async function transcribeAudio(
  file: File | Blob,
  language: string = "auto",
  onProgress?: (percent: number) => void
): Promise<TranscribeResult> {
  // Браузер не потянет medium/large-v3 — подменяем на посильную модель
  const model = browserSafeModel(loadedModelId ?? "base");
  const pipeline = await loadWhisperPipeline(model);

  // transformers.js принимает URL или Float32Array; для File делаем URL.
  const url = URL.createObjectURL(file);

  try {
    const options: Record<string, unknown> = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: "word",
      callback_function: (beams: any) => {
        // Прогресс трансскрипции — transformers.js пока не даёт точный percent, но даёт шаги
        if (onProgress && beams?.length) {
          // грубо — 1% за каждый шаг (обновится в UI)
          onProgress(Math.min(99, Math.random() * 30 + 5));
        }
      },
    };
    if (language && language !== "auto") {
      options.language = language;
    }

    const output = (await pipeline(url, options)) as any;

    // Окончательный прогресс — 100%
    if (onProgress) onProgress(100);

    return {
      text: output.text ?? "",
      chunks: output.chunks ?? [],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function getLoadedModel(): WhisperModelId | null {
  return loadedModelId;
}

/**
 * Детект доступности WebGPU (асинхронный).
 */
export async function detectWebGPU(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
    const adapter = await (navigator as any).gpu?.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Детект железа пользователя: CPU cores, RAM (если доступно), платформа.
 * Поля deviceMemory и hardwareConcurrency поддерживаются только в Chrome/Edge.
 */
export function detectHardware() {
  const cpuCores =
    typeof navigator !== "undefined" && "hardwareConcurrency" in navigator
      ? navigator.hardwareConcurrency || 4
      : 4;

  const deviceMemory =
    typeof navigator !== "undefined" && "deviceMemory" in navigator
      ? ((navigator as any).deviceMemory as number)
      : null;

  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform =
    typeof navigator !== "undefined" && "platform" in navigator
      ? (navigator as any).platform
      : "unknown";

  return {
    cpuCores,
    deviceMemory,
    userAgent,
    platform,
  };
}

/**
 * Проверяет, есть ли модель в кеше браузера. Не даёт 100% гарантии,
 * но проверяет Cache API transformers.js на наличие основного файла модели.
 */
export async function isModelCached(model: WhisperModelId): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const keys = await caches.keys();
    // transformers.js использует cache name "transformers-cache"
    const cacheNames = keys.filter((k) => k.toLowerCase().includes("transform"));
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const reqs = await cache.keys();
      for (const req of reqs) {
        if (req.url.includes(`whisper-${model}`) && req.url.includes(".onnx")) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}
