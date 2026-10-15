"use client";

/**
 * Пакетная обработка для студентов: несколько лекций за раз.
 *
 * Источники:
 *  - список ссылок (по одной в строке)
 *  - .txt-файл со ссылками (по одной в строке)
 *  - несколько локальных аудио/видео файлов
 *
 * Задачи создаются через Job API движка (startBatchJob) и НЕ трогают слоты
 * одиночных задач вкладок: пакет живёт в собственном журнале
 * transcrypt.batchJobs, опрашивается общим таймером, переживает
 * переключение вкладок и перезагрузку страницы. Движок ≥ 1.2.0 сам ставит
 * лишние задачи в очередь / гоняет параллельно (см. полосы heavy/light).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Layers,
  Play,
  Square,
  FolderOpen,
  Download,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
} from "lucide-react";
import {
  startBatchJob,
  getBatchJobInfo,
  cancelJobById,
  uploadFileToEngine,
  type TranscribeResult,
} from "@/lib/engine-bridge";
import { downloadFile, buildMarkdown } from "@/lib/subtitles";
import { useI18n } from "@/lib/i18n";

const BATCH_KEY = "transcrypt.batchJobs";

type BatchResult = {
  text: string;
  source: string;
  files?: { srt?: string; json?: string; txt?: string };
};

export type BatchItem = {
  jobId: string;
  label: string;
  kind: "url" | "file";
  status: "queued" | "running" | "done" | "error" | "cancelled";
  percent: number;
  stage: string;
  error?: string;
  addedAt: number;
  finishedAt?: number;
  result?: BatchResult;
};

function readItems(): BatchItem[] {
  try {
    const raw = localStorage.getItem(BATCH_KEY);
    const arr = raw ? (JSON.parse(raw) as BatchItem[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Запись журнала с защитой от переполнения localStorage: сначала жертвуем результатами старых задач. */
function writeItems(items: BatchItem[]) {
  try {
    localStorage.setItem(BATCH_KEY, JSON.stringify(items));
    return;
  } catch {
    /* quota — пробуем легче */
  }
  try {
    const light = items.map((it, idx) =>
      idx < items.length - 3 && it.status === "done" ? { ...it, result: undefined } : it
    );
    localStorage.setItem(BATCH_KEY, JSON.stringify(light));
  } catch {
    /* ignore */
  }
}

function isLikelyUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function safeFileName(label: string, ext: string): string {
  const base = label
    .replace(/^https?:\/\//, "")
    .replace(/[^\wа-яА-ЯёЁ.-]+/g, "_")
    .slice(0, 60);
  return `${base || "task"}${ext}`;
}

interface BatchPanelProps {
  engineOnline: boolean;
  supportsJobs: boolean;
  model: string;
  language: string;
  onOpenResult: (item: BatchItem) => void;
}

export function BatchPanel({ engineOnline, supportsJobs, model, language, onOpenResult }: BatchPanelProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<BatchItem[]>([]);
  const [urlsText, setUrlsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const txtInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  // Восстановление журнала при монтировании (перезагрузка страницы/возврат на вкладку).
  // Именно effect, а не ленивый useState: чтение localStorage в первом кадре
  // расходится с серверным HTML (hydration mismatch). SSR-кадр пуст, журнал подставляется после.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(readItems());
  }, []);

  const updateItem = useCallback((jobId: string, patch: Partial<BatchItem>) => {
    setItems((prev) => {
      const next = prev.map((it) => (it.jobId === jobId ? { ...it, ...patch } : it));
      writeItems(next);
      return next;
    });
  }, []);

  // Общий опрос всех незавершённых задач пакета (и на монтировании — довозит до конца)
  const hasPending = items.some((it) => it.status === "queued" || it.status === "running");
  useEffect(() => {
    if (!hasPending || !engineOnline) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const pending = readItems().filter((it) => it.status === "queued" || it.status === "running");
      for (const it of pending) {
        if (cancelled) return;
        try {
          const info = await getBatchJobInfo(it.jobId);
          if (!info) continue; // движок недоступен — попробуем в следующий тик
          if (info.status === it.status && info.percent === it.percent && info.status !== "running") continue;
          if (info.status === "done") {
            const r = (info.result ?? {}) as TranscribeResult;
            updateItem(it.jobId, {
              status: "done",
              percent: 100,
              stage: "Готово",
              finishedAt: Date.now(),
              result: { text: r.text || "", source: r.source || it.label, files: r.files },
            });
          } else if (info.status === "error") {
            updateItem(it.jobId, {
              status: "error",
              percent: 100,
              stage: "Ошибка",
              error: info.error || "задача завершилась с ошибкой",
              finishedAt: Date.now(),
            });
          } else if (info.status === "cancelled") {
            updateItem(it.jobId, { status: "cancelled", percent: 100, stage: "Отменена", finishedAt: Date.now() });
          } else {
            const stage =
              info.status === "queued" && info.queuePosition && info.queuePosition > 1
                ? `В очереди — впереди ещё ${info.queuePosition - 1}`
                : info.status === "queued"
                  ? "В очереди"
                  : info.stage || "Выполняется";
            updateItem(it.jobId, { status: info.status, percent: info.percent, stage });
          }
        } catch {
          /* сеть дрогнула — повторим */
        }
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasPending, engineOnline, updateItem]);

  function parseUrls(text: string): string[] {
    const out: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      for (const token of line.split(/\s+/)) {
        const t = token.trim();
        if (t && isLikelyUrl(t) && !out.includes(t)) out.push(t);
      }
    }
    return out;
  }

  async function launchBatch(urlList: string[], files: File[]) {
    setNotice(null);
    if (!engineOnline || !supportsJobs) return;
    setBusy(true);
    let created = 0;
    try {
      for (const u of urlList) {
        const jobId = await startBatchJob(
          "transcribe",
          { url: u, model, language, translate_to: "-" },
          u
        );
        if (!jobId) {
          setNotice("Движок не поддерживает очередь задач — обновите движок (баннер выше).");
          break;
        }
        const item: BatchItem = {
          jobId,
          label: u,
          kind: "url",
          status: "queued",
          percent: 0,
          stage: "В очереди",
          addedAt: Date.now(),
        };
        setItems((prev) => {
          const next = [...prev, item];
          writeItems(next);
          return next;
        });
        created++;
      }
      for (const f of files) {
        try {
          const filePath = await uploadFileToEngine(f, f.name);
          const jobId = await startBatchJob(
            "transcribe",
            { file_path: filePath, model, language, translate_to: "-" },
            f.name
          );
          if (!jobId) {
            setNotice("Движок не поддерживает очередь задач — обновите движок (баннер выше).");
            break;
          }
          const item: BatchItem = {
            jobId,
            label: f.name,
            kind: "file",
            status: "queued",
            percent: 0,
            stage: "В очереди",
            addedAt: Date.now(),
          };
          setItems((prev) => {
            const next = [...prev, item];
            writeItems(next);
            return next;
          });
          created++;
        } catch (e: any) {
          setNotice(`Не удалось загрузить «${f.name}» на движок: ${e?.message ?? "ошибка"}`);
        }
      }
    } finally {
      setBusy(false);
      if (created > 0) {
        setNotice(`Добавлено задач: ${created}. Движок выполнит их сам — можно переключать вкладки и закрывать браузер.`);
        setUrlsText("");
        if (txtInputRef.current) txtInputRef.current.value = "";
        if (filesInputRef.current) filesInputRef.current.value = "";
      }
    }
  }

  function onTxtFile(f: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const urls = parseUrls(String(reader.result || ""));
      if (!urls.length) {
        setNotice("В файле не найдено ни одной ссылки (нужны http(s):// ссылки, по одной в строке).");
        return;
      }
      void launchBatch(urls, []);
    };
    reader.readAsText(f);
  }

  async function onMediaFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).filter(
      (f) => f.type.startsWith("audio/") || f.type.startsWith("video/")
    );
    if (!files.length) {
      setNotice("Выберите аудио или видео файлы.");
      return;
    }
    await launchBatch([], files);
  }

  async function cancelItem(it: BatchItem) {
    await cancelJobById(it.jobId);
    updateItem(it.jobId, { status: "cancelled", percent: 100, stage: "Отменена", finishedAt: Date.now() });
  }

  function downloadItemTxt(it: BatchItem) {
    if (!it.result) return;
    downloadFile(safeFileName(it.label, ".txt"), it.result.text || "", "text/plain");
  }

  function downloadAllMarkdown() {
    const done = items.filter((it) => it.status === "done" && it.result);
    if (!done.length) return;
    const parts = done.map(
      (it, i) =>
        `## ${i + 1}. ${it.label}\n\n${buildMarkdown({
          title: it.label,
          source: it.result!.source,
          segments: [],
          text: it.result!.text,
        }).replace(/^# .*\n/, "")}`
    );
    downloadFile("transcrypt-batch.md", `# Пакетная транскрипция\n\n${parts.join("\n\n---\n\n")}`, "text/markdown");
  }

  const doneCount = items.filter((it) => it.status === "done").length;
  const pendingCount = items.filter((it) => it.status === "queued" || it.status === "running").length;
  const urlCount = parseUrls(urlsText).length;
  const active = urlCount; // количество задач к запуску из textarea

  return (
    <div className="glass-card rounded-2xl p-5 mb-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">
          <Layers className="w-4 h-4 text-[#7c5bf5]" />
          {t("Пакетная обработка")}
          {items.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              · {doneCount} готово{pendingCount ? `, ${pendingCount} в работе` : ""}
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{open ? t("Свернуть ▲") : t("Развернуть ▼")}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {!engineOnline ? (
            <div className="text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              Для пакетной обработки нужен локальный движок — он скачивает видео и выполняет задачи в фоне.
            </div>
          ) : !supportsJobs ? (
            <div className="text-xs text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              Ваш движок устарел: обновите его (баннер выше), чтобы ставить задачи в очередь.
            </div>
          ) : (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Ссылки на видео — по одной в строке
                </label>
                <textarea
                  value={urlsText}
                  onChange={(e) => setUrlsText(e.target.value)}
                  rows={3}
                  placeholder={"https://youtube.com/watch?v=…\nhttps://youtu.be/…\nhttps://vk.com/video-…"}
                  className="w-full bg-[#0b0f19] border border-[#263147] rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#7c5bf5]/50"
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    onClick={() => txtInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Загрузить ссылки из .txt файла
                  </button>
                  <input
                    ref={txtInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onTxtFile(f);
                    }}
                  />
                  <button
                    onClick={() => filesInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Выбрать несколько файлов
                  </button>
                  <input
                    ref={filesInputRef}
                    type="file"
                    accept="audio/*,video/*"
                    multiple
                    hidden
                    onChange={(e) => void onMediaFiles(e.target.files)}
                  />
                  <button
                    onClick={() => void launchBatch(parseUrls(urlsText), [])}
                    disabled={busy || active === 0}
                    className="bg-gradient-primary text-white px-4 py-2 rounded-xl text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 ml-auto"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {busy ? "Добавляем…" : `В очередь: ${active || 0} ${active === 1 ? "задача" : active < 5 ? "задачи" : "задач"}`}
                  </button>
                </div>
              </div>

              {notice && (
                <div className="text-xs text-[#cfc2ff] bg-[#7c5bf5]/10 border border-[#7c5bf5]/30 rounded-xl p-2.5">
                  {notice}
                </div>
              )}

              {items.length > 0 && (
                <div className="space-y-1.5">
                  {items.slice().reverse().map((it) => (
                    <div
                      key={it.jobId}
                      className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#0b0f19]/60 border border-[#263147]/60 text-xs"
                    >
                      <span className="flex-shrink-0">
                        {it.status === "done" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : it.status === "error" ? (
                          <XCircle className="w-4 h-4 text-red-400" />
                        ) : it.status === "cancelled" ? (
                          <XCircle className="w-4 h-4 text-muted-foreground" />
                        ) : it.status === "queued" ? (
                          <Clock className="w-4 h-4 text-sky-400" />
                        ) : (
                          <Loader2 className="w-4 h-4 text-[#7c5bf5] animate-spin" />
                        )}
                      </span>
                      <span className="flex-1 min-w-0 truncate" title={it.label}>
                        {it.label}
                      </span>
                      {it.status === "running" || it.status === "queued" ? (
                        <span className="text-muted-foreground flex-shrink-0">
                          {it.stage}
                          {it.status === "running" ? ` · ${it.percent}%` : ""}
                        </span>
                      ) : it.status === "error" ? (
                        <span className="text-red-400 truncate max-w-[40%]" title={it.error}>
                          {it.error}
                        </span>
                      ) : it.status === "done" ? (
                        <span className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => onOpenResult(it)}
                            className="px-2.5 py-1 rounded-lg bg-[#1b2334] hover:bg-[#263147] font-medium inline-flex items-center gap-1"
                          >
                            <FolderOpen className="w-3 h-3" />
                            Открыть
                          </button>
                          <button
                            onClick={() => downloadItemTxt(it)}
                            className="px-2.5 py-1 rounded-lg bg-[#1b2334] hover:bg-[#263147] font-medium inline-flex items-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            .txt
                          </button>
                        </span>
                      ) : (
                        <span className="text-muted-foreground flex-shrink-0">Отменена</span>
                      )}
                      {(it.status === "queued" || it.status === "running") && (
                        <button
                          onClick={() => void cancelItem(it)}
                          title="Отменить задачу"
                          className="p-1 rounded-md hover:bg-white/10 text-muted-foreground hover:text-red-400 flex-shrink-0"
                        >
                          <Square className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={downloadAllMarkdown}
                      disabled={!doneCount}
                      className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Скачать всё одним .md
                    </button>
                    <button
                      onClick={() => {
                        const rest = items.filter((it) => it.status !== "done");
                        setItems(rest);
                        writeItems(rest);
                      }}
                      disabled={!doneCount}
                      className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Убрать готовые
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
