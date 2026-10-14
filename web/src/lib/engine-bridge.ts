"use client";

/**
 * Мост к локальному engine_server.py (Python-движок на 127.0.0.1:8765).
 *
 * Гибридная архитектура:
 *  - Веб-страница на GitHub Pages проверяет, запущен ли локальный движок.
 *  - Если движок есть — все URL-задачи (YouTube, TikTok, и др.) идут через него,
 *    потому что только yt-dlp с impersonate умеет обходить блокировки YouTube.
 *  - Если движка нет — fallback на Whisper в браузере (только локальные файлы).
 *
 * Эндпоинты engine_server.py:
 *  GET  /api/health         — статус, версия, доступность ffmpeg/ffprobe, модели
 *  GET  /api/progress        — прогресс активной задачи (полинг)
 *  GET  /api/download?file=  — скачать готовый файл (после задачи)
 *  POST /api/transcribe      — транскрипция (URL или file_path)
 *  POST /api/media           — скачать видео/аудио, очистить аудио, вшить субтитры
 *  POST /api/convert         — конвертация медиа/документов/изображений
 *  POST /api/upload          — загрузка файла с веб-страницы на движок (multipart)
 *  POST /api/stop            — отмена активной задачи
 *
 * Эндпоинт /api/transcribe уже реализует стратегию "Subtitles First":
 *   1. Пробует получить субтитры на выбранном языке (или fallback ru/en/uk)
 *   2. Если субтитры есть — парсит их в сегменты (быстро, без Whisper)
 *   3. Если субтитров нет — скачивает аудио и запускает Whisper
 *
 * CORS уже настроен в engine_server.py: Access-Control-Allow-Origin: *
 */

const ENGINE_URL = "http://127.0.0.1:8765";

export type EngineHealth = {
  status: "ok" | "error";
  version?: string;
  platform?: string;
  system_name?: string;
  device?: string;
  recommended_threads?: number;
  ffmpeg?: boolean;
  ffprobe?: boolean;
  libreoffice?: boolean;
  whisper_models?: string[];
};

export type EngineProgress = {
  active: boolean;
  task: string;
  stage: string;
  percent: number;
  eta: string;
  log: string[];
};

export type TranscribeParams = {
  url?: string;
  file_path?: string;
  model?: string;
  language?: string;
  translate_to?: string;
  save_audio?: boolean;
  save_video?: boolean;
};

export type TranscribeResult = {
  status: string;
  source: string;
  detected_language: string;
  text: string;
  segments_count: number;
  files: { txt: string; srt: string; vtt: string; json: string };
};

export type MediaAction = "download_video" | "download_audio" | "clean_audio" | "hardsub";

export type MediaParams = {
  action: MediaAction;
  url?: string;
  file_path?: string;
  sub_lang?: string;
  sub_file?: string;
  model?: string;
};

export type TaskResult = {
  status: string;
  file?: string;
  message?: string;
};

/**
 * Проверяет, запущен ли локальный движок.
 * Таймаут — 1.5 секунды (это локальный сервер, должен отвечать мгновенно).
 */
export async function checkEngineHealth(): Promise<EngineHealth | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1500);
    const resp = await fetch(`${ENGINE_URL}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const data = (await resp.json()) as EngineHealth;
    return data;
  } catch {
    return null;
  }
}

/**
 * Запускает задачу на движке и поллит прогресс до завершения.
 * @param endpoint POST-эндпоинт: /api/transcribe, /api/media, /api/convert
 * @param body тело запроса
 * @param onProgress колбэк прогресса
 * @param pollIntervalMs интервал поллинга /api/progress (мс)
 * @returns ответ сервера на POST-запрос
 */
async function runTaskWithProgress<T>(
  endpoint: string,
  body: unknown,
  onProgress?: (p: EngineProgress) => void,
  pollIntervalMs = 400
): Promise<T> {
  // Запускаем поллинг прогресса сразу (асинхронно)
  let polling = true;
  const poll = async () => {
    while (polling) {
      try {
        const r = await fetch(`${ENGINE_URL}/api/progress`);
        if (r.ok) {
          const p = (await r.json()) as EngineProgress;
          onProgress?.(p);
          if (!p.active && p.percent >= 100) {
            polling = false;
            return;
          }
        }
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  };
  void poll();

  try {
    const resp = await fetch(`${ENGINE_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`Некорректный ответ сервера: ${text.slice(0, 200)}`);
    }
    if (!resp.ok) {
      throw new Error(result?.message || `HTTP ${resp.status}`);
    }
    // Финальный апдейт прогресса
    polling = false;
    onProgress?.({
      active: false,
      task: "",
      stage: "Готово",
      percent: 100,
      eta: "",
      log: [],
    });
    return result as T;
  } catch (err) {
    polling = false;
    throw err;
  }
}

/**
 * Загружает файл с веб-страницы на локальный движок.
 * Возвращает абсолютный путь к сохранённому файлу.
 */
export async function uploadFileToEngine(
  file: File | Blob,
  filename?: string
): Promise<string> {
  const formData = new FormData();
  const name =
    filename ||
    (file instanceof File ? file.name : `upload_${Date.now()}.bin`);
  formData.append("file", file, name);

  const resp = await fetch(`${ENGINE_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Загрузка не удалась: HTTP ${resp.status} ${txt}`);
  }

  const data = await resp.json();
  if (data.status !== "success") {
    throw new Error(data.message || "Загрузка не удалась");
  }
  return data.file_path as string;
}

/**
 * Транскрипция через engine_server (Subtitles-First стратегия).
 * Принимает либо URL, либо загруженный файл.
 */
export async function transcribeViaEngine(
  params: TranscribeParams,
  onProgress?: (p: EngineProgress) => void
): Promise<TranscribeResult> {
  return runTaskWithProgress<TranscribeResult>(
    "/api/transcribe",
    params,
    onProgress
  );
}

/**
 * Медиа-операции через engine_server.
 */
export async function mediaViaEngine(
  params: MediaParams,
  onProgress?: (p: EngineProgress) => void
): Promise<TaskResult> {
  return runTaskWithProgress<TaskResult>("/api/media", params, onProgress);
}

/**
 * Конвертация через engine_server (медиа, документы, изображения).
 */
export async function convertViaEngine(
  file_path: string,
  target_format: string,
  onProgress?: (p: EngineProgress) => void
): Promise<TaskResult> {
  return runTaskWithProgress<TaskResult>(
    "/api/convert",
    { file_path, target_format },
    onProgress
  );
}

/**
 * Остановить активную задачу на движке.
 */
export async function stopEngineTask(): Promise<void> {
  try {
    await fetch(`${ENGINE_URL}/api/stop`, { method: "POST" });
  } catch {
    /* ignore */
  }
}

/**
 * Скачать готовый файл с движка по относительному пути из ответа задачи.
 * @param relPath относительный путь (например "/api/download?file=/path/to/file.srt")
 */
export async function fetchEngineFile(relPath: string): Promise<Blob> {
  const url = relPath.startsWith("http")
    ? relPath
    : `${ENGINE_URL}${relPath}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Не удалось скачать файл: HTTP ${resp.status}`);
  return await resp.blob();
}

/**
 * Скачать готовый файл с движка и сохранить локально.
 */
export async function downloadEngineFile(relPath: string, fallbackName: string): Promise<void> {
  const blob = await fetchEngineFile(relPath);
  // Имя файла из Content-Disposition
  const cd = blob.type;
  void cd;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Извлекаем имя из URL если возможно
  let name = fallbackName;
  try {
    const u = new URL(relPath.startsWith("http") ? relPath : `${ENGINE_URL}${relPath}`);
    const fileParam = u.searchParams.get("file");
    if (fileParam) {
      name = decodeURIComponent(fileParam.split("/").pop() || fallbackName);
    }
  } catch {
    /* ignore */
  }
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
