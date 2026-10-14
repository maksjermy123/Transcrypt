"use client";

/**
 * ffmpeg.wasm — версия ffmpeg, скомпилированная в WebAssembly.
 * Используется для:
 *  - медиа-конвертации в «Конвертере» (когда локальный движок не запущен)
 *  - извлечения аудиодорожки из видео
 *  - очистки аудио (шумоподавление, нормализация)
 *  - вшивания субтитров в видео (hardsub)
 *
 * ─── Как грузится (важно, здесь легко сломать) ───
 * 1. Лёгкие UMD-обёртки @ffmpeg/ffmpeg (ffmpeg.js + воркер-чанк 814.ffmpeg.js,
 *    суммарно ~8 КБ) САМОХОСТЯТСЯ из /public/ffmpeg/ и грузятся обычным
 *    <script> тегом. Их НЕЛЬЗЯ загружать через import():
 *      - UMD при ESM-оценке не имеет экспортов (новый ffmpegMod.FFmpeg() падает);
 *      - webpack-runtime внутри вычисляет путь до 814.ffmpeg.js от
 *        document.currentScript.src — при import() он null, воркер 404-ит;
 *      - у @ffmpeg/util UMD-сборка сломана в принципе (ReferenceError:
 *        "exports is not defined" при любой загрузке) — поэтому util не
 *        используется вовсе, а toBlobURL реализован локально.
 * 2. Тяжёлый @ffmpeg/core (~32 МБ js+wasm) берётся с CDN (unpkg, запасной
 *    jsdelivr) и передаётся в load() через blob-URL: fetch с CDN требует CORS
 *    (он там есть), а blob-URL одинаково работает в importScripts воркера.
 * 3. Браузер кеширует core по HTTP (unpkg отдаёт immutable на год), так что
 *    повторные визиты не качают его заново.
 */

import type { WhisperModelId } from "./onboarding-store";

let ffmpegInstance: any = null;
let ffmpegPromise: Promise<any> | null = null;

// UMD-обёртки @ffmpeg/ffmpeg 0.12.15 самохранятся в /public/ffmpeg/
// (ffmpeg.js + воркер-чанк 814.ffmpeg.js)
const CORE_VERSION = "0.12.10"; // @ffmpeg/core с CDN

const CORE_SOURCES = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];

/** Базовый путь приложения (на GitHub Pages — "/Transcrypt", локально — ""). */
function basePath(): string {
  return (process.env.NEXT_PUBLIC_BASE_PATH as string | undefined) || "";
}

/** Загрузка классического <script> (однократно). */
function loadScriptTag(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    document.head.appendChild(s);
  });
}

/** fetch → blob-URL (аналог toBlobURL из @ffmpeg/util, чья UMD-сборка сломана). */
async function toBlobURL(url: string, mime: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} при загрузке ${url}`);
  const blob = new Blob([await resp.arrayBuffer()], { type: mime });
  return URL.createObjectURL(blob);
}

async function ensureUMDScript(): Promise<any> {
  const w = window as any;
  if (w.FFmpegWASM?.FFmpeg) return w.FFmpegWASM.FFmpeg;
  await loadScriptTag(`${basePath()}/ffmpeg/ffmpeg.js`);
  if (!w.FFmpegWASM?.FFmpeg) {
    throw new Error("ffmpeg.js загружен, но глобальный FFmpegWASM не появился");
  }
  return w.FFmpegWASM.FFmpeg;
}

/**
 * Инициализирует ffmpeg.wasm. Возвращает инстанс.
 * Многократные вызовы возвращают один и тот же инстанс.
 */
export async function getFFmpeg(): Promise<any> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegPromise) return ffmpegPromise;

  ffmpegPromise = (async () => {
    const FFmpegCtor = await ensureUMDScript();

    let lastErr: Error | null = null;
    for (const base of CORE_SOURCES) {
      let coreURL = "";
      let wasmURL = "";
      try {
        coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
        wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");

        const ffmpeg = new FFmpegCtor();
        await ffmpeg.load({ coreURL, wasmURL });

        ffmpegInstance = ffmpeg;
        return ffmpeg;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        // Чистим blob-ы неудавшейся попытки и пробуем следующий CDN
        try {
          if (coreURL) URL.revokeObjectURL(coreURL);
          if (wasmURL) URL.revokeObjectURL(wasmURL);
        } catch {
          /* ignore */
        }
      }
    }

    ffmpegPromise = null;
    throw new Error(
      `Не удалось загрузить ffmpeg-core с CDN. Проверьте интернет и попробуйте ещё раз. (${lastErr?.message ?? "нет деталей"})`
    );
  })();

  return ffmpegPromise;
}

/**
 * Конвертация медиафайла в другой формат.
 * @param data Uint8Array с исходным файлом
 * @param inputName имя входного файла (с расширением — ffmpeg определяет кодек по нему)
 * @param outputName имя выходного файла (с расширением)
 * @param extraArgs дополнительные аргументы ffmpeg (например, ["-b:a", "192k"])
 * @param onLog колбэк логов
 */
export async function convertMedia(
  data: Uint8Array,
  inputName: string,
  outputName: string,
  extraArgs: string[] = [],
  onLog?: (msg: string) => void
): Promise<Uint8Array> {
  const ffmpeg = await getFFmpeg();

  if (onLog) {
    ffmpeg.on("log", ({ message }: { message: string }) => onLog(message));
  }

  await ffmpeg.writeFile(inputName, data);

  const args = ["-i", inputName, ...extraArgs, outputName];
  await ffmpeg.exec(args);

  const result = await ffmpeg.readFile(outputName);

  // Чистим виртуальную FS
  try {
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
  } catch {
    /* ignore */
  }

  return result as Uint8Array;
}

/**
 * Извлечение аудиодорожки из медиа-файла (для последующей транскрипции через Whisper).
 * @returns Uint8Array с аудиоданными в формате wav (16kHz, mono, 16-bit — формат, который понимает Whisper)
 */
export async function extractAudioForWhisper(
  data: Uint8Array,
  inputName: string,
  onLog?: (msg: string) => void
): Promise<Uint8Array> {
  // Whisper через transformers.js понимает URL/File — он сам декодирует через AudioContext.
  // Но если формат экзотический (mkv, ogg с непопулярным кодеком) — лучше конвертировать в wav.
  const outputName = "audio_for_whisper.wav";
  return convertMedia(
    data,
    inputName,
    outputName,
    ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"],
    onLog
  );
}

/**
 * Очистка аудио: шумоподавление, нормализация, удаление тихих участков (по желанию).
 * @param data аудиофайл
 * @param inputName с расширением
 * @param outputName с расширением
 * @param mode "denoise" | "normalize" | "both"
 */
export async function cleanAudio(
  data: Uint8Array,
  inputName: string,
  outputName: string,
  mode: "denoise" | "normalize" | "both" = "both",
  onLog?: (msg: string) => void
): Promise<Uint8Array> {
  const filters: string[] = [];
  if (mode === "denoise" || mode === "both") {
    filters.push("afftdn=nr=12"); // Шумоподавление (n=12 — умеренное)
    filters.push("highpass=f=80"); // Срез НЧ (гул)
    filters.push("lowpass=f=12000"); // Срез ВЧ (шипение)
  }
  if (mode === "normalize" || mode === "both") {
    filters.push("loudnorm=I=-16:LRA=11:TP=-1.5"); // EBU R128 нормализация громкости
  }
  const af = filters.join(",");

  return convertMedia(
    data,
    inputName,
    outputName,
    ["-af", af],
    onLog
  );
}

/**
 * Вшивание субтитров в видео (hardsub).
 * @param videoData видеофайл (Uint8Array)
 * @param subtitlesContent содержимое .srt/.vtt файла (string)
 * @param outputName имя выходного файла (с расширением .mp4)
 */
export async function hardsubVideo(
  videoData: Uint8Array,
  subtitlesContent: string,
  videoName: string,
  outputName: string = "hardsubbed.mp4",
  fontSize: number = 24,
  onLog?: (msg: string) => void
): Promise<Uint8Array> {
  const ffmpeg = await getFFmpeg();

  if (onLog) {
    ffmpeg.on("log", ({ message }: { message: string }) => onLog(message));
  }

  await ffmpeg.writeFile(videoName, videoData);

  // Записываем субтитры в виртуальную FS
  const subName = "subs.ass";
  // ffmpeg.wasm может читать .srt/.vtt напрямую, но фильтр subtitles требует абсолютный путь
  // Используем простую .srt-загрузку через filter_complex
  const srtName = "subs.srt";
  await ffmpeg.writeFile(srtName, new TextEncoder().encode(subtitlesContent));

  // Простейший hardsub — фильтр subtitles рендерит субтитры прямо в кадры
  //_force_style позволяет настроить шрифт/размер
  const filter = `subtitles=${srtName}:force_style='FontSize=${fontSize},OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0'`;

  await ffmpeg.exec([
    "-i",
    videoName,
    "-vf",
    filter,
    "-c:a",
    "copy",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    outputName,
  ]);

  const result = await ffmpeg.readFile(outputName);

  try {
    await ffmpeg.deleteFile(videoName);
    await ffmpeg.deleteFile(srtName);
    await ffmpeg.deleteFile(outputName);
    await ffmpeg.deleteFile(subName);
  } catch {
    /* ignore */
  }

  return result as Uint8Array;
}

/**
 * Скачивание Uint8Array как файла.
 */
export function downloadBytes(filename: string, data: Uint8Array, mime = "application/octet-stream") {
  const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Заглушка, чтобы импорт типа не падал
export type { WhisperModelId };
