"use client";

import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  ServerOff,
  History,
  X,
  Square,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import {
  startBatchJob,
  getBatchJobInfo,
  cancelJobById,
  downloadEngineFile,
  engineFileUrl,
  resumeActiveJobWithRetry,
  watchJobToCompletion,
  clearActiveJob,
  cancelActiveJob,
  deleteEngineFiles,
  collectQueueFilesForDelete,
  purgeTabEngineFiles,
  type EngineProgress,
  type MediaAction,
  type TaskResult,
} from "@/lib/engine-bridge";
import { useI18n } from "@/lib/i18n";
import { InboxQueue, type QueueItem } from "@/components/workbench/InboxQueue";

export function MediaTab() {
  const { t } = useI18n();
  const { engineServerOnline, selectedModel, engineServerHealth } = useOnboarding();
  const supportsJobs = !!engineServerHealth?.jobs;
  const supportsQueue = !!engineServerHealth?.queue; // движок ≥ 1.2.0: очереди задач
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [resultName, setResultName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [jobNote, setJobNote] = useState<string | null>(null);
  // Отдельная заметка восстановления: её крестик чистит кеш и файлы на диске движка
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  /** Вытаскиваем имя файла из URL /api/download?file=/path/to/file.mp4 */
  function fileNameFromUrl(fileUrl: string): string {
    try {
      const u = new URL(fileUrl.startsWith("http") ? fileUrl : `http://x${fileUrl}`);
      const fp = u.searchParams.get("file") || u.pathname;
      return decodeURIComponent(fp.split("/").pop() || "output.bin");
    } catch {
      return "output.bin";
    }
  }

  function persistLastMedia(fileUrl: string, fname: string, opt: string) {
    try {
      localStorage.setItem(
        "transcrypt.lastMedia",
        JSON.stringify({ at: Date.now(), file: fileUrl, name: fname, action: opt })
      );
    } catch {
      /* ignore */
    }
  }

  function restoreLastMedia() {
    try {
      const raw = localStorage.getItem("transcrypt.lastMedia");
      if (!raw) return;
      const r = JSON.parse(raw);
      if (!r?.file) return;
      setResultFile(r.file);
      setResultName(r.name || "output.bin");
      setPhase("done");
      const when = r.at ? new Date(r.at).toLocaleString() : "";
      setRestoreNote(t("Восстановлен последний готовый файл{when}.", { when: when ? t("(от {d})", { d: when }) : "" }));
    } catch {
      /* ignore */
    }
  }

  /** Крестик на баннере восстановления: кеш сбрасывается, файлы вкладки на диске движка удаляются. */
  async function discardRestoredMedia() {
    setRestoreNote(null);
    try {
      localStorage.removeItem("transcrypt.lastMedia");
    } catch {
      /* ignore */
    }
    await purgeTabEngineFiles("media", ["transcrypt.mediaJobs"]);
  }

  // ═══ Восстановление фоновой задачи при возврате на вкладку ═══
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let outcome: Awaited<ReturnType<typeof resumeActiveJobWithRetry>>;
      try {
        outcome = await resumeActiveJobWithRetry("media");
      } catch {
        restoreLastMedia();
        return;
      }
      if (cancelled) return;
      if (outcome.state === "none") {
        restoreLastMedia();
        return;
      }
      if (outcome.state === "offline") {
        // Слот НЕ чистим — при следующем возврате попытка повторится
        setJobNote(t("Не удалось связаться с движком, чтобы проверить фоновую задачу. Запустите движок и обновите страницу — задача, если она была, продолжала выполняться на нём."));
        restoreLastMedia();
        return;
      }
      if (outcome.state === "lost") {
        clearActiveJob("media");
        setJobNote(t("Прошлая фоновая задача не найдена — движок перезапускался."));
        restoreLastMedia();
        return;
      }
      if (outcome.state === "error") {
        clearActiveJob("media");
        setError(outcome.job.error || t("Фоновая задача завершилась с ошибкой"));
        setPhase("error");
        return;
      }
      const rec = outcome.record;
      if (outcome.state === "done") {
        clearActiveJob("media"); // результат забрали — слот освобождаем
        const res = outcome.job.result as TaskResult;
        if (res?.file) {
          setResultFile(res.file);
          setResultName(fileNameFromUrl(res.file));
          setPhase("done");
          setProgress(100);
          setJobNote(t("Фоновая задача завершилась, пока вас не было — файл готов."));
        } else {
          setJobNote(res?.message || t("Фоновая задача завершилась."));
        }
        return;
      }
      // running — переподключаемся
      setPhase("running");
      setProgress(1);
      setProgressText(t("Переподключение к фоновой задаче…"));
      setJobNote(t("Задача выполнялась в фоне — снова следим за ней."));
      try {
        const res = await watchJobToCompletion<TaskResult>(
          rec.jobId,
          (p: EngineProgress) => {
            setProgress(p.percent);
            setProgressText(p.stage || t("Обработка…"));
            setJobNote((n) =>
              p.stage?.startsWith("В очереди")
                ? t("Задача стоит в очереди — движок выполняет другую задачу (например, транскрипцию). Она начнётся автоматически: ничего не пропадёт.")
                : n?.startsWith("Задача стоит в очереди")
                  ? null
                  : n
            );
            if (p.log?.length) setProgressLog((l) => [...l.slice(-50), ...p.log.slice(-3)]);
          },
          "media"
        );
        if (cancelled) return;
        if (res.status !== "success" || !res.file) {
          throw new Error(res.message || t("Движок вернул ошибку"));
        }
        setResultFile(res.file);
        setResultName(fileNameFromUrl(res.file));
        setPhase("done");
        setProgress(100);
        setProgressText(t("Готово"));
        persistLastMedia(res.file, fileNameFromUrl(res.file), "-");
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? t("Ошибка фоновой задачи"));
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Предупреждение при закрытии/обновлении страницы во время задачи
  useEffect(() => {
    if (phase !== "running") return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase]);

  async function cancelRun() {
    setProgressText(t("Отменяем задачу…"));
    try {
      await cancelActiveJob("media");
    } catch {
      /* ignore */
    }
    setPhase("idle");
    setProgress(0);
    setProgressText("");
    setJobNote(t("Задача отменена."));
  }

  function reset() {
    setResultFile(null);
    setResultName("");
    setProgress(0);
    setProgressText("");
    setError(null);
    setPhase("idle");
    setProgressLog([]);
    setJobNote(null);
    setRestoreNote(null);
    setDownloadError(null);
    try {
      localStorage.removeItem("transcrypt.lastMedia");
    } catch {
      /* ignore */
    }
    // «Убрать из показа» — это и чистка диска: файлы задач медиа, на которые
    // больше не ссылается ни одна запись списка, удаляются с движка
    void purgeTabEngineFiles("media", ["transcrypt.mediaJobs"]);
  }
  // reset() доступен из карточки последнего файла ниже

  // ═════════ Очередь скачивания (InboxQueue) ═════════

  /** jobs-режим: создать фоновую задачу скачивания для записи очереди. */
  const launchMediaJob = async (item: QueueItem): Promise<string | null> =>
    await startBatchJob(
      "media",
      {
        action: (item.option || "download_video") as MediaAction,
        url: item.label,
        model: selectedModel ?? "base",
      },
      item.label
    );

  /** jobs-режим: запись готова — обновляем карточку «последний файл». */
  const onMediaItemDone = (it: QueueItem) => {
    const r = it.result || {};
    if (r.file) persistLastMedia(r.file, fileNameFromUrl(r.file), it.option);
  };

  /** Скачать файл готовой записи (с понятной ошибкой при неудаче). */
  async function downloadQueueItemFile(it: QueueItem, update: (patch: Partial<QueueItem>) => void) {
    const r = it.result || {};
    if (!r.file) return;
    const fname = fileNameFromUrl(r.file);
    try {
      await downloadEngineFile(r.file, fname);
      update({ result: { ...r, downloadError: null } });
    } catch (e: any) {
      const msg = e?.message ?? t("Не удалось скачать файл");
      console.error(e);
      update({ result: { ...r, downloadError: msg } });
    }
  }

  async function download() {
    if (!resultFile) return;
    setDownloadError(null);
    try {
      await downloadEngineFile(resultFile, resultName || "output");
    } catch (e: any) {
      console.error(e);
      setDownloadError(e?.message ?? t("Не удалось скачать файл"));
    }
  }

  function openDirect() {
    if (!resultFile) return;
    window.open(engineFileUrl(resultFile), "_blank", "noopener");
  }

  // Если движок недоступен — показываем предупреждение
  if (!engineServerOnline) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">{t("Медиа операции")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Скачать видео/аудио с YouTube, TikTok и других площадок — через локальный движок с yt-dlp.")} </p>
        </div>

        <div className="glass-card rounded-2xl p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/15 mb-4">
            <ServerOff className="w-8 h-8 text-amber-400" />
          </div>
          <h3 className="font-semibold mb-2">{t("Локальный движок не найден")}</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
            {t("Медиа-операции (скачивание с YouTube и других площадок) работают через локальный Python-движок — только yt-dlp умеет обходить блокировки YouTube.")} </p>
          <div className="text-left max-w-md mx-auto bg-[#0b0f19] rounded-xl p-4 font-mono text-xs space-y-1">
            <div className="text-muted-foreground">{t("# Установить зависимости (один раз):")}</div>
            <div className="text-foreground">pip install -r requirements.txt</div>
            <div className="text-muted-foreground mt-2">{t("# Запустить движок:")}</div>
            <div className="text-foreground">python engine_server.py</div>
            <div className="text-muted-foreground mt-2">{t("# Движок откроется на http://127.0.0.1:8765")}</div>
            <div className="text-muted-foreground">{t("# Обновите эту страницу — индикатор станет зелёным")}</div>
          </div>
          <a
            href="https://github.com/maksjermy123/Transcrypt#-локальный-движок-опционально-для-url-задач"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-5 text-[#7c5bf5] hover:underline text-sm"
          >
            {t("Подробная инструкция в README →")} </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">{t("Медиа операции")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Скачать видео/аудио, очистить звук, вшить субтитры. Все операции через локальный движок с yt-dlp (обходит блокировки YouTube) и ffmpeg.")} </p>
      </div>

      {/* Баннер обновления движка перенесён в Настройки — вкладки не засоряем сообщениями:
          индикатор в шапке зелёный = всё работает, а обновление доступно в Настройках. */}

      {/* Старый движок без Job API: задача пойдёт по синхронному пути и умрёт
          при переключении вкладки — предупреждаем ДО запуска. */}
      {engineServerOnline && engineServerHealth && !(engineServerHealth as { jobs?: boolean }).jobs && (
        <div className="mb-5 p-3 rounded-xl flex items-start gap-3 text-sm bg-amber-500/10 border border-amber-500/20 text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            <strong>{t("Движок без фоновых задач.")}</strong> {t("Задача выполняется, только пока открыта вкладка: при переключении на другую вкладку она прервётся. Обновите движок (Настройки → «Доступно обновление движка») — и задачи будут идти в фоне даже после закрытия браузера.")}
          </span>
        </div>
      )}

      {/* Баннер восстановления фоновой задачи / результата */}
      {restoreNote && (
        <div className="mb-5 p-3 rounded-xl border border-[#7c5bf5]/30 bg-[#7c5bf5]/10 text-sm text-[#cfc2ff] flex items-start gap-3">
          <History className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span className="flex-1">{restoreNote}</span>
          <button
            onClick={() => void discardRestoredMedia()}
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

      {/* ЕДИНОЕ ПРИНИМАЮЩЕЕ ОКНО-ОЧЕРЕДЬ: вставляйте ссылки (можно пачкой), любой текстовый файл
          со ссылками — для каждой записи выбирается формат; запуск только по кнопке «Скачать». */}
      <InboxQueue
        title={t("Очередь скачивания")}
        intro={t("Вставьте ссылки на видео или бросьте текстовый файл со ссылками — всё соберётся в список. Выберите формат напротив каждой записи и нажмите «Скачать»: без нажатия ничего не запустится.")}
        dropHint={t("Перетащите текстовый файл со списком ссылок — или вставьте ссылки в поле ниже")}
        allowUrls
        urlsPlaceholder={t("https://youtube.com/watch?v=… https://youtu.be/… https://vk.com/video-… — по одной в строке (Enter добавит)")}
        fileFilter={() => t("здесь принимаются только ссылки — файлы скачивает движок")}
        itemOption={{
          label: t("Формат"),
          title: t("Что скачать из этой ссылки"),
          defaultValue: "download_video",
          options: [
            { value: "download_video", label: t("Видео (MP4)") },
            { value: "download_audio", label: t("Аудио (MP3)") },
          ],
        }}
        mode="jobs"
        engineOnline={engineServerOnline}
        supportsJobs={supportsJobs}
        launchJob={launchMediaJob}
        pollJobInfo={getBatchJobInfo}
        cancelJob={cancelJobById}
        onItemDone={onMediaItemDone}
        storageKey="transcrypt.mediaJobs"
        onDeleteJobFiles={(removed) => {
          // Удаление записи из списка — скачанный файл с движка тоже убираем
          const { paths, job_ids } = collectQueueFilesForDelete(removed);
          if (paths.length || job_ids.length) void deleteEngineFiles({ paths, job_ids });
        }}
        startLabel={t("Скачать")}
        runningLabel={t("Скачиваем…")}
        openLabel={t("Открыть")}
        resultActions={(it, update) => {
          const r = it.result || {};
          if (!r.file) return null;
          return (
            <button
              onClick={() => void downloadQueueItemFile(it, update)}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 text-xs font-medium inline-flex items-center gap-1"
            >
              <Download className="w-3 h-3" />
              {t("Скачать")}
            </button>
          );
        }}
        footerNote={
          engineServerOnline && supportsJobs
            ? t("Скачивание идёт на движке в фоне: можно переключать вкладки и закрыть браузер — файлы дождутся вас в списке.")
            : undefined
        }
      />

      {/* Ошибка скачивания готовой записи очереди */}
      {error && (
        <div className="glass-card rounded-2xl p-4 mb-4 border-red-500/40">
          <div className="text-sm text-red-400">{t("Ошибка:")} {error}</div>
        </div>
      )}

      {/* Прогресс восстановленной одиночной задачи (слот прошлых сессий) */}
      {phase === "running" && (
        <div className="glass-card rounded-2xl p-5 mb-4">
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-emerald-300/90 inline-flex items-center gap-1.5">
              {supportsJobs
                ? supportsQueue
                  ? t("Задача идёт на движке: можно переключать вкладки и запускать задачи в других разделах — они пойдут параллельно или встанут в очередь, ничего не пропадёт.")
                  : t("Задача выполняется на движке: можно переключать вкладки или закрыть браузер — файл дождётся вас здесь.")
                : t("Задача идёт в этой вкладке — не закрывайте её. Обновите движок, чтобы задачи выполнялись в фоне.")}
            </span>
            <button
              onClick={cancelRun}
              className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
            >
              <Square className="w-3 h-3" />
              {t("Отменить")} </button>
          </div>
        </div>
      )}

      {error && (
        <div className="glass-card rounded-2xl p-4 mb-4 border-red-500/40">
          <div className="text-sm text-red-400">{t("Ошибка:")} {error}</div>
        </div>
      )}

      {/* Результат */}
      {phase === "done" && resultFile && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-5"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Download className="w-5 h-5 text-emerald-500" />
                <h3 className="font-semibold">{t("Последний готовый файл")}</h3>
              </div>
              <div className="text-sm text-foreground">{resultName}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={download}
                className="bg-emerald-500/15 text-emerald-400 px-5 py-2.5 rounded-xl font-medium inline-flex items-center gap-2 hover:bg-emerald-500/25"
              >
                <Download className="w-4 h-4" />
                {t("Скачать")} </button>
              <button
                onClick={reset}
                className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                title={t("Убрать из показа")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Ошибка скачивания результата — раньше молчала, теперь объясняем что делать */}
      {phase === "done" && resultFile && downloadError && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-4 mt-3 border-amber-500/30 bg-amber-500/5"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-200 font-medium mb-1">{t("Скачивание не удалось")}</p>
              <p className="text-xs text-amber-200/80 mb-2">{downloadError}</p>
              <ul className="text-xs text-amber-200/70 leading-relaxed list-disc pl-4 space-y-0.5 mb-3">
                <li>{t("Мы уже попробовали скачать файл напрямую — проверьте загрузки браузера.")}</li>
                <li>{t("Движок мог перезапуститься и удалить файл — запустите задачу заново.")}</li>
                <li>{t("Движок до 1.2.2 не умеет отдавать файлы с русскими названиями — обновите его (Настройки → «Доступно обновление движка»).")}</li>
              </ul>
              <button
                onClick={openDirect}
                className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {t("Открыть файл напрямую")} </button>
            </div>
            <button
              onClick={() => setDownloadError(null)}
              className="p-1 rounded-md hover:bg-white/10 flex-shrink-0"
              title={t("Скрыть")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
