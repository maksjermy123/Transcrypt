"use client";

import { motion } from "framer-motion";
import {
  Upload,
  FileAudio,
  Loader2,
  Download,
  Play,
  Trash2,
  Mic,
  Settings2,
  Link2,
  Globe,
  Zap,
  ServerOff,
  Server,
  AlertTriangle,
  Languages,
  Copy,
  Check,
  History,
  X,
  Square,
  Search,
  ChevronDown,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOnboarding, MODEL_INFO, browserSafeModel, type WhisperModelId } from "@/lib/onboarding-store";
import { transcribeAudio, loadWhisperPipeline } from "@/lib/whisper";
import { useSettings } from "@/lib/settings-store";
import { translateText, translateBatch } from "@/lib/translate";
import {
  transcribeViaEngine,
  downloadEngineFile,
  fetchEngineFile,
  resumeActiveJob,
  watchJobToCompletion,
  clearActiveJob,
  cancelActiveJob,
  type EngineProgress,
  type TranscribeResult,
} from "@/lib/engine-bridge";
import {
  segmentsToSRT,
  segmentsToVTT,
  segmentsToPlainText,
  segmentsWithStamps,
  segmentsAsQuotes,
  buildMarkdown,
  formatStamp,
  downloadFile,
  formatDuration,
} from "@/lib/subtitles";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useI18n } from "@/lib/i18n";
import { ConspectBridge } from "@/components/workbench/ConspectBridge";
import { BatchPanel, type BatchItem } from "@/components/workbench/BatchPanel";

type Phase = "idle" | "loading-engine" | "running" | "done" | "error";
type Seg = { text: string; timestamp: [number, number | null] };

/** Аудио/видео расширения — для drag&drop, когда браузер не дал MIME-тип (macOS). */
const AV_EXT_RE = /\.(mp3|wav|m4a|m4b|aac|ogg|oga|opus|flac|wma|mp4|m4v|mkv|webm|mov|avi|flv|wmv|ts|3gp)$/i;

/** Оценка скорости Whisper (во сколько раз быстрее реального времени) на CPU: [оптимистично, пессимистично] */
const SPEED_FACTORS: Record<string, [number, number]> = {
  tiny: [12, 7],
  base: [8, 5],
  small: [5, 3],
  medium: [3, 1.8],
  "large-v3": [2, 1.2],
};

/** Языки для выбора источника и цели перевода */
const LANG_OPTIONS: { code: string; label: string }[] = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "uk", label: "Українська" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "pl", label: "Polski" },
  { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

function langLabel(code: string): string {
  return LANG_OPTIONS.find((l) => l.code === code)?.label ?? code;
}

export function TranscribeTab({
  /** Переход к шагу установки движка (из воркбенча) */
  onInstallEngine,
}: {
  onInstallEngine?: () => void;
}) {
  const { t } = useI18n();
  const { selectedModel, setSelectedModel, engineServerOnline, engineServerHealth } = useOnboarding();
  const { provider, deeplKey } = useSettings();
  const [mode, setMode] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | Blob | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<Seg[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [language, setLanguage] = useState("auto");
  // Конечный язык: "-" — без перевода (выдаём оригинал)
  const [targetLang, setTargetLang] = useState("-");
  const [translatedText, setTranslatedText] = useState("");
  const [translatedSegments, setTranslatedSegments] = useState<Seg[]>([]);
  const [translError, setTranslError] = useState<string | null>(null);
  const [segView, setSegView] = useState<"translation" | "original">("translation");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Поиск по транскрипту + подсветка активного сегмента при прослушивании
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [activeSegIdx, setActiveSegIdx] = useState<number | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  // Оценка времени: длительность файла читается из метаданных аудио
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  // Фоновые задачи (Job API): статус поддержки движком + заметка восстановления
  const supportsJobs = !!engineServerHealth?.jobs;
  const supportsQueue = !!engineServerHealth?.queue; // движок ≥ 1.2.0: очереди + параллельные полосы
  const [jobNote, setJobNote] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const clearTranslation = () => {
    setTranslatedText("");
    setTranslatedSegments([]);
    setTranslError(null);
    setSegView("translation");
  };

  const handleFile = useCallback(
    (f: File) => {
      setFile(f);
      setFileName(f.name);
      setFileSize(f.size);
      setText("");
      setSegments([]);
      setError(null);
      clearTranslation();
      setProgress(0);
      setPhase("idle");
      setFileDuration(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(f));
    },
    [audioUrl]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      // macOS иногда отдаёт пустой MIME-тип — доверяем и расширению
      const mime = (f.type || "").toLowerCase();
      if (mime.startsWith("audio/") || mime.startsWith("video/") || AV_EXT_RE.test(f.name)) {
        handleFile(f);
      } else {
        setError(t("Это не похоже на аудио или видео — перетащите файл MP3, WAV, M4A, MP4, MKV, WebM или MOV"));
      }
    },
    [handleFile]
  );

  function isUrl(s: string) {
    try {
      const u = new URL(s.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function detectSource(url: string): { label: string; icon: string } {
    const u = url.toLowerCase();
    if (u.includes("youtube.com") || u.includes("youtu.be")) return { label: "YouTube", icon: "🎬" };
    if (u.includes("tiktok.com")) return { label: "TikTok", icon: "🎵" };
    if (u.includes("instagram.com")) return { label: "Instagram", icon: "📸" };
    return { label: "URL", icon: "🔗" };
  }

  /**
   * Запуск транскрипции.
   *
   * Логика:
   *  - URL + движок online → /api/transcribe (Subtitles-First стратегия на сервере)
   *  - URL + движок offline → ошибка (нельзя YouTube через браузер из-за CORS)
   *  - Локальный файл + движок online → /api/transcribe (использует нативный Whisper, быстрее)
   *  - Локальный файл + движок offline → Whisper в браузере (transformers.js)
   */
  async function run() {
    setError(null);
    setProgress(0);
    setProgressLog([]);
    setText("");
    setSegments([]);
    setJobNote(null);
    cancelledRef.current = false;
    clearTranslation();

    const urlValue = url.trim();
    const useUrl = mode === "url" && urlValue && isUrl(urlValue);

    if (mode === "url" && !urlValue) {
      setError(t("Введите URL видео"));
      return;
    }
    if (mode === "url" && !isUrl(urlValue)) {
      setError(t("Некорректный URL (нужно http:// или https://)"));
      return;
    }
    if (mode === "file" && !file) {
      setError(t("Загрузите файл"));
      return;
    }

    // URL-задача требует локальный движок
    if (useUrl && !engineServerOnline) {
      setError(
        t("URL-задачи (YouTube, TikTok) требуют локальный движок — yt-dlp с impersonate Chrome. Запустите engine_server.py на компьютере и обновите страницу.")
      );
      return;
    }

    setPhase(useUrl ? "running" : "loading-engine");
    setProgressText(useUrl ? t("Запрос к локальному движку…") : t("Подгружаем Whisper из кеша…"));

    try {
      if (engineServerOnline) {
        // ===== Локальный движок: Subtitles-First стратегия для URL, нативный Whisper для файлов =====
        setPhase("running");
        setProgress(5);
        setProgressText(t("Локальный движок: запускаем задачу…"));

        let filePath: string | undefined;
        if (mode === "file" && file) {
          // Загружаем файл на движок
          setProgressText(t("Загружаем файл на движок…"));
          setProgress(15);
          const { uploadFileToEngine } = await import("@/lib/engine-bridge");
          filePath = await uploadFileToEngine(file as File, fileName);
          setProgress(25);
        }

        const result = await transcribeViaEngine(
          {
            url: useUrl ? urlValue : undefined,
            file_path: filePath,
            model: selectedModel ?? "base",
            language,
            translate_to: "-", // перевод выполняется на клиенте после транскрипции
          },
          (p: EngineProgress) => {
            setProgress(p.percent);
            setProgressText(p.stage || "");
            setJobNote((n) =>
              p.stage?.startsWith("В очереди")
                ? t("Задача стоит в очереди — движок выполняет другую задачу. Она начнётся автоматически: ничего не пропадёт, можно спокойно переключать вкладки.")
                : n?.startsWith("Задача стоит в очереди")
                  ? null
                  : n
            );
            if (p.log?.length) {
              setProgressLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
            }
          },
          useUrl ? urlValue : fileName || t("локальный файл")
        );

        await applyEngineResult(result, { label: useUrl ? urlValue : fileName });
        return;
      }

      // ===== Браузерный режим: только локальные файлы =====
      if (!file) {
        setError(t("В браузерном режиме можно распознавать только локальные файлы"));
        return;
      }
      setPhase("loading-engine");
      setProgress(5);
      setProgressText(t("Подгружаем Whisper из кеша…"));

      await loadWhisperPipeline(browserSafeModel(selectedModel));
      setPhase("running");
      setProgress(10);
      setProgressText(t("Распознавание речи…"));
      const result = await transcribeAudio(file, language, (p) => {
        setProgress(10 + Math.round(p * 0.9));
        if (p > 0) setProgressText(t("Распознавание речи… {p}%", { p }));
      });
      const resText = result.text || "";
      const segs: Seg[] = (result.chunks || []).map((c: any) => ({
        text: c.text || "",
        timestamp: [
          Array.isArray(c.timestamp) ? c.timestamp[0] : 0,
          Array.isArray(c.timestamp) ? (c.timestamp[1] ?? null) : null,
        ],
      }));
      setText(resText);
      setSegments(segs);
      setSourceLabel(t("Whisper {m} (браузер)", { m: browserSafeModel(selectedModel) }));

      // Выбран конечный язык — переводим ДО выдачи результата
      const tr = await translateIfNeeded(resText, segs);

      setPhase("done");
      setProgress(100);
      setProgressText(t("Готово"));
      persistLastResult({
        sourceLabel: t("Whisper {m} (браузер)", { m: browserSafeModel(selectedModel) }),
        text: resText,
        segments: segs,
        targetLang,
        translatedText: tr.tText,
        translatedSegments: tr.tSegs,
        translError: tr.err,
      });
    } catch (err: any) {
      if (cancelledRef.current) {
        // Отмена пользователем — состояние уже сброшено cancelRun()
        return;
      }
      console.error(err);
      setError(err?.message ?? t("Ошибка распознавания"));
      setPhase("error");
    }
  }

  /**
   * Перевод результата транскрипции на выбранный конечный язык.
   * Вызывается ДО setPhase("done") — пользователь видит прогресс перевода,
   * и готовый перевод появляется вместе с распознанным текстом.
   * При ошибке перевода оригинал НЕ теряется (показываем предупреждение).
   * Возвращает перевод для сохранения/восстановления результата.
   */
  async function translateIfNeeded(
    origText: string,
    origSegs: Seg[],
    langOverride?: string
  ): Promise<{ tText: string; tSegs: Seg[]; err: string | null }> {
    const lang = langOverride ?? targetLang;
    setTranslatedText("");
    setTranslatedSegments([]);
    setTranslError(null);
    setSegView("translation");
    if (lang === "-") return { tText: "", tSegs: [], err: null };
    if (language !== "auto" && language === lang) return { tText: "", tSegs: [], err: null }; // совпадает с исходным — перевод не нужен
    if (!origText.trim() && !origSegs.length) return { tText: "", tSegs: [], err: null };

    const label = langLabel(lang);
    const opts = {
      targetLang: lang,
      provider,
      apiKey: deeplKey || undefined,
      engineOnline: engineServerOnline,
    };
    setProgressText(t("Переводим на {l}…", { l: label }));
    try {
      if (origSegs.length > 0) {
        // Сегменты переводим построчно батчами — таймкоды сохраняются
        const out = await translateBatch(
          origSegs.map((s) => s.text),
          {
            ...opts,
            onProgress: (pct) => {
              setProgressText(t("Переводим на {l}… {p}%", { l: label, p: pct }));
              setProgress(Math.min(99, pct));
            },
          }
        );
        const tSegs: Seg[] = origSegs.map((s, i) => ({
          text: out[i] ?? s.text,
          timestamp: s.timestamp,
        }));
        const tText = tSegs.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
        setTranslatedSegments(tSegs);
        setTranslatedText(tText);
        return { tText, tSegs, err: null };
      } else {
        const translated = await translateText(origText, {
          ...opts,
          onProgress: (pct, eta) => {
            setProgressText(t("Переводим на {l}… {p}%{eta}", { l: label, p: pct, eta: eta ? " · " + eta : "" }));
            setProgress(Math.min(99, pct));
          },
        });
        setTranslatedText(translated);
        return { tText: translated, tSegs: [], err: null };
      }
    } catch (err: any) {
      console.error("Перевод транскрипции не удался:", err);
      const msg = err?.message ?? t("неизвестная ошибка");
      setTranslError(msg);
      return { tText: "", tSegs: [], err: msg };
    }
  }

  /** Смена конечного языка после готового результата — мягкий повторный перевод */
  async function retranslate(lang: string) {
    if (phase !== "done") return;
    setPhase("running");
    setProgress(30);
    const tr = await translateIfNeeded(text, segments, lang);
    setPhase("done");
    setProgress(100);
    setProgressText(t("Готово"));
    persistLastResult({
      sourceLabel,
      text,
      segments,
      targetLang: lang,
      translatedText: tr.tText,
      translatedSegments: tr.tSegs,
      translError: tr.err,
    });
  }

  /** Сохранение последнего результата — восстановится после перезагрузки страницы */
  function persistLastResult(payload: {
    sourceLabel: string;
    text: string;
    segments: Seg[];
    targetLang: string;
    translatedText: string;
    translatedSegments: Seg[];
    translError: string | null;
  }) {
    try {
      localStorage.setItem(
        "transcrypt.lastTranscribe",
        JSON.stringify({ at: Date.now(), ...payload })
      );
    } catch {
      /* хранилище недоступно */
    }
  }

  /**
   * Единая обработка результата движка: текст + SRT-сегменты + перевод + сохранение.
   * Используется и при обычном запуске, и при восстановлении фоновой задачи.
   */
  async function applyEngineResult(
    result: TranscribeResult,
    opts: { label?: string; targetLangOverride?: string }
  ) {
    if (result.status !== "success") {
      throw new Error(t("Движок вернул ошибку"));
    }
    const resText = result.text || "";
    // Сегментов нет в ответе движка (он отдаёт text + файлы) — скачиваем SRT и парсим
    let resSegs: Seg[] = [];
    if (result.files?.srt) {
      try {
        const blob = await fetchEngineFile(result.files.srt);
        const srtText = await blob.text();
        resSegs = parseSrt(srtText);
      } catch (e) {
        console.warn("Не удалось загрузить SRT:", e);
      }
    }
    const srcLabel = result.source || opts.label || t("Локальный движок");
    setText(resText);
    setSegments(resSegs);
    setSourceLabel(srcLabel);

    // targetLangOverride — чтобы при восстановлении фоновой задачи использовался
    // язык, выбранный ДО перезагрузки страницы (а не устаревший из замыкания)
    const effTarget = opts.targetLangOverride ?? targetLang;
    const tr = await translateIfNeeded(resText, resSegs, effTarget);

    setPhase("done");
    setProgress(100);
    setProgressText(t("Готово"));
    persistLastResult({
      sourceLabel: srcLabel,
      text: resText,
      segments: resSegs,
      targetLang: effTarget,
      translatedText: tr.tText,
      translatedSegments: tr.tSegs,
      translError: tr.err,
    });
  }

  /** Восстановление последнего готового результата (после перезагрузки страницы) */
  function restoreLastResult() {
    try {
      const raw = localStorage.getItem("transcrypt.lastTranscribe");
      if (!raw) return;
      const r = JSON.parse(raw);
      if (!r || (!r.text && !(r.segments?.length))) return;
      setText(r.text || "");
      setSegments(r.segments || []);
      setSourceLabel(r.sourceLabel || "");
      setTargetLang(r.targetLang || "-");
      setTranslatedText(r.translatedText || "");
      setTranslatedSegments(r.translatedSegments || []);
      setTranslError(r.translError || null);
      setSegView("translation");
      setPhase("done");
      setProgress(100);
      setProgressText(t("Готово"));
      const when = r.at ? new Date(r.at).toLocaleString() : "";
      setJobNote(t("Восстановлен последний результат{when}.", { when: when ? t("(от {d})", { d: when }) : "" }));
    } catch {
      /* ignore */
    }
  }

  // ═══ Восстановление фоновой задачи при возврате на вкладку ═══
  // Покрывает: переключение вкладок внутри приложения, уход на другую
  // вкладку браузера, перезагрузку страницы и выгрузку вкладки браузером.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let outcome: Awaited<ReturnType<typeof resumeActiveJob>> | null = null;
      try {
        outcome = await resumeActiveJob("transcribe");
      } catch {
        outcome = null;
      }
      // Сохранённый целевой язык применяем до восстановления результата
      let pref = "-";
      try {
        pref = localStorage.getItem("transcrypt.prefs.targetLang") || "-";
      } catch {
        /* ignore */
      }
      if (!cancelled && pref !== "-") setTargetLang(pref);
      if (cancelled) return;
      if (!outcome || outcome.state === "none" || outcome.state === "offline") {
        restoreLastResult();
        return;
      }
      if (outcome.state === "lost") {
        clearActiveJob("transcribe");
        setJobNote(t("Прошлая фоновая задача не найдена — движок перезапускался без журнала задач."));
        restoreLastResult();
        return;
      }
      if (outcome.state === "error") {
        clearActiveJob("transcribe");
        setError(outcome.job.error || t("Фоновая задача завершилась с ошибкой"));
        setPhase("error");
        return;
      }
      const rec = outcome.record;
      const jp = rec.params as { url?: string };
      if (jp?.url) {
        setUrl(jp.url);
        setMode("url");
      }
      if (outcome.state === "done") {
        clearActiveJob("transcribe"); // результат забрали — слот освобождаем
        setJobNote(t("Фоновая задача завершилась, пока вас не было — вот её результат."));
        try {
          await applyEngineResult(outcome.job.result as TranscribeResult, {
            label: rec.label,
            targetLangOverride: pref,
          });
        } catch (e: any) {
          if (!cancelled) {
            setError(e?.message ?? t("Не удалось показать результат фоновой задачи"));
            setPhase("error");
          }
        }
        return;
      }
      // outcome.state === "running" — переподключаемся к слежению за задачей
      setPhase("running");
      setProgress(1);
      setProgressText(t("Переподключение к фоновой задаче…"));
      setJobNote(t("Задача выполнялась в фоне — снова следим за ней. Пока вас не было, движок продолжал работать."));
      try {
        const result = await watchJobToCompletion<TranscribeResult>(
          rec.jobId,
          (pp: EngineProgress) => {
            setProgress(pp.percent);
            setProgressText(pp.stage || "");
            setJobNote((n) =>
              pp.stage?.startsWith("В очереди")
                ? t("Задача стоит в очереди — движок выполняет другую задачу. Она начнётся автоматически: ничего не пропадёт.")
                : n?.startsWith("Задача стоит в очереди")
                  ? null
                  : n
            );
            if (pp.log?.length) setProgressLog((l) => [...l.slice(-50), ...pp.log.slice(-3)]);
          },
          "transcribe"
        );
        if (cancelled || cancelledRef.current) return;
        await applyEngineResult(result, { label: rec.label, targetLangOverride: pref });
      } catch (e: any) {
        if (cancelled || cancelledRef.current) return;
        setError(e?.message ?? t("Фоновая задача завершилась с ошибкой"));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Предупреждение браузера при закрытии/обновлении страницы во время задачи
  useEffect(() => {
    if (phase !== "running" && phase !== "loading-engine") return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);

  /** Отмена активной задачи (фоновая на движке или legacy) */
  async function cancelRun() {
    cancelledRef.current = true;
    setProgressText(t("Отменяем задачу…"));
    try {
      await cancelActiveJob("transcribe");
    } catch {
      /* ignore */
    }
    setPhase("idle");
    setProgress(0);
    setProgressText("");
    setJobNote(t("Задача отменена."));
  }

  // Что показываем/экспортируем: перевод (по умолчанию) или оригинал
  const showingTranslation =
    (translatedSegments.length > 0 || !!translatedText) && segView === "translation";
  const viewSegments = showingTranslation && translatedSegments.length ? translatedSegments : segments;
  const viewText =
    showingTranslation && translatedText
      ? translatedText
      : text || segmentsToPlainText(segments);
  const exportSuffix = showingTranslation ? `-${targetLang}` : "";

  // Поиск по транскрипту: подсчёт совпадений и фильтрация сегментов
  const searchQ = searchQuery.trim().toLowerCase();
  const matchCount = searchQ
    ? viewSegments.filter((s) => s.text.toLowerCase().includes(searchQ)).length
    : 0;
  const visibleSegments = (searchQ && onlyMatches
    ? viewSegments
        .map((seg, idx) => ({ seg, idx }))
        .filter(({ seg }) => seg.text.toLowerCase().includes(searchQ))
    : viewSegments.map((seg, idx) => ({ seg, idx })));

  function downloadSRT() {
    downloadFile(`transcrypt${exportSuffix}.srt`, segmentsToSRT(viewSegments), "text/plain");
  }
  function downloadVTT() {
    downloadFile(`transcrypt${exportSuffix}.vtt`, segmentsToVTT(viewSegments), "text/plain");
  }
  function downloadTXT() {
    downloadFile(`transcrypt${exportSuffix}.txt`, viewText, "text/plain");
  }
  function downloadMD() {
    downloadFile(
      `transcrypt${exportSuffix}.md`,
      buildMarkdown({
        title: sourceLabel || t("Транскрипт"),
        source: sourceLabel,
        segments: viewSegments,
        text: viewText,
      }),
      "text/markdown"
    );
  }

  /** Клик по таймкоду: плеер файла — перемотка; для YouTube — ссылка с t=; иначе копия метки. */
  function onTimestampClick(sec: number, idx: number) {
    const player = playerRef.current;
    if (player && isFinite(player.duration) && player.duration > 0) {
      player.currentTime = sec;
      void player.play().catch(() => {});
      setActiveSegIdx(idx);
      return;
    }
    const u = url.trim();
    if (u && /youtube\.com|youtu\.be/i.test(u)) {
      const link = u + (u.includes("?") ? "&" : "?") + "t=" + Math.floor(sec) + "s";
      void copyTextToClipboard(link);
      setJobNote(t("Ссылка с таймкодом {t} скопирована — откройте её, чтобы прослушать момент.", { t: formatStamp(sec) }));
    } else {
      void copyTextToClipboard(formatStamp(sec));
      setJobNote(t("Таймкод {t} скопирован.", { t: formatStamp(sec) }));
    }
  }

  /** Открыть результат из пакетной обработки в основном окне результатов. */
  async function openBatchResult(it: BatchItem) {
    if (!it.result) return;
    setText(it.result.text || "");
    setSegments([]);
    clearTranslation();
    setSourceLabel(it.result.source || it.label);
    setJobNote(t("Результат пакетной обработки: {x}", { x: it.label }));
    setPhase("done");
    setProgress(100);
    setProgressText(t("Готово"));
    if (it.result.files?.srt) {
      try {
        const blob = await fetchEngineFile(it.result.files.srt);
        const srtText = await blob.text();
        setSegments(parseSrt(srtText));
      } catch {
        /* текст уже показан — сегменты необязательны */
      }
    }
  }

  async function downloadResultFile(kind: "txt" | "srt" | "vtt" | "json") {
    if (engineServerOnline && phase === "done") {
      // Если был движок — файлы лежат на нём, скачиваем оттуда
      // (но мы не сохраняем URL ответа. Поэтому для простоты используем локальную генерацию из сегментов.)
      if (kind === "txt") downloadTXT();
      else if (kind === "srt") downloadSRT();
      else if (kind === "vtt") downloadVTT();
    } else {
      if (kind === "txt") downloadTXT();
      else if (kind === "srt") downloadSRT();
      else if (kind === "vtt") downloadVTT();
    }
  }

  const totalDuration = segments.length
    ? Math.max(...segments.map((s) => s.timestamp[1] ?? s.timestamp[0]))
    : 0;

  function reset() {
    setFile(null);
    setFileName("");
    setFileSize(0);
    setUrl("");
    setSegments([]);
    setText("");
    setSourceLabel("");
    clearTranslation();
    setSearchQuery("");
    setOnlyMatches(false);
    setActiveSegIdx(null);
    setFileDuration(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setPhase("idle");
    setProgress(0);
    setProgressLog([]);
    setError(null);
    setJobNote(null);
    try {
      localStorage.removeItem("transcrypt.lastTranscribe");
    } catch {
      /* ignore */
    }
  }

  // ═════════ Общие блоки для обоих режимов (файл / URL) ═════════
  const busy = phase === "loading-engine" || phase === "running";
  const urlValue = url.trim();
  const urlValid = !!urlValue && isUrl(urlValue);
  const canRun = mode === "url"
    ? engineServerOnline && urlValid && !busy
    : !!file && !busy;

  const langControls = (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="flex items-center gap-3">
        <Mic className="w-5 h-5 text-[#7c5bf5]" />
        <div>
          <div className="font-medium text-sm">{t("Исходный язык")}</div>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-1.5 text-sm mt-1"
          >
            <option value="auto">{t("Автоопределение")}</option>
            {LANG_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Languages className="w-5 h-5 text-emerald-400" />
        <div>
          <div className="font-medium text-sm">{t("Перевести на")}</div>
          <select
            value={targetLang}
            onChange={(e) => {
              const v = e.target.value;
              setTargetLang(v);
              try {
                localStorage.setItem("transcrypt.prefs.targetLang", v);
              } catch {
                /* ignore */
              }
              // Результат уже готов — сразу переводим его на новый язык
              if (phase === "done" && v !== "-") retranslate(v);
            }}
            className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-1.5 text-sm mt-1"
          >
            <option value="-">{t("Оригинал (без перевода)")}</option>
            {LANG_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );

  const runButton = (
    <button
      onClick={run}
      disabled={!canRun}
      title={
        mode === "url" && !urlValid
          ? t("Вставьте корректную ссылку на видео")
          : undefined
      }
      className="bg-gradient-primary text-white px-6 py-3 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 justify-center glow-primary"
    >
      {busy ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("Обработка…")} </>
      ) : (
        <>
          <Play className="w-4 h-4" />
          {t("Распознать речь")} </>
      )}
    </button>
  );

  // Оценка времени выполнения — до запуска, из длительности файла и модели
  const estimateBlock = (() => {
    if (mode !== "file" || !fileDuration || !isFinite(fileDuration) || fileDuration <= 0) return null;
    const id = (engineServerOnline ? selectedModel ?? "base" : browserSafeModel(selectedModel)) as string;
    const f = SPEED_FACTORS[id] ?? SPEED_FACTORS.base;
    const k = engineServerOnline ? 1 : 0.4; // браузерный WASM заметно медленнее нативного движка
    const minA = Math.max(1, Math.ceil(fileDuration / 60 / (f[0] * k)));
    const minB = Math.max(minA, Math.ceil(fileDuration / 60 / (f[1] * k)));
    return (
      <p className="text-xs text-muted-foreground">
        {t("Оценка времени: ≈")} {minA}–{minB}  {t("мин")}{" "}
        {engineServerOnline ? t("на движке") : t("в браузере (WASM — медленнее)")}{t(". Зависит от процессора.")} </p>
    );
  })();

  const progressBlock = busy ? (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-2 text-sm">
        <span>{progressText}</span>
        <span className="text-[#7c5bf5] font-mono font-bold">{progress}%</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-[#1b2334] overflow-hidden">
        <motion.div
          className="h-full bg-gradient-primary"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      {progressLog.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
            {t("Лог (")}{progressLog.length}  {t("строк)")} </summary>
          <div className="max-h-32 overflow-y-auto mt-2 font-mono text-[10px] text-muted-foreground bg-[#0b0f19] p-2 rounded-lg">
            {progressLog.map((l, i) => (
              <div key={i} className="truncate">{l}</div>
            ))}
          </div>
        </details>
      )}
      {engineServerOnline ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-emerald-300/90 inline-flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 flex-shrink-0" />
            {supportsJobs
              ? supportsQueue
                ? t("Задача идёт на движке: можно переключать вкладки и запускать задачи в других разделах — они пойдут параллельно или встанут в очередь, ничего не пропадёт.")
                : t("Задача выполняется на движке: можно переключать вкладки или закрыть браузер — результат дождётся вас здесь.")
              : t("Задача идёт в этой вкладке — не закрывайте её. Обновите движок, чтобы задачи выполнялись в фоне.")}
          </span>
          <button
            onClick={cancelRun}
            className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
          >
            <Square className="w-3 h-3" />
            {t("Отменить")} </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-amber-300/80">
          {t("Браузерный Whisper работает, только пока открыта вкладка — не переключайтесь надолго и не закрывайте её до завершения.")} </p>
      )}
    </div>
  ) : null;

  const errorBlock = error ? (
    <div className="glass-card rounded-2xl p-4 border-red-500/40">
      <div className="text-sm text-red-400">{t("Ошибка:")} {error}</div>
    </div>
  ) : null;

  const resultBlock = phase === "done" ? (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <ConspectBridge text={viewText} segments={viewSegments} sourceLabel={sourceLabel} />

      {sourceLabel && (
        <div className="glass-card rounded-2xl p-3 px-4 text-xs text-muted-foreground">
          {t("Источник:")} <span className="text-foreground font-medium">{sourceLabel}</span>
          {translatedText && (
            <>
              <span className="mx-2">·</span>
              {t("переведено на:")} <span className="text-emerald-400 font-medium">{langLabel(targetLang)}</span>
            </>
          )}
        </div>
      )}
      <div className="glass-card rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between">
        <div className="text-sm">
          {t("Найдено сегментов:")} <span className="font-mono font-bold text-[#7c5bf5]">{segments.length || "—"}</span>
          {totalDuration > 0 && (
            <span className="text-muted-foreground ml-3">
              {t("длительность ≈")} {formatDuration(totalDuration)}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <ExportBtn onClick={() => downloadResultFile("srt")} label="SRT" />
          <ExportBtn onClick={() => downloadResultFile("vtt")} label="VTT" />
          <ExportBtn onClick={() => downloadResultFile("txt")} label="TXT" />
          <ExportBtn onClick={downloadMD} label="MD" />
        </div>
      </div>

      {/* Плеер для локальных файлов: перемотка по клику на таймкод сегмента */}
      {audioUrl && (
        <audio
          ref={playerRef}
          src={audioUrl}
          controls
          className="w-full h-10"
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            let found: number | null = null;
            for (let i = 0; i < viewSegments.length; i++) {
              const s = viewSegments[i];
              const end = s.timestamp[1] ?? s.timestamp[0] + 5;
              if (t >= s.timestamp[0] - 0.25 && t < end) {
                found = i;
                break;
              }
            }
            if (found !== null) setActiveSegIdx(found);
          }}
        />
      )}

      {translError && (
        <div className="glass-card rounded-2xl p-4 border-amber-500/40">
          <div className="text-sm text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              {t("Перевод не удался (")}{translError}{t("). Транскрипция не потеряна — оригинал можно скопировать или скачать ниже.")} </span>
          </div>
        </div>
      )}

      {text && (
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold text-sm">
              {translatedText ? t("Полный текст (оригинал)") : t("Полный текст")}
            </h3>
            <CopyModesBtn
              modes={[
                { id: "plain", label: t("Обычный текст"), get: () => text },
                {
                  id: "stamps",
                  label: t("С таймкодами"),
                  get: () => (segments.length ? segmentsWithStamps(segments) : text),
                },
                {
                  id: "quotes",
                  label: t("Цитатами (для конспекта)"),
                  get: () => (segments.length ? segmentsAsQuotes(segments) : text),
                },
              ]}
            />
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
        </div>
      )}

      {translatedText && (
        <div className="glass-card rounded-2xl p-5 border-emerald-500/30">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold text-sm inline-flex items-center gap-2">
              <Languages className="w-4 h-4 text-emerald-400" />
              {t("Перевод —")} {langLabel(targetLang)}
            </h3>
            <CopyModesBtn
              modes={[
                { id: "plain", label: t("Обычный текст"), get: () => translatedText },
                {
                  id: "stamps",
                  label: t("С таймкодами"),
                  get: () =>
                    translatedSegments.length ? segmentsWithStamps(translatedSegments) : translatedText,
                },
                {
                  id: "quotes",
                  label: t("Цитатами (для конспекта)"),
                  get: () =>
                    translatedSegments.length ? segmentsAsQuotes(translatedSegments) : translatedText,
                },
              ]}
            />
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{translatedText}</p>
        </div>
      )}

      {segments.length > 0 && (
        <div className="glass-card rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold text-sm">{t("Сегменты с таймкодами")}</h3>
            <div className="flex items-center gap-2">
              {translatedSegments.length > 0 && (
                <div className="flex bg-[#1b2334] rounded-lg p-0.5 text-xs">
                  <button
                    onClick={() => setSegView("translation")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      segView === "translation"
                        ? "bg-gradient-primary text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("Перевод")} </button>
                  <button
                    onClick={() => setSegView("original")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      segView === "original"
                        ? "bg-gradient-primary text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("Оригинал")} </button>
                </div>
              )}
              <CopyModesBtn
                modes={[
                  { id: "plain", label: t("Обычный текст"), get: () => segmentsToPlainText(viewSegments) },
                  { id: "stamps", label: t("С таймкодами"), get: () => segmentsWithStamps(viewSegments) },
                  { id: "quotes", label: t("Цитатами (для конспекта)"), get: () => segmentsAsQuotes(viewSegments) },
                ]}
              />
            </div>
          </div>

          {/* Поиск по транскрипту: подсветка совпадений + фильтр «только совпадения» */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("Поиск по тексту…")}
                className="w-full bg-[#0b0f19] border border-[#263147] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-[#7c5bf5]/50"
              />
            </div>
            {searchQuery.trim() && (
              <>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {matchCount > 0 ? `Совпадений: ${matchCount}` : t("Ничего не найдено")}
                </span>
                <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={onlyMatches}
                    onChange={(e) => setOnlyMatches(e.target.checked)}
                    className="accent-[#7c5bf5]"
                  />
                  {t("Только совпадения")} </label>
              </>
            )}
          </div>

          <div className="space-y-1 max-h-96 overflow-y-auto pr-2">
            {visibleSegments.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">{t("Сегментов с таким текстом нет — снимите фильтр или измените запрос.")}</p>
            ) : (
              visibleSegments.map(({ seg, idx }) => (
                <div
                  key={idx}
                  className={`flex items-start gap-3 p-2 rounded-lg transition-colors ${
                    activeSegIdx === idx
                      ? "bg-[#7c5bf5]/15 ring-1 ring-[#7c5bf5]/40"
                      : "hover:bg-[#1b2334]"
                  }`}
                >
                  <button
                    onClick={() => onTimestampClick(seg.timestamp[0], idx)}
                    title={t("Перемотать плеер на этот момент (или скопировать ссылку с таймкодом)")}
                    className="font-mono text-xs text-[#7c5bf5] mt-0.5 flex-shrink-0 tabular-nums hover:underline"
                  >
                    {formatDuration(seg.timestamp[0])}
                  </button>
                  <span className="text-sm text-foreground/90">
                    <Highlight text={seg.text} query={searchQuery} />
                  </span>
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {t("Клик по таймкоду — перемотка плеера. Для YouTube-результатов копируется ссылка с меткой момента.")} </p>
        </div>
      )}
    </motion.div>
  ) : null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">{t("Транскрипция аудио и видео")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Whisper превратит голос в текст с таймкодами. URL-задачи (YouTube и др.) — через локальный движок со стратегией «сначала субтитры».")} </p>
        </div>
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("Модель:")}</span>
          <select
            value={engineServerOnline ? (selectedModel ?? "base") : browserSafeModel(selectedModel)}
            onChange={(e) => setSelectedModel(e.target.value as WhisperModelId)}
            className="bg-[#1b2334] border border-[#263147] rounded-lg px-3 py-1.5 text-sm font-medium hover:border-[#7c5bf5]/50"
          >
            {(engineServerOnline
              ? (["tiny", "base", "small", "medium", "large-v3"] as const)
              : (["tiny", "base", "small"] as const)
            ).map((id) => {
              const mi = MODEL_INFO[id];
              const size = engineServerOnline ? mi.engineSizeMB : mi.sizeMB;
              const sizeLabel = size >= 1000 ? t("{n} ГБ", { n: (size / 1000).toFixed(1) }) : t("{n} МБ", { n: size });
              return (
                <option key={id} value={id}>
                  {mi.name.replace("Whisper ", "")} — {sizeLabel}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Статус движка: подсказка показывается ТОЛЬКО когда движок не найден.
          Когда движок online — ничего не выводим: зелёный индикатор в шапке
          уже сообщает о работе движка, а постоянный баннер только мешает. */}
      {!engineServerOnline && (
        <div className="mb-5 p-3 rounded-xl flex items-center gap-3 text-sm bg-amber-500/10 border border-amber-500/20 text-amber-300">
          <ServerOff className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>{t("Локальный движок не найден.")}</strong>  {t("Доступна только транскрипция локальных файлов через браузерный Whisper. Для URL (YouTube, TikTok) запустите")} <code className="px-1.5 py-0.5 rounded bg-amber-500/20 font-mono text-xs">python engine_server.py</code>  {t("из репозитория и обновите страницу.")} </span>
        </div>
      )}

      {/* Баннер восстановления фоновой задачи / последнего результата */}
      {jobNote && (
        <div className="mb-5 p-3 rounded-xl border border-[#7c5bf5]/30 bg-[#7c5bf5]/10 text-sm text-[#cfc2ff] flex items-start gap-3">
          <History className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="flex-1">{jobNote}</span>
          <button
            onClick={() => setJobNote(null)}
            className="p-1 rounded-md hover:bg-white/10 flex-shrink-0"
            title={t("Скрыть")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Баннер обновления движка перенесён в Настройки — вкладки не засоряем сообщениями:
          индикатор в шапке зелёный = всё работает, а обновление доступно в Настройках. */}

      {/* Пакетная обработка: несколько ссылок/файлов в очередь движка */}
      <BatchPanel
        engineOnline={engineServerOnline}
        supportsJobs={supportsJobs}
        model={engineServerOnline ? selectedModel ?? "base" : "base"}
        language={language}
        onOpenResult={openBatchResult}
      />

      {!file && (
        <div className="flex gap-2 mb-5 bg-[#1b2334] p-1 rounded-xl w-fit">
          <ModeBtn active={mode === "file"} onClick={() => setMode("file")} icon={Upload} label={t("Файл с компьютера")} />
          <ModeBtn
            active={mode === "url"}
            onClick={() => setMode("url")}
            icon={Link2}
            label={engineServerOnline ? t("URL (YouTube и др.)") : t("URL (нужен движок)")}
          />
        </div>
      )}

      {/* URL Input */}
      {!file && mode === "url" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-6 mb-5"
        >
          <label className="text-xs text-muted-foreground mb-2 block">{t("Ссылка на видео (YouTube, TikTok, Instagram, Vimeo и др.)")}</label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Link2 className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("https://youtube.com/watch?v=… или https://youtu.be/…")}
                className="w-full bg-[#0b0f19] border border-[#263147] rounded-xl pl-10 pr-3 py-3 text-sm focus:outline-none focus:border-[#7c5bf5]/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canRun) run();
                }}
              />
            </div>
          </div>

          {urlValid && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Zap className="w-3.5 h-3.5 text-[#7c5bf5]" />
              <span>{t("Источник:")} <span className="text-foreground font-medium">{detectSource(urlValue).icon} {detectSource(urlValue).label}</span></span>
              <span>·</span>
              <span>{t("Стратегия: сначала субтитры → fallback на Whisper")}</span>
            </div>
          )}

          {engineServerOnline ? (
            <div className="mt-4 pt-4 border-t border-[#263147]/60 flex flex-col gap-4 items-stretch justify-between">
              {langControls}
              {runButton}
            </div>
          ) : (
            <div className="mt-4 rounded-xl p-4 border-amber-500/30 bg-amber-500/5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-amber-200 font-medium mb-1">{t("Для ссылок нужен локальный движок")}</p>
                  <p className="text-xs text-amber-200/80 leading-relaxed mb-3">
                    {t("Распознавание по ссылке работает через движок на вашем компьютере (yt-dlp + Whisper): браузер технически не может скачать видео с YouTube напрямую — это блокируют CORS и защита от ботов. Установка — одна команда, без архивов.")} </p>
                  {onInstallEngine && (
                    <button
                      onClick={onInstallEngine}
                      className="bg-gradient-primary text-white px-4 py-2 rounded-lg text-xs font-medium hover:opacity-90 inline-flex items-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      {t("Установить движок за 1 команду")} </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {engineServerOnline && (
            <div className="mt-4 rounded-xl p-4 border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-200/80">
              {t("Фоновые задачи: можно спокойно переключиться на другую вкладку — движок продолжит работу, а результат появится здесь.")} </div>
          )}
        </motion.div>
      )}

      {/* File drop zone */}
      {!file && mode === "file" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`glass-card rounded-2xl p-12 text-center cursor-pointer transition-all ${
            dragOver ? "border-[#7c5bf5] glow-primary scale-[1.01]" : ""
          }`}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <motion.div
            initial={{ scale: 1 }}
            animate={dragOver ? { scale: 1.05 } : { scale: 1 }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-4"
          >
            <Upload className="w-8 h-8 text-[#7c5bf5]" />
          </motion.div>
          <h3 className="font-semibold mb-1">{t("Перетащите аудио или видео сюда")}</h3>
          <p className="text-sm text-muted-foreground mb-3">
            {t("MP3, WAV, M4A, MP4, WebM, MOV — до 500 МБ (через движок) или 200 МБ (браузер)")} </p>
          <button className="text-[#7c5bf5] text-sm font-medium hover:underline">
            {t("или нажмите, чтобы выбрать файл")}
          </button>
        </div>
      )}

      {/* Файл загружен */}
      {file && (
        <div className="space-y-5">
          {/* Проба длительности для оценки времени (до запуска) */}
          {audioUrl && (
            <audio
              src={audioUrl}
              className="hidden"
              preload="metadata"
              onLoadedMetadata={(e) => setFileDuration(e.currentTarget.duration || null)}
            />
          )}
          <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
              <FileAudio className="w-6 h-6 text-[#7c5bf5]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{fileName}</div>
              <div className="text-xs text-muted-foreground">
                {(fileSize / 1024 / 1024).toFixed(2)}  {t("МБ")} </div>
            </div>
            {file.type.startsWith("audio/") && audioUrl && (
              <audio controls src={audioUrl} className="max-w-xs h-10 hidden md:block" />
            )}
            <button
              onClick={reset}
              className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
              title={t("Убрать файл")}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Предупреждение для длинных файлов в браузерном режиме */}
          {!engineServerOnline && (fileSize / 1024 / 1024) > 50 && (
            <div className="glass-card rounded-2xl p-4 border-amber-500/30 bg-amber-500/5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-1">{t("Большой файл для браузерного режима")}</p>
                  <p className="text-xs text-amber-200/80 leading-relaxed">
                    {t("Браузерный Whisper (WASM) работает медленно для файлов длиннее 10-15 минут и может зависать на очень длинных аудио (более 30 минут). Для длинных файлов рекомендуется установить локальный движок — он работает в 5-10 раз быстрее и не блокирует браузер. Нажмите на индикатор «Только браузер» в шапке справа для перехода к установке.")} </p>
                </div>
              </div>
            </div>
          )}

          <div className="glass-card rounded-2xl p-5 flex flex-col gap-4 items-stretch justify-between">
            {langControls}
            {estimateBlock}
            {runButton}
          </div>
        </div>
      )}

      {/* Общие блоки прогресса/ошибки/результата — вне контейнеров режима,
          чтобы восстановленный результат фоновых задач был виден всегда */}
      {progressBlock}
      {errorBlock}
      {resultBlock}
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
  disabledHint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledHint : undefined}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2 ${
        active
          ? "bg-gradient-primary text-white"
          : disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function ExportBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
    >
      <Download className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

/** Кнопка «Копировать» с меню режимов: обычный текст / с таймкодами / цитатами. */
function CopyModesBtn({
  modes,
}: {
  modes: { id: string; label: string; get: () => string }[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();

  async function copy(m: { id: string; get: () => string }) {
    const ok = await copyTextToClipboard(m.get());
    setOpen(false);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("Выбрать, как скопировать: обычный текст, с таймкодами или цитатами")}
        className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? t("Скопировано") : t("Копировать")}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 min-w-[190px] rounded-xl border border-[#263147] bg-[#151b28] shadow-2xl overflow-hidden">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => void copy(m)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-[#1b2334] transition-colors whitespace-nowrap"
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Подсветка совпадений поиска в тексте (безопасно: чистые React-тексты). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let rest = text;
  let k = 0;
  for (;;) {
    const idx = rest.toLowerCase().indexOf(q);
    if (idx === -1) break;
    if (idx > 0) parts.push(rest.slice(0, idx));
    parts.push(
      <mark key={k++} className="bg-[#7c5bf5]/40 text-inherit rounded px-0.5">
        {rest.slice(idx, idx + q.length)}
      </mark>
    );
    rest = rest.slice(idx + q.length);
  }
  parts.push(rest);
  return <>{parts}</>;
}

/**
 * Простой SRT-парсер: переводит .srt в массив сегментов с таймкодами.
 */
function parseSrt(content: string): Seg[] {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const segs: Seg[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (lines.length < 2) continue;
    // Первая строка — номер, вторая — таймкод
    const tsLine = lines.find((l) => l.includes("-->"));
    if (!tsLine) continue;
    const [startStr, endStr] = tsLine.split("-->").map((s) => s.trim());
    const text = lines.slice(lines.indexOf(tsLine) + 1).join(" ").trim();
    if (!text) continue;
    segs.push({
      text,
      timestamp: [parseSrtTime(startStr), parseSrtTime(endStr)],
    });
  }
  return segs;
}

function parseSrtTime(t: string): number {
  // 00:01:23,456 → 83.456
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return 0;
  return (
    parseInt(m[1]) * 3600 +
    parseInt(m[2]) * 60 +
    parseInt(m[3]) +
    parseInt(m[4]) / 1000
  );
}

// Чтобы избежать TS-ругани на неиспользуемый импорт
void downloadEngineFile;
void Globe;
