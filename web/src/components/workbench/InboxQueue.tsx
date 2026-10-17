"use client";

/**
 * InboxQueue — единое принимающее окно-очередь для всех вкладок.
 *
 * Одна область приёма, в которую можно:
 *  - перетащить несколько файлов (аудио/видео/документы — зависит от вкладки)
 *  - перетащить .txt/.md со списком ссылок (ссылки извлекаются автоматически)
 *  - вставить ссылки копипастой (textarea + кнопка «Добавить ссылки»)
 *
 * Всё, что попало в область, выстраивается в СПИСОК ЗАПИСЕЙ и НЕ запускается
 * автоматически. Напротив каждой записи — выбор конечного параметра
 * (язык транскрипции / формат / действие) и кнопка «Удалить из списка».
 * Ниже — «Очистить список» и «Старт»: процесс запускается только по кнопке,
 * ПОСЛЕ того как список отредактирован.
 *
 * Два режима выполнения:
 *  - "jobs"       — задачи ставятся в очередь Job API движка (startBatchJob),
 *                   опрашиваются общим таймером, журнал живёт в localStorage
 *                   (переживает перезагрузку страницы и закрытие вкладки).
 *  - "sequential" — записи обрабатываются по одной, по очереди
 *                   (браузерный Whisper, ffmpeg.wasm, клиентские конвертеры).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Inbox,
  Upload,
  Link2,
  FileAudio,
  FileText,
  Play,
  Loader2,
  Trash2,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  Square,
  AlertTriangle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type QueueItemStatus =
  | "pending"
  | "queued"
  | "running"
  | "done"
  | "error"
  | "cancelled";

export type QueueItem = {
  id: string;
  kind: "file" | "url";
  label: string;
  size?: number;
  /** Файл живёт только в памяти — незапущенные записи не переживают перезагрузку */
  file?: File;
  /** Значение выбора «напротив записи» (язык / формат / действие) */
  option: string;
  status: QueueItemStatus;
  percent: number;
  stage: string;
  error?: string;
  jobId?: string;
  addedAt: number;
  finishedAt?: number;
  /** Произвольный результат вкладки (текст транскрипта, ссылка на файл движка…) */
  result?: any;
};

export type QueueJobInfo = {
  status: string;
  percent: number;
  stage?: string;
  queuePosition?: number;
  error?: string;
  result?: any;
};

export type QueueOptionSpec = {
  label: string;
  /** Статичный список ИЛИ функция от записи (для документов: опции зависят от типа файла) */
  options:
    | { value: string; label: string }[]
    | ((it: QueueItem) => { value: string; label: string }[]);
  /** Строка ИЛИ функция (по имени файла — дефолтный формат для этого типа) */
  defaultValue: string | ((meta: { name: string; kind: "file" | "url" }) => string);
  title?: string;
};

function optionsForItem(
  spec: QueueOptionSpec,
  it: QueueItem
): { value: string; label: string }[] {
  return typeof spec.options === "function" ? spec.options(it) : spec.options;
}

function defaultForItem(
  spec: QueueOptionSpec,
  meta: { name: string; kind: "file" | "url" }
): string {
  return typeof spec.defaultValue === "function" ? spec.defaultValue(meta) : spec.defaultValue;
}

let localIdCounter = 0;
function nextId(): string {
  localIdCounter += 1;
  return `q${Date.now().toString(36)}-${localIdCounter}`;
}

function isLikelyUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseQueueUrls(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    for (const token of line.split(/\s+/)) {
      const t = token.trim();
      if (t && isLikelyUrl(t) && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** Запись журнала с защитой от переполнения localStorage: сначала жертвуем результатами старых задач. */
function writeJournal(key: string, items: QueueItem[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
    return;
  } catch {
    /* quota — пробуем легче */
  }
  try {
    const light = items.map((it, idx) =>
      idx < items.length - 3 && it.status === "done" ? { ...it, result: undefined } : it
    );
    localStorage.setItem(key, JSON.stringify(light));
  } catch {
    /* ignore */
  }
}

function readJournal(key: string): QueueItem[] {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) as QueueItem[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export interface InboxQueueProps {
  /** Заголовок карточки (иконка Inbox рисуется автоматически) */
  title?: string;
  /** Пояснение под заголовком */
  intro?: ReactNode;
  /** accept для input[type=file] */
  acceptAttr?: string;
  /** null = файл берём в очередь; строка = причина отказа */
  fileFilter?: (f: File) => string | null;
  /** Что показывать в дроп-зоне (типы файлов) */
  dropHint: string;
  /** Разрешить приём ссылок (textarea + извлечение из .txt) */
  allowUrls?: boolean;
  urlsPlaceholder?: string;
  /** Расширения файлов-пакетов со ссылками (по умолчанию .txt/.md) */
  batchTextExts?: string[];
  /** Спецификация выбора напротив каждой записи (не задана — селекта нет) */
  itemOption?: QueueOptionSpec;
  /** Режим выполнения */
  mode: "jobs" | "sequential";
  engineOnline: boolean;
  supportsJobs?: boolean;
  /** jobs-режим: создать задачу движка, вернуть jobId (null = движок не умеет очередь) */
  launchJob?: (item: QueueItem) => Promise<string | null>;
  /** jobs-режим: опрос состояния задачи */
  pollJobInfo?: (jobId: string) => Promise<QueueJobInfo | null>;
  /** jobs-режим: отменить задачу по id */
  cancelJob?: (jobId: string) => Promise<void>;
  /** jobs-режим: хук после завершения записи (например, клиентский перевод) */
  onItemDone?: (item: QueueItem, update: (patch: Partial<QueueItem>) => void) => void;
  /** sequential-режим: обработать одну запись до конца */
  runItem?: (item: QueueItem, update: (patch: Partial<QueueItem>) => void) => Promise<void>;
  /** Ключ localStorage для журнала запущенных задач (jobs-режим) */
  storageKey?: string;
  /** Надпись кнопки запуска (со счётчиком добавится автоматически) */
  startLabel: string;
  runningLabel?: string;
  /** Не-null — Старт заблокирован с этим объяснением (title кнопки) */
  startDisabledReason?: string | null;
  /** Дополнительные действия над готовой записью (Скачать/Открыть…) */
  resultActions?: (item: QueueItem, update: (patch: Partial<QueueItem>) => void) => ReactNode;
  /** Открыть результат записи в основном окне вкладки */
  onOpenResult?: (item: QueueItem) => void;
  openLabel?: string;
  /** Заметка под списком (например, «задачи идут в фоне — вкладку можно закрыть») */
  footerNote?: ReactNode;
  /** Что показать вместо списка, когда движок нужен, но offline */
  engineOfflineNote?: ReactNode;
}

export function InboxQueue({
  title,
  intro,
  acceptAttr,
  fileFilter,
  dropHint,
  allowUrls,
  urlsPlaceholder,
  batchTextExts = [".txt", ".md"],
  itemOption,
  mode,
  engineOnline,
  supportsJobs,
  launchJob,
  pollJobInfo,
  cancelJob,
  onItemDone,
  runItem,
  storageKey,
  startLabel,
  runningLabel,
  startDisabledReason,
  resultActions,
  onOpenResult,
  openLabel,
  footerNote,
  engineOfflineNote,
}: InboxQueueProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [urlsText, setUrlsText] = useState("");
  const [busy, setBusy] = useState(false); // запуск/последовательная обработка прямо сейчас
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<QueueItem[]>([]);
  itemsRef.current = items;

  // Восстановление журнала запущенных задач (перезагрузка страницы / возврат на вкладку).
  // Именно effect, а не ленивый useState: SSR-кадр пуст, журнал подставляется после.
  // Старые записи (от прежнего BatchPanel) нормализуем: у них нет id/option.
  useEffect(() => {
    if (!storageKey) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(
      readJournal(storageKey).map((it) => ({
        ...it,
        id: it.id || it.jobId || `legacy-${Math.random().toString(36).slice(2)}`,
        option: it.option ?? "",
      }))
    );
  }, [storageKey]);

  const persist = useCallback(
    (next: QueueItem[]) => {
      if (storageKey) writeJournal(storageKey, next);
    },
    [storageKey]
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<QueueItem>) => {
      setItems((prev) => {
        const next = prev.map((it) => (it.id === id ? { ...it, ...patch } : it));
        persist(next);
        return next;
      });
    },
    [persist]
  );

  // ─── Приём: файлы и ссылки ───

  const addUrlItems = useCallback(
    (urls: string[]) => {
      if (!urls.length) return 0;
      const existing = new Set(
        itemsRef.current.filter((it) => it.kind === "url").map((it) => it.label)
      );
      const fresh = urls.filter((u) => !existing.has(u));
      if (!fresh.length) {
        setNotice(t("Эти ссылки уже есть в списке."));
        return 0;
      }
      const added: QueueItem[] = fresh.map((u) => ({
        id: nextId(),
        kind: "url",
        label: u,
        option: itemOption ? defaultForItem(itemOption, { name: u, kind: "url" }) : "",
        status: "pending",
        percent: 0,
        stage: "",
        addedAt: Date.now(),
      }));
      setItems((prev) => {
        const next = [...prev, ...added];
        persist(next);
        return next;
      });
      return fresh.length;
    },
    [itemOption, persist, t]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      const accepted: QueueItem[] = [];
      const rejected: string[] = [];
      for (const f of files) {
        const lower = f.name.toLowerCase();
        const isBatchText =
          allowUrls && batchTextExts.some((ext) => lower.endsWith(ext));
        if (isBatchText) {
          // Файл-пакет: ссылки извлекаются ниже (addBatchTextFile)
          continue;
        }
        const reason = fileFilter ? fileFilter(f) : null;
        if (reason) {
          rejected.push(`${f.name} — ${reason}`);
          continue;
        }
        accepted.push({
          id: nextId(),
          kind: "file",
          label: f.name,
          size: f.size,
          file: f,
          option: itemOption ? defaultForItem(itemOption, { name: f.name, kind: "file" }) : "",
          status: "pending",
          percent: 0,
          stage: "",
          addedAt: Date.now(),
        });
      }
      if (accepted.length) {
        setItems((prev) => {
          const next = [...prev, ...accepted];
          persist(next);
          return next;
        });
      }
      if (rejected.length) {
        setNotice(
          t("Пропущены файлы неподдерживаемого формата: {list}", {
            list: rejected.slice(0, 3).join(", "),
          }) + (rejected.length > 3 ? t(" и ещё {n}", { n: rejected.length - 3 }) : "")
        );
      }
    },
    [allowUrls, batchTextExts, fileFilter, itemOption, persist, t]
  );

  /** Файл-пакет со ссылками: читаем текст, извлекаем URL, добавляем как записи-ссылки */
  const addBatchTextFile = useCallback(
    (f: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const urls = parseQueueUrls(String(reader.result || ""));
        if (!urls.length) {
          setNotice(
            t("В файле {name} не найдено ни одной ссылки (нужны http(s):// ссылки, по одной в строке).", { name: f.name })
          );
          return;
        }
        const n = addUrlItems(urls);
        if (n > 0) {
          setNotice(t("Из файла {name} извлечено ссылок: {n}.", { name: f.name, n }));
        }
      };
      reader.readAsText(f);
    },
    [addUrlItems, t]
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (!dropped.length) return;
    const batch = dropped.filter((f) =>
      allowUrls && batchTextExts.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    const rest = dropped.filter((f) => !batch.includes(f));
    addFiles(rest);
    for (const f of batch) addBatchTextFile(f);
  }

  function onDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current += 1;
    if (e.dataTransfer.items && Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) {
      setDragOver(true);
    }
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragOver(false);
    }
  }

  function addPastedUrls() {
    const urls = parseQueueUrls(urlsText);
    if (!urls.length) {
      setNotice(t("Вставьте ссылки (http:// или https://) — по одной в строке или через пробел."));
      return;
    }
    const n = addUrlItems(urls);
    if (n > 0) {
      setNotice(t("Добавлено ссылок: {n}.", { n }));
      setUrlsText("");
    }
  }

  // ─── Запуск ───

  const pendingCount = items.filter((it) => it.status === "pending").length;
  const activeCount = items.filter(
    (it) => it.status === "queued" || it.status === "running"
  ).length;
  const hasActive = activeCount > 0;
  const working = busy || hasActive;

  function clearList() {
    if (working) return;
    setItems([]);
    persist([]);
    setNotice(null);
  }

  function removeItem(id: string) {
    if (working) return;
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== id);
      persist(next);
      return next;
    });
  }

  async function cancelItem(it: QueueItem) {
    if (it.jobId && cancelJob) {
      try {
        await cancelJob(it.jobId);
      } catch {
        /* движок сам сообщит статус */
      }
    }
    updateItem(it.id, {
      status: "cancelled",
      percent: 100,
      stage: t("Отменена"),
      finishedAt: Date.now(),
    });
  }

  async function start() {
    if (working || pendingCount === 0) return;
    if (mode === "jobs") {
      if (!engineOnline || !supportsJobs || !launchJob || !pollJobInfo) return;
      setNotice(null);
      setBusy(true);
      let launched = 0;
      try {
        // Копируем список ожидания на момент нажатия Старт (пользователь мог что-то удалить)
        const queue = itemsRef.current.filter((it) => it.status === "pending");
        for (const it of queue) {
          updateItem(it.id, { status: "queued", percent: 0, stage: t("В очереди") });
          try {
            const jobId = await launchJob({ ...it });
            if (!jobId) {
              updateItem(it.id, { status: "error", error: t("Движок не поддерживает очередь задач — обновите движок (Настройки → «Доступно обновление движка»).") });
              setNotice(t("Движок не поддерживает очередь задач — обновите движок (Настройки → «Доступно обновление движка»)."));
              break;
            }
            updateItem(it.id, { jobId, status: "queued", stage: t("В очереди") });
            launched++;
          } catch (e: any) {
            updateItem(it.id, { status: "error", error: e?.message ?? t("не удалось создать задачу") });
          }
        }
        if (launched > 0) {
          setNotice(
            t("Запущено задач: {n}. Движок выполнит их сам — можно переключать вкладки и закрыть браузер.", { n: launched })
          );
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    // ── sequential: по одной записи, по порядку ──
    if (!runItem) return;
    setNotice(null);
    setBusy(true);
    try {
      const queue = itemsRef.current.filter((it) => it.status === "pending");
      for (const it of queue) {
        updateItem(it.id, { status: "running", percent: 0, stage: t("Выполняется") });
        try {
          await runItem(it, (patch) => updateItem(it.id, patch));
          // runItem сам ставит done/error через update, но страховка не помешает
          const cur = itemsRef.current.find((x) => x.id === it.id);
          if (cur && cur.status === "running") {
            updateItem(it.id, { status: "done", percent: 100, stage: t("Готово"), finishedAt: Date.now() });
          }
        } catch (e: any) {
          updateItem(it.id, {
            status: "error",
            percent: 100,
            stage: t("Ошибка"),
            error: e?.message ?? t("ошибка"),
            finishedAt: Date.now(),
          });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // ─── Опрос задач (jobs-режим) ───
  // Зависимость — булево hasJobsPending (а не сам массив): интервал не пересоздаётся
  // на каждом тике обновления статуса.
  const hasJobsPending = items.some((it) => it.status === "queued" || it.status === "running");
  useEffect(() => {
    if (mode !== "jobs" || !engineOnline || !pollJobInfo || !hasJobsPending) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const active = itemsRef.current.filter(
        (it) => (it.status === "queued" || it.status === "running") && it.jobId
      );
      for (const it of active) {
        if (cancelled) return;
        try {
          const info = await pollJobInfo(it.jobId!);
          if (!info) continue; // движок недоступен — повторим в следующий тик
          if (info.status === "done") {
            updateItem(it.id, {
              status: "done",
              percent: 100,
              stage: t("Готово"),
              finishedAt: Date.now(),
              result: info.result ?? it.result,
            });
            const doneItem = { ...it, status: "done" as const, result: info.result ?? it.result };
            onItemDone?.(doneItem, (patch) => updateItem(it.id, patch));
          } else if (info.status === "error") {
            updateItem(it.id, {
              status: "error",
              percent: 100,
              stage: t("Ошибка"),
              error: info.error || t("задача завершилась с ошибкой"),
              finishedAt: Date.now(),
            });
          } else if (info.status === "cancelled") {
            updateItem(it.id, { status: "cancelled", percent: 100, stage: t("Отменена"), finishedAt: Date.now() });
          } else if (info.status !== it.status || info.percent !== it.percent) {
            const stage =
              info.status === "queued" && info.queuePosition && info.queuePosition > 1
                ? t("В очереди — впереди ещё {n}", { n: info.queuePosition - 1 })
                : info.status === "queued"
                  ? t("В очереди")
                  : info.stage || t("Выполняется");
            updateItem(it.id, { status: info.status as QueueItemStatus, percent: info.percent, stage });
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
  }, [mode, engineOnline, pollJobInfo, hasJobsPending, updateItem, onItemDone, t]);

  // ─── Рендер ───

  const startBlockedReason =
    startDisabledReason ||
    (mode === "jobs" && !engineOnline
      ? t("Нужен локальный движок — запустите engine_server.py и обновите страницу.")
      : mode === "jobs" && !supportsJobs
        ? t("Ваш движок устарел: обновите его (Настройки → «Доступно обновление движка»), чтобы ставить задачи в очередь.")
        : null);

  const optionSelect = (it: QueueItem) =>
    itemOption && (
      <select
        value={it.option}
        onChange={(e) => updateItem(it.id, { option: e.target.value })}
        disabled={working}
        className="bg-[#1b2334] border border-[#263147] rounded-lg px-2 py-1.5 text-xs flex-shrink-0 max-w-[150px]"
        title={itemOption.title || itemOption.label}
      >
        {optionsForItem(itemOption, it).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );

  const statusIcon = (it: QueueItem) => {
    switch (it.status) {
      case "done":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
      case "error":
        return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
      case "cancelled":
        return <XCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
      case "queued":
        return <Clock className="w-4 h-4 text-sky-400 flex-shrink-0" />;
      case "running":
        return <Loader2 className="w-4 h-4 text-[#7c5bf5] animate-spin flex-shrink-0" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" />;
    }
  };

  const kindIcon = (it: QueueItem) =>
    it.kind === "url" ? (
      <Link2 className="w-3.5 h-3.5 text-sky-400" />
    ) : /\.(txt|md)$/i.test(it.label) ? (
      <FileText className="w-3.5 h-3.5 text-amber-300" />
    ) : (
      <FileAudio className="w-3.5 h-3.5 text-[#7c5bf5]" />
    );

  return (
    <div className="glass-card rounded-2xl p-5 mb-5">
      {(title || intro) && (
        <div className="flex items-start gap-2 mb-4">
          <Inbox className="w-4 h-4 text-[#7c5bf5] mt-0.5 flex-shrink-0" />
          <div>
            {title && <h3 className="font-semibold text-sm">{title}</h3>}
            {intro && <p className="text-xs text-muted-foreground mt-0.5">{intro}</p>}
          </div>
        </div>
      )}

      {/* ─── Единая область приёма ─── */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-[#7c5bf5] text-[#b9a8f7] bg-[#7c5bf5]/10 scale-[1.005]"
            : "border-[#263147]/60 text-muted-foreground hover:border-[#7c5bf5]/50 hover:text-foreground"
        }`}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-[#7c5bf5]/15 mb-2">
          <Upload className="w-5 h-5 text-[#7c5bf5]" />
        </div>
        <p className="text-sm font-medium">{dropHint}</p>
        {allowUrls && (
          <p className="text-xs text-muted-foreground mt-1">
            {t("…или перетащите .txt/.md со списком ссылок — ссылки извлекутся автоматически")}{" "}
            · {t("нажмите, чтобы выбрать файлы")}
          </p>
        )}
      </div>

      {allowUrls && (
        <div className="mt-3">
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addPastedUrls();
              }
            }}
            rows={2}
            placeholder={urlsPlaceholder || t("или вставьте скопированные ссылки сюда — по одной в строке (Enter добавит их в список)")}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-[#0b0f19] border border-[#263147] rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[#7c5bf5]/50"
          />
          <div className="flex justify-end mt-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                addPastedUrls();
              }}
              disabled={!urlsText.trim()}
              className="px-3 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Link2 className="w-3.5 h-3.5" />
              {t("Добавить ссылки")}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="mt-3 text-xs text-[#cfc2ff] bg-[#7c5bf5]/10 border border-[#7c5bf5]/30 rounded-xl p-2.5">
          {notice}
        </div>
      )}

      {/* ─── Список записей ─── */}
      {items.length > 0 && (
        <div className="mt-4 rounded-xl border border-[#263147]/60 overflow-hidden">
          <div className="max-h-80 overflow-y-auto divide-y divide-[#263147]/40">
            {items.map((it, idx) => (
              <div key={it.id} className="p-3 hover:bg-[#161d2e]/50 transition-colors">
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-muted-foreground/70 w-5 text-right flex-shrink-0 tabular-nums">
                    {idx + 1}.
                  </span>
                  {statusIcon(it)}
                  <span className="flex-shrink-0">{kindIcon(it)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium truncate" title={it.label}>
                        {it.label}
                      </span>
                      {typeof it.size === "number" && it.size > 0 && (
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {(it.size / 1024 / 1024).toFixed(2)} {t("МБ")}
                        </span>
                      )}
                    </div>
                    {(it.status === "queued" || it.status === "running") && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t(it.stage)}
                        {it.status === "running" && it.percent > 0 ? ` · ${it.percent}%` : ""}
                      </div>
                    )}
                    {(it.status === "queued" || it.status === "running") && (
                      <div className="mt-1.5 h-1 rounded-full bg-[#263147] overflow-hidden">
                        <div
                          className="h-full bg-gradient-primary transition-all"
                          style={{ width: `${Math.max(3, it.percent)}%` }}
                        />
                      </div>
                    )}
                    {it.status === "error" && (
                      <div className="text-xs text-red-300 mt-0.5 line-clamp-2" title={it.error}>
                        {it.error}
                      </div>
                    )}
                  </div>
                  {optionSelect(it)}
                  {it.status === "done" && (
                    <span className="flex gap-1.5 flex-shrink-0">
                      {onOpenResult && (
                        <button
                          onClick={() => onOpenResult(it)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1"
                        >
                          {openLabel || t("Открыть")}
                        </button>
                      )}
                      {resultActions?.(it, (patch) => updateItem(it.id, patch))}
                    </span>
                  )}
                  {(it.status === "queued" || it.status === "running") && mode === "jobs" && (
                    <button
                      onClick={() => void cancelItem(it)}
                      title={t("Отменить задачу")}
                      className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-red-400 flex-shrink-0"
                    >
                      <Square className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {it.status !== "queued" && it.status !== "running" && (
                    <button
                      onClick={() => removeItem(it.id)}
                      disabled={working}
                      title={t("Удалить из списка")}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 flex-shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Футер: счётчик + Очистить + Старт ─── */}
      {items.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("Записей: {n}", { n: items.length })}
            {activeCount > 0 ? t(" · в работе: {n}", { n: activeCount }) : ""}
          </span>
          <button
            onClick={clearList}
            disabled={working}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("Очистить список")}
          </button>
          <button
            onClick={() => void start()}
            disabled={working || pendingCount === 0 || !!startBlockedReason}
            title={startBlockedReason || undefined}
            className="ml-auto bg-gradient-primary text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 glow-primary"
          >
            {working ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {runningLabel || t("Выполняется…")}
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                {startLabel} ({pendingCount})
              </>
            )}
          </button>
        </div>
      )}

      {mode === "jobs" && !engineOnline && engineOfflineNote}
      {mode === "jobs" && engineOnline && !supportsJobs && (
        <div className="mt-3 text-xs text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {t("Ваш движок устарел: обновите его (Настройки → «Доступно обновление движка»), чтобы ставить задачи в очередь.")}
        </div>
      )}
      {footerNote && (
        <div className="mt-3 text-xs text-muted-foreground">{footerNote}</div>
      )}
    </div>
  );
}
