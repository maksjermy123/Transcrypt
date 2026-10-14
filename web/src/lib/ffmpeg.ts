"use client";

/**
 * ffmpeg.wasm — версия ffmpeg, скомпилированная в WebAssembly.
 * Грузится с CDN (unpkg) один раз, кешируется браузером.
 * Базовый wasm-бинарник ~25 МБ, расширенный (с кодеками) ~30 МБ.
 *
 * Используется для:
 *  - медиа-конвертации (mp4↔mp3, wav↔mp3, etc.)
 *  - извлечения аудиодорожки из видео
 *  - очистки аудио (шумоподавление, нормализация)
 *  - вшивания субтитров в видео (hardsub)
 */

import type { WhisperModelId } from "./onboarding-store";

let ffmpegInstance: any = null;
let ffmpegPromise: Promise<any> | null = null;

const FFMPEG_VERSION = "0.12.15";        // @ffmpeg/ffmpeg
const FFMPEG_UTIL_VERSION = "0.12.2";    // @ffmpeg/util (последняя версия, 0.12.15 НЕ существует)
const FFMPEG_CORE_VERSION = "0.12.10";   // @ffmpeg/core
const FFMPEG_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

/**
 * Инициализирует ffmpeg.wasm. Возвращает инстанс.
 * Многократные вызовы возвращают один и тот же инстанс.
 */
export async function getFFmpeg(): Promise<any> {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegPromise) return ffmpegPromise;

  ffmpegPromise = (async () => {
    // Динамический import — от статического анализатора bundler'а
    const ffmpegUrl = `https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/umd/ffmpeg.js`;
    const utilUrl = `https://unpkg.com/@ffmpeg/util@${FFMPEG_UTIL_VERSION}/dist/umd/index.js`;

    const dynamicImport = new Function("u", "return import(u)") as (u: string) => Promise<any>;

    const ffmpegMod = await dynamicImport(ffmpegUrl);
    const utilMod = await dynamicImport(utilUrl);
    void utilMod; // util сейчас не используется напрямую, но модуль должен быть загружен для ffmpeg

    const ffmpeg = new ffmpegMod.FFmpeg();
    await ffmpeg.load({
      coreURL: `${FFMPEG_BASE}/ffmpeg-core.js`,
      wasmURL: `${FFMPEG_BASE}/ffmpeg-core.wasm`,
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
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
