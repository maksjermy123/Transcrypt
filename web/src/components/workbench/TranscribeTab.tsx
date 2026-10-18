"use client";

import { motion } from "framer-motion";
import {
  Loader2,
  Download,
  Settings2,
  Globe,
  ServerOff,
  Server,
  AlertTriangle,
  Languages,
  Mic,
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
  startBatchJob,
  getBatchJobInfo,
  cancelJobById,
  uploadFileToEngine,
  downloadEngineFile,
  fetchEngineFile,
  resumeActiveJobWithRetry,
  watchJobToCompletion,
  clearActiveJob,
  cancelActiveJob,
  deleteEngineFiles,
  collectQueueFilesForDelete,
  purgeTabEngineFiles,
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
import { InboxQueue, type QueueItem } from "@/components/workbench/InboxQueue";

type Phase = "idle" | "loading-engine" | "running" | "done" | "error";
type Seg = { text: string; timestamp: [number, number | null] };

/** Аудио/видео расширения — для drag&drop, когда браузер не дал MIME-тип (macOS). */
const AV_EXT_RE = /\.(mp3|wav|m4a|m4b|aac|ogg|oga|opus|flac|wma|mp4|m4v|mkv|webm|mov|avi|flv|wmv|ts|3gp)$/i;

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
  const [url, setUrl] = useState(""); // ссылка восстанавливается из фоновой задачи — для кликов по таймкодам
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [segments, setSegments] = useState<Seg[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  // Конечный язык: "-" — без перевода (выдаём оригинал). Исходный язык — у КАЖДОЙ записи очереди (itemOption2).
  const [targetLang, setTargetLang] = useState("-");
  const [translatedText, setTranslatedText] = useState("");
  const [translatedSegments, setTranslatedSegments] = useState<Seg[]>([]);
  const [translError, setTranslError] = useState<string | null>(null);
  // Режим просмотра результата: перевод / оригинал / сегменты с таймкодами —
  // всё в одной карточке, переключение одной кнопкой-группой
  const [segView, setSegView] = useState<"translation" | "original" | "segments">("translation");
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Поиск по транскрипту + подсветка активного сегмента при прослушивании
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [activeSegIdx, setActiveSegIdx] = useState<number | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const [defaultTargetLang, setDefaultTargetLang] = useState<string>("-");
  // Фоновые задачи (Job API): статус поддержки движком + заметка восстановления
  const supportsJobs = !!engineServerHealth?.jobs;
  const supportsQueue = !!engineServerHealth?.queue; // движок ≥ 1.2.0: очереди + параллельные полосы
  const [jobNote, setJobNote] = useState<string | null>(null);
  // Отдельная заметка «Восстановлен последний результат»: её крестик не просто
  // скрывает баннер — он чистит кеш (результат больше не восстановится) и
  // удаляет файлы этой вкладки с диска движка (≥ 1.3.9).
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const clearTranslation = () => {
    setTranslatedText("");
    setTranslatedSegments([]);
    setTranslError(null);
    setSegView("translation");
  };

  // ═════════ Очередь транскрибации (InboxQueue) ═════════

  /**
   * jobs-режим: создать фоновую задачу движка для записи очереди.
   * Файл сначала загружается на движок. Перевод — на клиенте после
   * завершения (onQueueItemDone): оригинал сохраняется, работает
   * переключатель «Перевод / Оригинал».
   */
  const launchTranscribeJob = useCallback(
    async (item: QueueItem): Promise<string | null> => {
      let urlParam: string | undefined;
      let filePath: string | undefined;
      if (item.kind === "url") {
        urlParam = item.label;
      } else {
        filePath = await uploadFileToEngine(item.file!, item.label);
      }
      return await startBatchJob(
        "transcribe",
        {
          url: urlParam,
          file_path: filePath,
          model: selectedModel ?? "base",
          language: item.option2 || "auto", // исходный язык выбран напротив каждой записи
          translate_to: "-", // перевод выполняется на клиенте после транскрипции
        },
        item.label
      );
    },
    [selectedModel]
  );

  /** jobs-режим: запись завершена — если выбран конечный язык, переводим текст прямо здесь. */
  const onQueueItemDone = useCallback(
    (it: QueueItem, update: (patch: Partial<QueueItem>) => void) => {
      const lang = it.option;
      const r = it.result || {};
      if (!lang || lang === "-" || !r.text || r.translated) return;
      update({ stage: t("Переводим на {l}…", { l: langLabel(lang) }) });
      translateText(r.text, {
        targetLang: lang,
        provider,
        apiKey: deeplKey || undefined,
        engineOnline: engineServerOnline,
      })
        .then((translated) =>
          update({ stage: t("Готово"), result: { ...r, translated, translError: null } })
        )
        .catch((e: any) => {
          // Перевод не удался — оригинал не теряем, ошибка покажется при открытии
          const msg = e?.message ?? t("неизвестная ошибка");
          update({ stage: t("Готово"), result: { ...r, translated: "", translError: msg } });
        });
    },
    [provider, deeplKey, engineServerOnline, t]
  );

  /**
   * sequential-режим (движок offline): распознаём записи по одной в браузерном Whisper.
   * Результат показывается в основном окне и запоминается в записи (можно переоткрыть).
   */
  const runQueueItemSequential = useCallback(
    async (it: QueueItem, update: (patch: Partial<QueueItem>) => void) => {
      if (it.kind === "url") {
        update({
          status: "error",
          percent: 100,
          stage: t("Ошибка"),
          error: t("Ссылки требуют локальный движок: браузер технически не может скачать видео (CORS и защита от ботов)."),
          finishedAt: Date.now(),
        });
        return;
      }
      const outcome = await runTaskBrowser(it.file!, it.label, it.option2 || "auto", it.option);
      update({
        status: "done",
        percent: 100,
        stage: t("Готово"),
        finishedAt: Date.now(),
        result: {
          text: outcome.text,
          source: outcome.sourceLabel,
          segments: outcome.segments,
          translated: outcome.translatedText || undefined,
          translError: outcome.translError,
        },
      });
    },
    // runTaskBrowser объявлена ниже как function-декларация — в замыкание не попадает
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  /**
   * Браузерная транскрипция одной записи (Whisper WASM).
   * Результат показывается в основном окне И возвращается вызывающему —
   * чтобы запись очереди запомнила его (клик по готовой записи переоткроет).
   */
  async function runTaskBrowser(
    f: File | Blob,
    fname: string,
    srcLang: string,
    tgtLang: string
  ): Promise<{
    text: string;
    segments: Seg[];
    translatedText: string;
    translatedSegments: Seg[];
    translError: string | null;
    sourceLabel: string;
  }> {
    setError(null);
    setProgress(0);
    setProgressLog([]);
    setText("");
    setSegments([]);
    setJobNote(null);
    cancelledRef.current = false;
    clearTranslation();

    setPhase("loading-engine");
    setProgress(5);
    setProgressText(t("Подгружаем Whisper из кеша…"));
    try {
      await loadWhisperPipeline(browserSafeModel(selectedModel));
      setPhase("running");
      setProgress(10);
      setProgressText(t("Распознавание речи…"));
      const result = await transcribeAudio(f, srcLang, (p) => {
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
      const srcLabel = fname
        ? `${fname} · ${t("Whisper {m} (браузер)", { m: browserSafeModel(selectedModel) })}`
        : t("Whisper {m} (браузер)", { m: browserSafeModel(selectedModel) });
      setSourceLabel(srcLabel);

      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(f));

      // Выбран конечный язык — переводим ДО выдачи результата
      const tr = await translateIfNeeded(resText, segs, tgtLang);

      setPhase("done");
      setProgress(100);
      setProgressText(t("Готово"));
      persistLastResult({
        sourceLabel: srcLabel,
        text: resText,
        segments: segs,
        targetLang: tgtLang,
        translatedText: tr.tText,
        translatedSegments: tr.tSegs,
        translError: tr.err,
      });
      return {
        text: resText,
        segments: segs,
        translatedText: tr.tText,
        translatedSegments: tr.tSegs,
        translError: tr.err,
        sourceLabel: srcLabel,
      };
    } catch (err: any) {
      if (cancelledRef.current) {
        // Отмена пользователем — состояние уже сброшено cancelRun()
        throw err;
      }
      console.error(err);
      setError(err?.message ?? t("Ошибка распознавания"));
      setPhase("error");
      throw err;
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
    // Исходный язык каждой записи известен только очереди; после восстановления
    // результата он неизвестен — сравнение «источник == цель» здесь не делаем.
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

  /** Смена конечного языка после готового результата — мягкий повторный перевод.
   *  Вызывается при открытии записи очереди, если перевод ещё не готов. */
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
      setRestoreNote(t("Восстановлен последний результат{when}.", { when: when ? t("(от {d})", { d: when }) : "" }));
    } catch {
      /* ignore */
    }
  }

  /**
   * Крестик на баннере восстановления: кеш результата сбрасывается (в следующей
   * сессии ничего не восстановится), а файлы задач этой вкладки на диске движка
   * удаляются (транскрипты, субтитры, скачанные аудио). Записи, которые ещё
   * живут в списке очереди, не трогаем — по ним «Скачать/Открыть» продолжает работать.
   */
  async function discardRestoredResult() {
    setRestoreNote(null);
    try {
      localStorage.removeItem("transcrypt.lastTranscribe");
    } catch {
      /* ignore */
    }
    await purgeTabEngineFiles("transcribe", ["transcrypt.batchJobs"]);
  }

  // ═══ Восстановление предпочитаемого конечного языка (дефолт для новых записей) ═══
  useEffect(() => {
    try {
      const v = localStorage.getItem("transcrypt.prefs.targetLang");
      if (v) setDefaultTargetLang(v);
    } catch {
      /* ignore */
    }
  }, []);

  // ═══ Восстановление фоновой задачи при возврате на вкладку ═══
  // Покрывает: переключение вкладок внутри приложения, уход на другую
  // вкладку браузера, перезагрузку страницы и выгрузку вкладки браузером.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let outcome: Awaited<ReturnType<typeof resumeActiveJobWithRetry>> | null = null;
      try {
        outcome = await resumeActiveJobWithRetry("transcribe");
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
      if (!outcome || outcome.state === "none") {
        restoreLastResult();
        return;
      }
      if (outcome.state === "offline") {
        // Движок не отвечает: слот НЕ чистим — при следующем возврате
        // попытка восстановления повторится.
        setJobNote(
          t("Не удалось связаться с движком, чтобы проверить фоновую задачу. Запустите движок и обновите страницу — задача, если она была, продолжала выполняться на нём.")
        );
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

  /** Открыть результат записи очереди в основном окне результатов. */
  async function openQueueResult(it: QueueItem) {
    const r = it.result || {};
    if (!r.text && !r.files?.srt) return;
    setError(null);
    setUrl("");
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setText(r.text || "");
    setSourceLabel(r.source || it.label);
    setTargetLang(it.option || "-");
    setTranslatedText(r.translated || "");
    setTranslatedSegments([]);
    setSegView(r.translated ? "translation" : "original");
    setTranslError(r.translError ?? null);
    setJobNote(t("Результат из очереди: {x}", { x: it.label }));
    setPhase("done");
    setProgress(100);
    setProgressText(t("Готово"));
    let segs: Seg[] = Array.isArray(r.segments) ? r.segments : [];
    if (r.files?.srt) {
      try {
        const blob = await fetchEngineFile(r.files.srt);
        const srtText = await blob.text();
        segs = parseSrt(srtText);
      } catch {
        /* текст уже показан — сегменты необязательны */
      }
    }
    setSegments(segs);
    setSearchQuery("");
    setOnlyMatches(false);
    setActiveSegIdx(null);
    // Перевод по выбранному языку не готов (браузер был закрыт во время фоновой задачи) —
    // догоняем прямо сейчас: оригинал уже на экране, перевод появится ниже.
    if (it.option && it.option !== "-" && !r.translated && (r.text || "").trim()) {
      const tr = await translateIfNeeded(r.text || "", segs, it.option);
      persistLastResult({
        sourceLabel: r.source || it.label,
        text: r.text || "",
        segments: segs,
        targetLang: it.option,
        translatedText: tr.tText,
        translatedSegments: tr.tSegs,
        translError: tr.err,
      });
      return;
    }
    persistLastResult({
      sourceLabel: r.source || it.label,
      text: r.text || "",
      segments: segs,
      targetLang: it.option || "-",
      translatedText: r.translated || "",
      translatedSegments: [],
      translError: r.translError ?? null,
    });
  }

  /**
   * Скачать результат готовой записи очереди в выбранном формате.
   * SRT/VTT строятся из сегментов записи (или из SRT-файла движка, если
   * сегменты не сохранились в журнале).
   */
  async function downloadQueueItemFormat(it: QueueItem, fmt: "txt" | "srt" | "vtt" | "md") {
    const r = it.result || {};
    const base =
      it.label
        .replace(/^https?:\/\//, "")
        .replace(/[^\wа-яА-ЯёЁ.-]+/g, "_")
        .slice(0, 60) || "task";
    if (fmt === "txt") {
      if (!r.text) return;
      downloadFile(`${base}.txt`, r.translated || r.text, "text/plain");
      return;
    }
    // Для SRT/VTT/MD нужны сегменты с таймкодами
    let segs: Seg[] = Array.isArray(r.segments) ? r.segments : [];
    if (!segs.length && r.files?.srt) {
      try {
        const blob = await fetchEngineFile(r.files.srt);
        segs = parseSrt(await blob.text());
      } catch {
        /* сегменты недоступны */
      }
    }
    if (!segs.length) {
      setJobNote(t("Для этой записи нет сегментов — субтитры SRT/VTT недоступны. Скачайте текст (.txt)."));
      return;
    }
    const bodyText = r.translated || r.text || segmentsToPlainText(segs);
    if (fmt === "srt") {
      downloadFile(`${base}.srt`, segmentsToSRT(segs), "text/plain");
    } else if (fmt === "vtt") {
      downloadFile(`${base}.vtt`, segmentsToVTT(segs), "text/plain");
    } else {
      downloadFile(
        `${base}.md`,
        buildMarkdown({
          title: r.source || it.label,
          source: r.source || it.label,
          segments: segs,
          text: bodyText,
        }),
        "text/markdown"
      );
    }
  }

  const totalDuration = segments.length
    ? Math.max(...segments.map((s) => s.timestamp[1] ?? s.timestamp[0]))
    : 0;

  // ═════════ Общие блоки ═════════
  const busy = phase === "loading-engine" || phase === "running";

  // Исходный и конечный язык теперь выбираются НАПРОТИВ каждой записи очереди
  // (itemOption2 → itemOption). Отдельная строка «Исходный язык» больше не нужна.

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
        <div className="flex items-center gap-2">
          <DownloadMenu
            title={t("Скачать результат в выбранном формате")}
            items={[
              { id: "srt", label: t("SRT — субтитры"), on: () => downloadSRT() },
              { id: "vtt", label: t("VTT — субтитры"), on: () => downloadVTT() },
              { id: "txt", label: t("TXT — текст"), on: () => downloadTXT() },
              { id: "md", label: t("MD — заметки"), on: () => downloadMD() },
            ]}
          />
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

      {(text || translatedText || segments.length > 0) && (
        <div className={showingTranslation ? "glass-card rounded-2xl p-5 border-emerald-500/30" : "glass-card rounded-2xl p-5"}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold text-sm inline-flex items-center gap-2">
              {showingTranslation && <Languages className="w-4 h-4 text-emerald-400" />}
              {segView === "segments" && segments.length > 0
                ? t("Сегменты с таймкодами")
                : showingTranslation
                  ? <>{t("Перевод —")} {langLabel(targetLang)}</>
                  : translatedText
                    ? t("Полный текст (оригинал)")
                    : t("Полный текст")}
            </h3>
            <div className="flex items-center gap-2">
              {/* Единый переключатель режимов: Перевод / Оригинал / Сегменты —
                  сегменты больше не отдельная карточка, а режим той же карточки */}
              <div className="flex bg-[#1b2334] rounded-lg p-0.5 text-xs">
                {translatedText && (
                  <button
                    onClick={() => setSegView("translation")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      segView === "translation"
                        ? "bg-gradient-primary text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("Перевод")}
                  </button>
                )}
                <button
                  onClick={() => setSegView("original")}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    segView === "original"
                      ? "bg-gradient-primary text-white"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t("Оригинал")}
                </button>
                {segments.length > 0 && (
                  <button
                    onClick={() => setSegView("segments")}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                      segView === "segments"
                        ? "bg-gradient-primary text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("Сегменты")}
                  </button>
                )}
              </div>
              <CopyModesBtn
                modes={
                  segView === "segments" && segments.length > 0
                    ? [
                        { id: "plain", label: t("Обычный текст"), get: () => segmentsToPlainText(viewSegments) },
                        { id: "stamps", label: t("С таймкодами"), get: () => segmentsWithStamps(viewSegments) },
                        { id: "quotes", label: t("Цитатами (для конспекта)"), get: () => segmentsAsQuotes(viewSegments) },
                      ]
                    : [
                        { id: "plain", label: t("Обычный текст"), get: () => viewText },
                        {
                          id: "stamps",
                          label: t("С таймкодами"),
                          get: () => (viewSegments.length ? segmentsWithStamps(viewSegments) : viewText),
                        },
                        {
                          id: "quotes",
                          label: t("Цитатами (для конспекта)"),
                          get: () => (viewSegments.length ? segmentsAsQuotes(viewSegments) : viewText),
                        },
                      ]
                }
              />
            </div>
          </div>

          {segView === "segments" && segments.length > 0 ? (
            <>
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
            </>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{viewText}</p>
          )}
        </div>
      )}
    </motion.div>
  ) : null;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Шапка вкладки — единый формат на всех вкладках: иконка в квадрате + заголовок + описание.
          Параметр «Модель» стоит в шапке очереди (headerExtra) — как у всех вкладок. */}
      <div className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
          <Mic className="w-5 h-5 text-[#7c5bf5]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold mb-1">{t("Транскрипция аудио и видео")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Whisper превратит голос в текст с таймкодами. URL-задачи (YouTube и др.) — через локальный движок со стратегией «сначала субтитры».")} </p>
        </div>
      </div>

      {/* Статус движка: подсказка показывается ТОЛЬКО когда движок не найден.
          Когда движок online — ничего не выводим: зелёный индикатор в шапке
          уже сообщает о работе движка, а постоянный баннер только мешает. */}
      {!engineServerOnline && (
        <div className="mb-5 p-3 rounded-xl flex items-center gap-3 text-sm bg-amber-500/10 border border-amber-500/20 text-amber-300">
          <ServerOff className="w-4 h-4 flex-shrink-0" />
          <span>
            <strong>{t("Локальный движок не найден.")}</strong>  {t("Доступна только транскрипция локальных файлов через браузерный Whisper. Для URL (YouTube, TikTok) запустите")} <code className="px-1.5 py-0.5 rounded bg-amber-500/20 font-mono text-xs">python engine_server.py</code>  {t("из репозитория и обновите страницу.")} {t("В браузерном режиме обработка идёт только пока открыта вкладка — переключение вкладок может прервать задачу.")} </span>
        </div>
      )}

      {/* Старый движок без Job API: задача пойдёт по синхронному пути и умрёт
          при переключении вкладки — предупреждаем ДО запуска. */}
      {engineServerOnline && engineServerHealth && !supportsJobs && (
        <div className="mb-5 p-3 rounded-xl flex items-start gap-3 text-sm bg-amber-500/10 border border-amber-500/20 text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>{t("Движок без фоновых задач.")}</strong> {t("Задача выполняется, только пока открыта вкладка: при переключении на другую вкладку она прервётся. Обновите движок (Настройки → «Доступно обновление движка») — и задачи будут идти в фоне даже после закрытия браузера.")}
          </span>
        </div>
      )}

      {/* Баннер восстановления фоновой задачи / последнего результата */}
      {restoreNote && (
        <div className="mb-5 p-3 rounded-xl border border-[#7c5bf5]/30 bg-[#7c5bf5]/10 text-sm text-[#cfc2ff] flex items-start gap-3">
          <History className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="flex-1">{restoreNote}</span>
          <button
            onClick={() => void discardRestoredResult()}
            className="p-1 rounded-md hover:bg-white/10 flex-shrink-0"
            title={t("Скрыть и очистить: результат больше не восстановится, а его файлы на диске движка будут удалены")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
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

      {/* ЕДИНОЕ ПРИНИМАЮЩЕЕ ОКНО-ОЧЕРЕДЬ: файлы + вставка ссылок + ЛЮБОЙ текстовый файл со ссылками.
          Ничего не запускается само — список редактируется, затем «Транскрибировать». */}
      <InboxQueue
        title={t("Очередь транскрибации")}
        intro={t("Перетащите файлы, вставьте ссылки или бросьте любой текстовый файл со ссылками — всё соберётся в список. Отредактируйте его и нажмите «Транскрибировать»: без нажатия ничего не запустится.")}
        headerExtra={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Settings2 className="w-3.5 h-3.5" />
            {t("Модель:")}
            <select
              value={engineServerOnline ? (selectedModel ?? "base") : browserSafeModel(selectedModel)}
              onChange={(e) => setSelectedModel(e.target.value as WhisperModelId)}
              className="bg-[#1b2334] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs font-medium hover:border-[#7c5bf5]/50"
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
          </label>
        }
        acceptAttr="audio/*,video/*,.txt,.md,.markdown,.csv,.tsv,.log,.json,.xml,.html,.htm,.srt,.vtt,.ass,.yml,.yaml,.rtf,.list,.url,.pdf,.docx"
        fileFilter={(f) => {
          const mime = (f.type || "").toLowerCase();
          return mime.startsWith("audio/") || mime.startsWith("video/") || AV_EXT_RE.test(f.name)
            ? null
            : t("не аудио и не видео (нужны MP3, WAV, M4A, MP4, MKV, WebM, MOV)");
        }}
        dropHint={t("Перетащите аудио/видео файлы или текстовый файл со ссылками — можно несколько сразу")}
        allowUrls
        urlsPlaceholder={t("или вставьте скопированные ссылки сюда — по одной в строке (Enter добавит их в список)")}
        itemOption2={{
          label: t("Исходный язык"),
          title: t("Исходный язык этой записи: на нём звучит речь (Автоопределение — если не уверены)"),
          defaultValue: "auto",
          options: [
            { value: "auto", label: t("Автоопределение") },
            ...LANG_OPTIONS.map((l) => ({ value: l.code, label: l.label })),
          ],
        }}
        itemOption={{
          label: t("Конечный язык"),
          title: t("Конечный язык этой записи: после распознавания текст будет переведён на него"),
          defaultValue: defaultTargetLang,
          options: [
            { value: "-", label: t("Оригинал (без перевода)") },
            ...LANG_OPTIONS.map((l) => ({ value: l.code, label: l.label })),
          ],
        }}
        mode={engineServerOnline ? "jobs" : "sequential"}
        engineOnline={engineServerOnline}
        supportsJobs={supportsJobs}
        launchJob={launchTranscribeJob}
        pollJobInfo={getBatchJobInfo}
        cancelJob={cancelJobById}
        onItemDone={onQueueItemDone}
        runItem={runQueueItemSequential}
        storageKey="transcrypt.batchJobs"
        onDeleteJobFiles={(removed) => {
          // Удаление записи из списка — её файлы на движке больше не нужны
          const { paths, job_ids } = collectQueueFilesForDelete(removed);
          if (paths.length || job_ids.length) void deleteEngineFiles({ paths, job_ids });
        }}
        startLabel={t("Транскрибировать")}
        runningLabel={t("Транскрибируем…")}
        openLabel={t("Открыть")}
        onOpenResult={(it) => void openQueueResult(it)}
        resultActions={(it) =>
          it.result?.text || it.result?.files?.srt ? (
            <DownloadMenu
              small
              title={t("Скачать результат в выбранном формате")}
              items={[
                { id: "txt", label: t("TXT — текст"), on: () => downloadQueueItemFormat(it, "txt") },
                { id: "srt", label: t("SRT — субтитры"), on: () => void downloadQueueItemFormat(it, "srt") },
                { id: "vtt", label: t("VTT — субтитры"), on: () => void downloadQueueItemFormat(it, "vtt") },
                { id: "md", label: t("MD — заметки"), on: () => void downloadQueueItemFormat(it, "md") },
              ]}
            />
          ) : null
        }
        footerNote={
          engineServerOnline && supportsJobs
            ? t("Задачи выполняются на движке в фоне: можно переключать вкладки и закрыть браузер — записи в списке дождутся вас.")
            : !engineServerOnline
              ? t("Браузерный режим: файлы распознаются по очереди, только пока открыта вкладка. Для ссылок и фоновой обработки установите движок.")
              : undefined
        }
      />

      {/* Исходный и конечный язык — напротив каждой записи очереди (выше);
          модель — в шапке вкладки. Отдельные строки больше не нужны. */}

      {/* Общие блоки прогресса/ошибки/результата — чтобы восстановленный
          результат фоновых задач был виден всегда */}
      {progressBlock}
      {errorBlock}
      {resultBlock}
    </div>
  );
}

/**
 * Кнопка «Скачать» с выпадающим меню форматов (SRT / VTT / TXT / MD).
 * Используется и в карточке результата, и напротив строки задачи очереди.
 */
function DownloadMenu({
  items,
  small,
  title,
}: {
  items: { id: string; label: string; on: () => void | Promise<void> }[];
  small?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={title || t("Выбрать формат и скачать")}
        className={`rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 font-medium inline-flex items-center gap-1.5 transition-colors ${
          small ? "px-2.5 py-1.5 text-xs" : "px-3 py-1.5 text-sm"
        }`}
      >
        <Download className={small ? "w-3 h-3" : "w-3.5 h-3.5"} />
        {t("Скачать")}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 min-w-[180px] rounded-xl border border-[#263147] bg-[#151b28] shadow-2xl overflow-hidden">
            {items.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setOpen(false);
                  void m.on();
                }}
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
