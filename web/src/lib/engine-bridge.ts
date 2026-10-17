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
 * Job API (движок ≥ 1.1.0) — задачи переживают закрытие вкладки:
 *   POST /api/jobs        — создать фоновую задачу → {job_id}
 *   GET  /api/jobs/<id>   — статус + прогресс + результат
 *   POST /api/jobs/<id>/cancel — отмена
 *   Активные задачи хранятся в localStorage (transcrypt.activeJobs —
 *   ОТДЕЛЬНАЯ запись на каждую вкладку: транскрипция, медиа, конвертер),
 *   поэтому можно вести несколько задач параллельно/в очереди, а при
 *   возврате на вкладку / перезагрузке страницы UI переподключается
 *   к своей задаче и забирает готовый результат.
 *
 * CORS уже настроен в engine_server.py: Access-Control-Allow-Origin: *
 */

const ENGINE_URL = "http://127.0.0.1:8765";

export type EngineHealth = {
  status: "ok" | "error";
  version?: string;
  jobs?: boolean; // Job API: фоновые задачи, переживающие закрытие вкладки (движок ≥ 1.1.0)
  queue?: boolean; // очереди задач + параллельные полосы (движок ≥ 1.2.0)
  docs?: boolean; // конвертация документов Word ↔ PDF ↔ TXT (движок ≥ 1.3.0)
  ytdlp?: string; // версия yt-dlp в окружении движка (движок ≥ 1.3.3) — диагностика YouTube
  parallel_heavy?: number; // сколько тяжёлых задач выполняется одновременно
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
  translate_to?: string; // hardsub: перевод субтитров перед вшиванием ("-" — без перевода)
};

export type TaskResult = {
  status: string;
  file?: string;
  message?: string;
};

/**
 * Проверяет, запущен ли локальный движок.
 * Таймаут — 3 секунды: на Windows движок отвечает мгновенно, но под нагрузкой
 * (антивирус, холодный старт, параллельная задача) ответ может задержаться —
 * раньше таймаут 1.5 с приводил к «миганию» индикатора «Движок online».
 */
export async function checkEngineHealth(): Promise<EngineHealth | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
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
    // Защита от «устаревшего» 100% от предыдущей задачи: пока не увидим
    // живую активность (active=true или percent в процессе), завершение не засчитываем.
    let sawActive = false;
    while (polling) {
      try {
        const r = await fetch(`${ENGINE_URL}/api/progress`);
        if (r.ok) {
          const p = (await r.json()) as EngineProgress;
          onProgress?.(p);
          if (p.active || (p.percent > 0 && p.percent < 100)) sawActive = true;
          if (sawActive && !p.active && p.percent >= 100) {
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
 * На движке ≥ 1.1.0 задача выполняется в фоне (Job API) и переживает
 * закрытие вкладки; на старом движке — классический долгий POST.
 */
export async function transcribeViaEngine(
  params: TranscribeParams,
  onProgress?: (p: EngineProgress) => void,
  label?: string
): Promise<TranscribeResult> {
  return runEngineTask<TranscribeResult>({
    type: "transcribe",
    endpoint: "/api/transcribe",
    body: params as unknown as Record<string, unknown>,
    label: label || params.url || params.file_path || "транскрипция",
    onProgress,
  });
}

/**
 * Медиа-операции через engine_server.
 */
export async function mediaViaEngine(
  params: MediaParams,
  onProgress?: (p: EngineProgress) => void,
  label?: string
): Promise<TaskResult> {
  return runEngineTask<TaskResult>({
    type: "media",
    endpoint: "/api/media",
    body: params as unknown as Record<string, unknown>,
    label: label || params.url || params.file_path || params.action,
    onProgress,
  });
}

/**
 * Конвертация через engine_server (медиа, документы, изображения).
 */
export async function convertViaEngine(
  file_path: string,
  target_format: string,
  onProgress?: (p: EngineProgress) => void,
  label?: string
): Promise<TaskResult> {
  return runEngineTask<TaskResult>({
    type: "convert",
    endpoint: "/api/convert",
    body: { file_path, target_format },
    label: label || file_path,
    onProgress,
  });
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


// ═══════════════════════════════════════════════════════════════
//  Job API (движок ≥ 1.1.0): фоновые задачи + восстановление
// ═══════════════════════════════════════════════════════════════

export type EngineTaskType = "transcribe" | "media" | "convert";

export type EngineJobState = {
  job_id: string;
  type: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress?: {
    active?: boolean;
    task?: string;
    stage?: string;
    percent?: number;
    eta?: string;
    log?: string[];
  };
  result?: unknown;
  error?: string | null;
  label?: string;
  created_at?: number;
  finished_at?: number | null;
  lane?: string;
  queue_position?: number; // позиция в очереди (только для status === "queued")
};

export type ActiveJobRecord = {
  jobId: string;
  type: EngineTaskType;
  params: Record<string, unknown>;
  label: string;
  startedAt: number;
};

/**
 * Активные задачи — по одной на вкладку (transcribe / media / convert),
 * чтобы задачи на разных вкладках НЕ мешали друг другу и не затирали
 * записи друг друга (старый единственный слот transcrypt.activeJob
 * приводил к «слёту» задачи при старте новой на другой вкладке).
 */
const ACTIVE_JOBS_KEY = "transcrypt.activeJobs";
const LEGACY_ACTIVE_JOB_KEY = "transcrypt.activeJob"; // single-slot до v9

type ActiveJobMap = Partial<Record<EngineTaskType, ActiveJobRecord>>;

function readActiveJobs(): ActiveJobMap {
  try {
    const raw = localStorage.getItem(ACTIVE_JOBS_KEY);
    if (raw) return JSON.parse(raw) as ActiveJobMap;
    // Миграция со старого единственного слота — незавершённая задача
    // не должна пропасть после обновления сайта
    const legacy = localStorage.getItem(LEGACY_ACTIVE_JOB_KEY);
    if (legacy) {
      const rec = JSON.parse(legacy) as ActiveJobRecord;
      if (rec?.jobId && rec?.type) {
        const map: ActiveJobMap = { [rec.type]: rec };
        localStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(map));
        localStorage.removeItem(LEGACY_ACTIVE_JOB_KEY);
        return map;
      }
    }
    return {};
  } catch {
    return {};
  }
}

function writeActiveJobs(map: ActiveJobMap) {
  try {
    localStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function readActiveJob(type: EngineTaskType): ActiveJobRecord | null {
  return readActiveJobs()[type] || null;
}

function writeActiveJob(rec: ActiveJobRecord) {
  const map = readActiveJobs();
  map[rec.type] = rec;
  writeActiveJobs(map);
}

export function clearActiveJob(type: EngineTaskType) {
  const map = readActiveJobs();
  if (!map[type]) return;
  delete map[type];
  writeActiveJobs(map);
}

/** Устаревший single-slot API для отладки (не используется вкладками) */
export function readAnyActiveJob(): ActiveJobRecord | null {
  const map = readActiveJobs();
  for (const t of ["transcribe", "media", "convert"] as EngineTaskType[]) {
    if (map[t]) return map[t];
  }
  return null;
}

async function startEngineJob(
  type: EngineTaskType,
  params: unknown,
  label: string
): Promise<string | null> {
  try {
    const resp = await fetch(`${ENGINE_URL}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, params, label }),
    });
    if (!resp.ok) return null; // старый движок без Job API
    const data = await resp.json();
    return typeof data?.job_id === "string" ? data.job_id : null;
  } catch {
    return null;
  }
}

type JobFetch =
  | { kind: "ok"; job: EngineJobState }
  | { kind: "notfound" }
  | { kind: "offline" };

async function getEngineJob(jobId: string): Promise<JobFetch> {
  try {
    const resp = await fetch(
      `${ENGINE_URL}/api/jobs/${encodeURIComponent(jobId)}`
    );
    if (resp.status === 404) return { kind: "notfound" };
    if (!resp.ok) return { kind: "offline" };
    const job = (await resp.json()) as EngineJobState;
    return { kind: "ok", job };
  } catch {
    return { kind: "offline" };
  }
}

// Возврат на вкладку мгновенно будит циклы поллинга (в фоне таймеры
// браузер замедляет — поэтому ждём и wake-сигнала, и таймаута)
const wakeResolvers = new Set<() => void>();
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const rs = Array.from(wakeResolvers);
      wakeResolvers.clear();
      rs.forEach((r) => r());
    }
  });
}

function delayWithWake(ms: number): Promise<void> {
  return new Promise<void>((res) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      wakeResolvers.delete(finish);
      res();
    };
    const timer = setTimeout(finish, ms);
    wakeResolvers.add(finish);
  });
}

async function watchEngineJob<T>(
  jobId: string,
  onProgress?: (p: EngineProgress) => void,
  type?: EngineTaskType
): Promise<T> {
  // Чистим свой слот только если в нём всё ещё ЭТА задача
  // (в слоте того же типа могла оказаться более новая задача)
  const clearOwnSlot = () => {
    if (!type) return;
    const cur = readActiveJob(type);
    if (cur?.jobId === jobId) clearActiveJob(type);
  };
  let firstOfflineAt = 0;
  for (;;) {
    const f = await getEngineJob(jobId);
    if (f.kind === "ok") {
      firstOfflineAt = 0;
      const j = f.job;
      const jp = j.progress || {};
      let stage = jp.stage ?? "";
      if (j.status === "queued" && !stage) stage = "В очереди";
      if (
        j.status === "queued" &&
        typeof j.queue_position === "number" &&
        j.queue_position > 1
      ) {
        stage += ` — впереди ещё ${j.queue_position - 1}`;
      }
      onProgress?.({
        active: j.status === "queued" || j.status === "running",
        task: j.type || "",
        stage,
        percent: typeof jp.percent === "number" ? jp.percent : 0,
        eta: jp.eta ?? "",
        log: jp.log ?? [],
      });
      if (j.status === "done") {
        clearOwnSlot();
        onProgress?.({ active: false, task: "", stage: "Готово", percent: 100, eta: "", log: [] });
        return j.result as T;
      }
      if (j.status === "error") {
        clearOwnSlot();
        throw new Error(j.error || "Задача завершилась с ошибкой");
      }
      if (j.status === "cancelled") {
        clearOwnSlot();
        throw new Error(j.error || "Задача отменена");
      }
      await delayWithWake(document.hidden ? 4000 : 700);
      continue;
    }
    if (f.kind === "notfound") {
      clearOwnSlot();
      throw new Error("Задача не найдена — движок перезапускался без сохранённого журнала");
    }
    // offline: движок мог перезапускаться — ждём, но не вечно
    if (!firstOfflineAt) firstOfflineAt = Date.now();
    if (Date.now() - firstOfflineAt > 120000) {
      // Не чистим слот — задача могла дожить на движке, попробуем при следующем возврате
      throw new Error("Движок недоступен дольше 2 минут — задача продолжает выполняться локально, проверьте соединение и вернитесь на вкладку");
    }
    await delayWithWake(document.hidden ? 8000 : 2000);
  }
}

async function runEngineTask<T>(opts: {
  type: EngineTaskType;
  endpoint: string;
  body: unknown;
  label: string;
  onProgress?: (p: EngineProgress) => void;
}): Promise<T> {
  const jobId = await startEngineJob(opts.type, opts.body, opts.label);
  if (!jobId) {
    // Старый движок (≤ 1.0.x) без Job API — классический долгий POST
    return await runTaskWithProgress<T>(
      opts.endpoint,
      opts.body,
      opts.onProgress
    );
  }
  writeActiveJob({
    jobId,
    type: opts.type,
    params: (opts.body ?? {}) as Record<string, unknown>,
    label: opts.label,
    startedAt: Date.now(),
  });
  return await watchEngineJob<T>(jobId, opts.onProgress, opts.type);
}

export type ResumeOutcome =
  | { state: "none" }
  | { state: "offline"; record: ActiveJobRecord }
  | { state: "lost"; record: ActiveJobRecord }
  | { state: "error"; record: ActiveJobRecord; job: EngineJobState }
  | { state: "done"; record: ActiveJobRecord; job: EngineJobState }
  | { state: "running"; record: ActiveJobRecord; job: EngineJobState };

/**
 * Проверяет незавершённую фоновую задачу ЭТОЙ вкладки (по типу) из localStorage.
 * Вызывается при монтировании вкладки — покрывает и переключение
 * вкладок внутри приложения, и перезагрузку/выгрузку страницы браузером.
 * Благодаря раздельным слотам вкладка видит ТОЛЬКО свою задачу:
 * задачи других вкладок не мешают и не затираются.
 */
export async function resumeActiveJob(type: EngineTaskType): Promise<ResumeOutcome> {
  const rec = readActiveJob(type);
  if (!rec) return { state: "none" };
  const f = await getEngineJob(rec.jobId);
  if (f.kind === "offline") return { state: "offline", record: rec };
  if (f.kind === "notfound") return { state: "lost", record: rec };
  const j = f.job;
  if (j.status === "done") return { state: "done", record: rec, job: j };
  if (j.status === "error" || j.status === "cancelled")
    return { state: "error", record: rec, job: j };
  return { state: "running", record: rec, job: j };
}

/**
 * То же, что resumeActiveJob, но при «offline» делает несколько попыток
 * с паузой: движок мог ещё проснуться (macOS sleep/wake, запуск после
 * перезагрузки, Safari Local Network prompt). Слот НЕ чистится —
 * при следующем возврате на вкладку попытка повторится.
 */
export async function resumeActiveJobWithRetry(
  type: EngineTaskType,
  retries: number = 3,
  delayMs: number = 2500
): Promise<ResumeOutcome> {
  let out = await resumeActiveJob(type);
  for (let i = 0; i < retries && out.state === "offline"; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    out = await resumeActiveJob(type);
  }
  return out;
}

/**
 * Следит за фоновой задачей до завершения (после resumeActiveJob('running')).
 */
export async function watchJobToCompletion<T>(
  jobId: string,
  onProgress?: (p: EngineProgress) => void,
  type?: EngineTaskType
): Promise<T> {
  return watchEngineJob<T>(jobId, onProgress, type);
}

/**
 * Отменяет задачу своей вкладки (по типу): Job API, а для старых движков — legacy /api/stop.
 */
export async function cancelActiveJob(type: EngineTaskType): Promise<void> {
  const rec = readActiveJob(type);
  if (rec) {
    try {
      await fetch(
        `${ENGINE_URL}/api/jobs/${encodeURIComponent(rec.jobId)}/cancel`,
        { method: "POST" }
      );
      clearActiveJob(type);
      return;
    } catch {
      /* движок недоступен — пробуем legacy */
    }
  }
  await stopEngineTask();
}

/**
 * Полный URL файла на движке по относительному пути из ответа задачи.
 * Полезен для прямого скачивания браузером (минуя fetch).
 */
export function engineFileUrl(relPath: string): string {
  return relPath.startsWith("http") ? relPath : `${ENGINE_URL}${relPath}`;
}

/**
 * Скачать готовый файл с движка по относительному пути из ответа задачи.
 * @param relPath относительный путь (например "/api/download?file=/path/to/file.srt")
 */
export async function fetchEngineFile(relPath: string): Promise<Blob> {
  const resp = await fetch(engineFileUrl(relPath));
  if (!resp.ok) throw new Error(`Не удалось скачать файл: HTTP ${resp.status}`);
  return await resp.blob();
}

/**
 * Скачать готовый файл с движка и сохранить локально.
 * Основной путь — fetch+blob (сохраняет точное имя файла).
 * Если fetch не удался (файл удалён, блокировка fetch, движок перезапускался) —
 * автоматически пробуем прямую навигацию: браузер скачает сам по
 * Content-Disposition (движок ≥ 1.2.1 отдаёт корректные имена с кириллицей).
 * Бросает ошибку в любом случае — вкладка обязана показать её пользователю,
 * а не молчать (исторический баг: кнопка «Скачать» выглядела мёртвой).
 */
export async function downloadEngineFile(relPath: string, fallbackName: string): Promise<void> {
  try {
    const blob = await fetchEngineFile(relPath);
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
  } catch (fetchErr) {
    // Фолбэк: открываем URL файла в НОВОЙ вкладке — браузер скачает сам
    // по Content-Disposition (движок ≥ 1.2.1 даёт корректное имя даже с кириллицей).
    // ВАЖНО: именно новая вкладка — при недоступном движке same-tab навигация
    // уводит всё приложение на страницу «ERR_CONNECTION_REFUSED».
    try {
      window.open(engineFileUrl(relPath), "_blank", "noopener");
    } catch {
      /* открытие не удалось — покажем исходную ошибку */
    }
    throw fetchErr;
  }
}

// ═══════════════ Пакетная обработка (несколько задач подряд/в очереди) ═══════════════
// Пакетные задачи НЕ пишутся в слоты активных задач вкладок (transcrypt.activeJobs),
// а живут в собственном журнале transcrypt.batchJobs — так они не мешают
// одиночным задачам ни на одной вкладке и восстанавливаются при возврате.

export type BatchJobInfo = {
  status: "queued" | "running" | "done" | "error" | "cancelled";
  percent: number;
  stage: string;
  queuePosition?: number;
  result?: unknown;
  error?: string;
};

/** Создать пакетную задачу на движке (возвращает job_id или null, если движок без Job API). */
export async function startBatchJob(
  type: EngineTaskType,
  params: Record<string, unknown>,
  label: string
): Promise<string | null> {
  return await startEngineJob(type, params, label);
}

/** Однократный опрос состояния задачи по id (для пакетного списка). */
export async function getBatchJobInfo(jobId: string): Promise<BatchJobInfo | null> {
  const f = await getEngineJob(jobId);
  if (f.kind !== "ok") return null;
  const j = f.job;
  const jp = j.progress || {};
  return {
    status: j.status,
    percent: typeof jp.percent === "number" ? jp.percent : j.status === "done" ? 100 : 0,
    stage: jp.stage ?? "",
    queuePosition:
      j.status === "queued" && typeof j.queue_position === "number" ? j.queue_position : undefined,
    result: j.result,
    error: j.error ?? undefined,
  };
}

/** Отмена задачи по id (пакетные задачи не имеют слота — отменяем напрямую). */
export async function cancelJobById(jobId: string): Promise<void> {
  try {
    await fetch(`${ENGINE_URL}/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
    });
  } catch {
    /* движок недоступен — статус обновится при следующем опросе */
  }
}

/* ─── Очистка файлов задач на диске движка (движок ≥ 1.3.9) ──────────────── */
/* Файлы задач копятся в web_output движка бесконечно: транскрипты, субтитры,
   скачанные видео, конвертированные копии. Крестики «скрыть восстановленный
   результат» и «удалить из списка» теперь подчищают их через /api/files/delete. */

export type EngineJobListEntry = {
  job_id?: string;
  id?: string;
  type?: string;
  status?: string;
};

/** Список задач из журнала движка (null — движок недоступен или старый). */
export async function listEngineJobs(): Promise<EngineJobListEntry[] | null> {
  try {
    const resp = await fetch(`${ENGINE_URL}/api/jobs`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data?.jobs) ? (data.jobs as EngineJobListEntry[]) : null;
  } catch {
    return null;
  }
}

/**
 * Удалить файлы задач с диска движка (принимает и абсолютные пути, и ссылки
 * «/api/download?file=…»). Возвращает число удалённых файлов; null — движок
 * недоступен или старше 1.3.9 (эндпоинта ещё нет — это не ошибка).
 */
export async function deleteEngineFiles(payload: {
  paths?: string[];
  job_ids?: string[];
}): Promise<number | null> {
  try {
    const resp = await fetch(`${ENGINE_URL}/api/files/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return typeof data?.deleted === "number" ? data.deleted : 0;
  } catch {
    return null;
  }
}

/** Путь файла на диске движка из ссылки «/api/download?file=/path/to/file». */
export function enginePathFromUrl(ref: string): string | null {
  if (!ref) return null;
  try {
    const u = new URL(ref.startsWith("http") ? ref : `http://x${ref}`);
    const fp = u.searchParams.get("file");
    return fp ? decodeURIComponent(fp) : null;
  } catch {
    return null;
  }
}

/**
 * Очистить файлы вкладки на диске движка: берём все задачи данного типа из
 * журнала движка и удаляем их файлы, КРОМЕ задач, чьи id ещё живут в журналах
 * очередей (localStorage) — по этим записям список всё ещё умеет скачивать
 * результаты. Возвращает число удалённых файлов (null — движок недоступен).
 */
export async function purgeTabEngineFiles(
  type: EngineTaskType,
  keepJournalKeys: string[]
): Promise<number | null> {
  const keep = new Set<string>();
  for (const key of keepJournalKeys) {
    try {
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (it && typeof it.jobId === "string" && it.jobId) keep.add(it.jobId);
        }
      }
    } catch {
      /* ignore */
    }
  }
  const jobs = await listEngineJobs();
  if (!jobs) return null;
  const ids = jobs
    .filter((j) => (j.type || "") === type)
    .map((j) => String(j.job_id || j.id || ""))
    .filter((id) => id && !keep.has(id));
  if (!ids.length) return 0;
  return await deleteEngineFiles({ job_ids: ids });
}

/** Собрать из записей очереди пути+jobId для точечного удаления (строка удалена). */
export function collectQueueFilesForDelete(items: { jobId?: string; result?: any }[]): {
  paths: string[];
  job_ids: string[];
} {
  const paths: string[] = [];
  const job_ids: string[] = [];
  for (const it of items) {
    if (it?.jobId) job_ids.push(it.jobId);
    const r = it?.result || {};
    const refs: unknown[] = [r.file, r.media_file, ...(r.files ? Object.values(r.files) : [])];
    for (const ref of refs) {
      if (typeof ref !== "string" || !ref) continue;
      const p = enginePathFromUrl(ref);
      if (p && !paths.includes(p)) paths.push(p);
    }
  }
  return { paths, job_ids };
}

/* ─── Обновление yt-dlp из интерфейса (движок ≥ 1.3.6) ─────────────────── */

export type YtDlpUpdateResult = {
  ok: boolean;
  upgraded: boolean; // pip установил новую версию
  oldVersion: string;
  newVersion: string;
  restarting: boolean; // движок перезапускается сам — новый yt-dlp подхватится
  message: string; // текст ошибки, если ok === false
};

/**
 * Принудительное обновление yt-dlp в окружении движка (кнопка в Настройках).
 * pip может качать пакет до минуты — таймаут 5 минут (движок рвёт pip на 300 c).
 */
export async function updateEngineYtDlp(): Promise<YtDlpUpdateResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000);
    const resp = await fetch(`${ENGINE_URL}/api/engine/update-ytdlp`, {
      method: "POST",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = (await resp.json()) as Record<string, unknown>;
    if (!resp.ok || data.status !== "ok") {
      return {
        ok: false,
        upgraded: false,
        oldVersion: "",
        newVersion: "",
        restarting: false,
        message: String(data.message || `HTTP ${resp.status}`),
      };
    }
    return {
      ok: true,
      upgraded: !!data.upgraded,
      oldVersion: String(data.old_version || ""),
      newVersion: String(data.new_version || ""),
      restarting: !!data.restarting,
      message: "",
    };
  } catch (e) {
    return {
      ok: false,
      upgraded: false,
      oldVersion: "",
      newVersion: "",
      restarting: false,
      message: e instanceof Error && e.name === "AbortError"
        ? "Обновление не уложилось в 5 минут — проверьте интернет и попробуйте ещё раз."
        : "Движок недоступен — обновление невозможно.",
    };
  }
}

/** Последняя версия yt-dlp на PyPI (для бейджа «доступно обновление»).
 *  PyPI JSON API отдаёт CORS-заголовок, запрос идёт прямо из браузера.
 *  Возвращает null при любой ошибке — кнопка обновления работает и без этого. */
export async function fetchLatestYtDlpVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch("https://pypi.org/pypi/yt-dlp/json", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { info?: { version?: string } };
    const v = data.info?.version?.trim();
    return v || null;
  } catch {
    return null;
  }
}

/** Сравнение версий yt-dlp формата YYYY.MM.DD[.N]: -1/0/1. */
export function compareYtDlpVersions(a: string, b: string): number {
  const pa = (a || "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = (b || "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
