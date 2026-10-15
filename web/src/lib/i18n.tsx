"use client";

/**
 * Переключатель языка всего сайта (RU / EN).
 *
 * Принцип: ключ словаря — исходная русская строка. Для русского языка t()
 * возвращает сам ключ (ничего не меняется), для английского — перевод из
 * словаря EN, а если перевода нет — русскую строку (плавная деградация:
 * непереведённый фрагмент остаётся русским вместо краха).
 *
 * Состояние — внешний стор через useSyncExternalStore (тот же паттерн, что
 * для гидратации в page.tsx): SSR отдаёт "ru", после гидратации применяется
 * сохранённый выбор. Переключение мгновенно перерисовывает все подписчики.
 */

import { useSyncExternalStore } from "react";

export type Lang = "ru" | "en";

const LANG_KEY = "vpai-lang";

/** Английские переводы. Ключ = точная русская строка из интерфейса. */
export const EN: Record<string, string> = {
  // ─── Бренд / общие ───
  "Загрузка VoxPaperAi…": "Loading VoxPaperAi…",
  "Движок online": "Engine online",
  "Только браузер — нажмите чтобы установить движок": "Browser only — click to install the engine",
  "Только браузер": "Browser only",
  "Локальный Python-движок запущен — все функции доступны, включая URL-задачи с YouTube":
    "Local Python engine is running — all features available, including YouTube URL jobs",
  "Локальный движок не найден. Нажмите чтобы установить.": "Local engine not found. Click to install.",
  "Вся обработка идёт на вашем компьютере: аудио не загружается на серверы, записи не покидают устройство. Работает даже без интернета.":
    "Everything is processed on your computer: audio is never uploaded to servers, recordings never leave the device. Works even offline.",
  "100% локально": "100% local",
  "В начало / пройти онбординг заново": "Home / redo onboarding",
  "Хотите URL-задачи с YouTube/TikTok и быструю транскрипцию длинных файлов?":
    "Want YouTube/TikTok URL jobs and fast transcription of long files?",
  "Установите локальный движок — он работает в 5-10 раз быстрее и не зависает на длинных аудио.":
    "Install the local engine — it is 5-10x faster and never stalls on long audio.",
  "Установить движок": "Install engine",

  // ─── Вкладки ───
  "Транскрипция": "Transcription",
  "Whisper превратит голос в текст с таймкодами": "Whisper turns speech into timed text",
  "Медиа": "Media",
  "Скачать видео/аудио, очистить аудио, вшить субтитры": "Download video/audio, clean audio, burn subtitles",
  "Конвертер": "Converter",
  "Медиа через ffmpeg, изображения, документы": "Media via ffmpeg, images, documents",
  "Перевод": "Translate",
  "Текст и файлы TXT/DOCX/PDF, включая LAYOUT с разметкой": "Text and TXT/DOCX/PDF files, including LAYOUT",
  "Настройки": "Settings",
  "Железо, движок, модели Whisper, переводчик": "Hardware, engine, Whisper models, translator",
  "О программе": "About",
  "Возможности, архитектура и ограничения": "Features, architecture and limitations",

  // ─── Футер ───
  "работает локально на вашем компьютере": "runs locally on your computer",
  "Локальный движок online": "Local engine online",
  "Только браузерный режим": "Browser mode only",
  "Сбросить настройки": "Reset settings",
  "Выразить благодарность": "Say thank you",
  "Присоединиться к сообществу": "Join the community",
  "Посмотреть другой продукт (для админов Телеграм-каналов)": "Check out another product (for Telegram channel admins)",

  // ─── Онбординг: шаги ───
  "Что умеет": "Features",
  "Режим": "Mode",
  "Согласие": "Consent",
  "Ресурсы ПК": "Your PC",
  "Движок": "Engine",
  "Модель": "Model",
  "Загрузка": "Download",
  "Готово": "Done",
  "Назад": "Back",
  "Назад к": "Back to",
  "В начало онбординга": "Back to onboarding start",

  // ─── Конвертер ───
  "Конвертер | Медиа (через локальный ffmpeg, если движок запущен — иначе ffmpeg.wasm), изображения (Canvas), документы Word ↔ PDF ↔ TXT.":
    "Converter | Media (via local ffmpeg when the engine runs, otherwise ffmpeg.wasm), images (Canvas), Word ↔ PDF ↔ TXT documents.",
  "Изображения": "Images",
  "Документы": "Documents",
  "В формат": "Target format",
  "Сконвертировать": "Convert",
  "Конвертация…": "Converting…",
  "Скачать": "Download",
  "Отменить": "Cancel",
  "Скрыть": "Hide",
  "Формат": "Format",
  "Битрейт MP3: {n} kbps": "MP3 bitrate: {n} kbps",
  "🟢 Документы конвертируются на вашем компьютере (движок) — Word ↔ PDF ↔ TXT, никуда не отправляются":
    "🟢 Documents are converted on your computer (engine) — Word ↔ PDF ↔ TXT, nothing is uploaded",
  "🟡 Движок не запущен: Word/PDF недоступны, текстовые форматы (TXT/MD/CSV/JSON) конвертируются в браузере":
    "🟡 Engine not running: Word/PDF unavailable, text formats (TXT/MD/CSV/JSON) convert in the browser",
  "🟢 Через локальный движок (нативный ffmpeg) — быстрее, больше форматов":
    "🟢 Via local engine (native ffmpeg) — faster, more formats",
  "🟡 Через ffmpeg.wasm в браузере — медленнее, но без установки":
    "🟡 Via ffmpeg.wasm in the browser — slower, but no install needed",
  "Загрузите документ": "Drop a document here",
  "Word (DOCX/DOC), PDF, TXT, RTF, ODT, MD, CSV — конвертация локально на вашем компьютере":
    "Word (DOCX/DOC), PDF, TXT, RTF, ODT, MD, CSV — converted locally on your computer",
  "Предпросмотр ({enc})": "Preview ({enc})",
  "бинарный формат (конвертация на движке)": "binary format (converted by the engine)",
  "Готово — файл ждёт на диске движка": "Done — the file is waiting on the engine's disk",
  "Восстановлен последний готовый файл{when}.": "Last finished file restored{when}.",
  "Фоновая конвертация завершилась, пока вас не было — файл готов.": "Background conversion finished while you were away — the file is ready.",
  "Задача стоит в очереди — движок выполняет другую задачу. Она начнётся автоматически: ничего не пропадёт.":
    "The job is queued — the engine is busy with another task. It will start automatically: nothing is lost.",
  "Задача на движке: вкладку можно переключить или закрыть — файл дождётся вас здесь.":
    "The job runs on the engine: you can switch or close this tab — the file will wait for you here.",
  "Задача отменена.": "Job cancelled.",
  "Скачивание не удалось": "Download failed",
  "Открыть файл напрямую": "Open the file directly",
  ".txt — текст (исправит кодировку на UTF-8)": ".txt — text (fixes encoding to UTF-8)",
  ".docx — Word": ".docx — Word",
  ".pdf — PDF": ".pdf — PDF",
  ".txt — текст (UTF-8)": ".txt — text (UTF-8)",
  ".rtf — Rich Text": ".rtf — Rich Text",
  ".odt — OpenDocument": ".odt — OpenDocument",
  ".md — Markdown": ".md — Markdown",
  ".csv — как есть": ".csv — as is",
  ".json — форматированный JSON": ".json — pretty-printed JSON",
  "Копировать": "Copy",
  "Скопировано": "Copied",
  "Скрыть инструкцию": "Hide instructions",
  "Как обновить": "How to update",

  // ─── Перевод ───
  "1. Перевод текста": "1. Translate text",
  "2. Перевод файлов (TXT / DOCX / PDF)": "2. Translate files (TXT / DOCX / PDF)",
  "Добавить файл(ы)": "Add file(s)",
  "или перетащите файлы сюда": "or drag & drop files here",
  "Очистить список": "Clear list",
  "Файлы обрабатываются локально в браузере, в сеть уходит только текст для перевода":
    "Files are processed locally in the browser; only the text is sent for translation",
  "Перевести": "Translate",
  "Переводим файлы… {p}%": "Translating files… {p}%",
  "Перевод…": "Translating…",
  "PDF режим:": "PDF mode:",
  "Убрать файл": "Remove file",
  "Язык перевода этого файла": "Target language for this file",
  "Формат сохранения": "Save format",

  // ─── Пакетная обработка ───
  "Пакетная обработка": "Batch processing",
  "Развернуть ▼": "Expand ▼",
  "Свернуть ▲": "Collapse ▲",

  // ─── Онбординг: приветствие / выбор / согласие / ресурсы / движок / модель / готово ───
  "Привет! Это": "Hi! This is",
  "Локальный инструмент для транскрипции, субтитров и перевода. Whisper работает прямо в браузере, использует ресурсы вашего компьютера и ничего не отправляет в интернет.":
    "A local tool for transcription, subtitles and translation. Whisper runs right in your browser, uses your computer's resources and never sends anything online.",
  "Транскрипция аудио и видео": "Audio & video transcription",
  "Whisper превращает голос в текст прямо в браузере. Локальные файлы и URL (YouTube, TikTok, Instagram). С таймкодами, без отправки файлов на сервер.":
    "Whisper turns speech into text right in the browser. Local files and URLs (YouTube, TikTok, Instagram). With timestamps, files never leave your device.",
  "Готовые субтитры": "Ready-made subtitles",
  "Экспорт в SRT, VTT и TXT — для видео, блогов, лекций и подкастов.":
    "Export to SRT, VTT and TXT — for video, blogs, lectures and podcasts.",
  "Медиа-операции": "Media operations",
  "Скачать видео/аудио, очистить звук от шума, вшить субтитры (hardsub) — всё прямо в браузере через ffmpeg.wasm.":
    "Download video/audio, clean up noise, burn in subtitles (hardsub) — all in the browser via ffmpeg.wasm.",
  "Ресурсы вашего ПК": "Your PC's resources",
  "Распознавание идёт на CPU/GPU вашего компьютера. Приватно: файлы не покидают браузер.":
    "Recognition runs on your computer's CPU/GPU. Private: files never leave the browser.",
  "Без установки и без архивов": "No installs, no archives",
  "Ничего не нужно скачивать и распаковывать. Модель кешируется один раз и живёт в IndexedDB браузера.":
    "Nothing to download or unpack. The model is cached once and lives in the browser's IndexedDB.",
  "Бесплатно и навсегда": "Free forever",
  "GitHub Pages + Whisper в браузере. Никаких подписок, лимитов и платных API.":
    "GitHub Pages + Whisper in the browser. No subscriptions, no limits, no paid APIs.",
  "Продолжить →": "Continue →",
  "Настройка займёт ~3 минуты. Модель скачается один раз и останется в кеше браузера.":
    "Setup takes ~3 minutes. The model downloads once and stays in the browser cache.",
  "Выберите режим работы": "Choose how to work",
  "VoxPaperAi можно использовать двумя способами. Выберите подходящий — сменить режим можно в любой момент в настройках.":
    "VoxPaperAi works in two modes. Pick the one that fits — you can switch anytime in Settings.",
  "Без установки": "No installation",
  "Whisper работает прямо в браузере через WebAssembly. Подходит для коротких локальных файлов, не требует установки Python.":
    "Whisper runs right in your browser via WebAssembly. Good for short local files, no Python installation required.",
  "Продолжить без установки": "Continue without installing",
  "С локальным движком": "With the local engine",
  "Полный функционал": "Full feature set",
  "Установка локального Python-движка (~800 МБ). Доступны URL-задачи (YouTube, TikTok), скачивание, очистка аудио, hardsub, нативный Whisper (в 5+ раз быстрее).":
    "Installs a local Python engine (~800 MB). Unlocks URL jobs (YouTube, TikTok), downloads, audio cleanup, hardsub and native Whisper (5x+ faster).",
  "Установить движок →": "Install engine →",
  "Подробное сравнение": "Detailed comparison",
  "Функция": "Feature",
  "С движком": "With engine",
  "В любом режиме ваши файлы не покидают устройство. Подробнее —": "In either mode your files never leave the device. Details:",
  "Политика конфиденциальности": "Privacy policy",
  "Рекомендуется": "Recommended",
  "Транскрипция коротких локальных файлов (до 200 МБ)": "Transcribe short local files (up to 200 MB)",
  "Транскрипция длинных файлов (1+ час)": "Transcribe long files (1+ hour)",
  "Транскрипция по URL (YouTube, TikTok, Instagram)": "URL transcription (YouTube, TikTok, Instagram)",
  "Скачивание видео с YouTube/TikTok": "Download video from YouTube/TikTok",
  "Скачивание аудио (MP3 192k)": "Download audio (MP3 192k)",
  "Очистка аудио от шума": "Audio noise cleanup",
  "Вшивание субтитров (hardsub)": "Burn-in subtitles (hardsub)",
  "Конвертация медиа (mp4↔mp3, wav, ogg)": "Media conversion (mp4↔mp3, wav, ogg)",
  "Конвертация изображений (PNG/JPEG/WebP)": "Image conversion (PNG/JPEG/WebP)",
  "Конвертация текстовых файлов": "Text file conversion",
  "Приватность": "Privacy",
  "Установка": "Installation",
  "Скорость распознавания": "Recognition speed",
  "Медленно": "Slow",
  "Быстро (нативный Whisper)": "Fast (native Whisper)",
  "Через ffmpeg.wasm (медленно)": "Via ffmpeg.wasm (slow)",
  "Через нативный ffmpeg (быстро)": "Via native ffmpeg (fast)",
  "Файлы не покидают браузер": "Files never leave the browser",
  "Файлы не покидают ваш компьютер": "Files never leave your computer",
  "Не нужна (Whisper в браузере)": "Not needed (Whisper in the browser)",
  "~800 МБ на диске + автозапуск": "~800 MB on disk + autostart",
  "Средняя (WASM)": "Average (WASM)",
  "Высокая (нативный Whisper)": "High (native Whisper)",
  "Внимание: ресурсы и ответственность": "Heads-up: resources and responsibility",
  "Ресурсы вашего компьютера": "Your computer's resources",
  "Выберите уровень Whisper": "Choose a Whisper level",
  "Установить браузерный движок": "Install the browser engine",
  "Браузерный движок (Whisper)": "Browser engine (Whisper)",
  "Браузерный движок готов": "Browser engine is ready",
  "Загрузка модели Whisper": "Whisper model download",
  "Модель готова к работе": "Model is ready",
  "Модель загружена и готова к работе": "Model downloaded and ready",
  "Готово! Всё настроено": "Done! Everything is set up",
  "Локальный движок установлен на компьютере. Уровень": "The local engine is installed on your computer. Level",
  "движок загрузит сам при первой задаче — вручную ничего скачивать не нужно. Теперь страница готова к работе — каждый раз при открытии движок будет подтягиваться автоматически.":
    "will be downloaded by the engine on the first job — nothing to fetch manually. The page is ready — every time you open it, the engine connects automatically.",
  "загружена и кеширована. Теперь страница готова к работе — каждый раз при открытии движок будет подтягиваться автоматически.":
    "downloaded and cached. The page is ready — every time you open it, the engine connects automatically.",
  "Добавьте страницу в закладки": "Bookmark this page",
  "Так VoxPaperAi всегда будет под рукой — достаточно открыть закладку, и движок сам подтянется из кеша браузера.":
    "This way VoxPaperAi is always at hand — open the bookmark and the engine connects from the browser cache.",
  "Закладка добавлена ✓": "Bookmark added ✓",
  "Что произойдёт при следующем открытии:": "What happens on your next visit:",
  "Движок стартует сам вместе с системой — автозапуск уже настроен установщиком":
    "The engine starts with the system — autostart was configured by the installer",
  "Страница сама обнаружит его на 127.0.0.1:8765 — индикатор в шапке станет зелёным":
    "The page will find it at 127.0.0.1:8765 — the header indicator turns green",
  "Выбранный уровень Whisper и настройки сохранены в браузере": "Your Whisper level and settings are saved in the browser",
  "Вы сразу можете начать работать — без настройки": "You can start working right away — no setup",
  "Браузер открывает страницу из кеша (даже без интернета)": "The browser opens the page from cache (even offline)",
  "Движок transformers.js автоматически инициализируется из IndexedDB": "The transformers.js engine initializes from IndexedDB automatically",
  "Модель Whisper берётся из кеша — повторной загрузки не будет": "The Whisper model comes from cache — no re-download",
  "Открыть рабочую страницу": "Open the workspace",
  "Данные браузера очищены. Страница перезагрузится — вы увидите приветственный гайд.":
    "Browser data cleared. The page will reload — you will see the welcome guide.",

  // ─── Прогресс/статусы задач ───
  "Загружаем WASM-рантайм transformers.js…": "Loading the transformers.js WASM runtime…",
  "Загружаем ffmpeg.wasm…": "Loading ffmpeg.wasm…",
  "Загружаем субтитры на движок…": "Fetching subtitles on the engine…",
  "Загружаем файл на движок…": "Uploading the file to the engine…",
  "Загрузка файлов модели…": "Downloading model files…",
  "Запуск обработки на движке…": "Starting processing on the engine…",
  "Запускаем задачу на движке…": "Starting the job on the engine…",
  "Конвертация на движке…": "Converting on the engine…",
  "Конвертация через ffmpeg.wasm…": "Converting via ffmpeg.wasm…",
  "Локальный движок: запускаем задачу…": "Local engine: starting the job…",
  "Переподключение к фоновой задаче…": "Reconnecting to the background job…",
  "Отменяем задачу…": "Cancelling the job…",
  "Подготовка…": "Preparing…",
  "Подгружаем Whisper из кеша…": "Loading Whisper from cache…",
  "Распознавание речи…": "Recognizing speech…",
  "Читаем файл…": "Reading the file…",

  // ─── Вкладки ───
  "Медиа операции": "Media operations",
  "Сегменты с таймкодами": "Segments with timestamps",
  "Сброс": "Reset",
  "Несколько ссылок или файлов — очередь задач движка": "Multiple links or files — engine job queue",

  // ─── Тема / режимы транскрипции ───
  "Включить тёмную тему": "Switch to dark theme",
  "Включить светлую тему": "Switch to light theme",
  "Файл с компьютера": "File from computer",
  "URL (YouTube и др.)": "URL (YouTube etc.)",
  "URL (нужен движок)": "URL (engine required)",
  "Перетащите аудио или видео сюда": "Drop audio or video here",
  "или нажмите, чтобы выбрать файл": "or click to choose a file",
  "Добавить в закладки": "Add to bookmarks",
};

// Поддержка плейсхолдеров: t2("Битрейт MP3: {n} kbps", {n: 192})
export function formatTemplate(tpl: string, params: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

let currentLang: Lang = "ru";
let initialized = false;
const listeners = new Set<() => void>();

function detectInitialLang(): Lang {
  if (initialized || typeof window === "undefined") return currentLang;
  initialized = true;
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "en" || stored === "ru") currentLang = stored;
  } catch {
    /* ignore */
  }
  return currentLang;
}

export function getLang(): Lang {
  detectInitialLang();
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  initialized = true;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang === "ru" ? "ru" : "en";
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Перевод строки. Для ru — ключ как есть; для en — словарь с фолбэком на ключ.
 * Плейсхолдеры {name} подставляются из params.
 */
export function translate(key: string, params?: Record<string, string | number>): string {
  const lang = getLang();
  let out = key;
  if (lang === "en") out = EN[key] ?? key;
  if (params) out = formatTemplate(out, params);
  return out;
}

/** Реактивный хук: перерисовывает компонент при переключении языка. */
export function useI18n(): { lang: Lang; t: typeof translate } {
  const lang = useSyncExternalStore(
    subscribe,
    getLang,
    () => "ru" as Lang // серверный снапшот — совпадает с первым клиентским кадром
  );
  return { lang, t: translate };
}
