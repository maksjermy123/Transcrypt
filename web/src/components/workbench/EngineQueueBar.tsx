"use client";

/**
 * Глобальная панель очереди задач движка — видна НА ВСЕХ вкладках сайта.
 *
 * Проблема, которую решает: задача создаётся в одной вкладке (например,
 * конвертация в «Конвертере»), а пользователь в этот момент сидит в «Медиа» —
 * и видит в логе новой задачи только безликое «Движок занят другой задачей».
 * Найти виновника (какая вкладка, какой файл, сколько уже идёт) было негде.
 *
 * Панель опрашивает GET /api/jobs и показывает:
 *  — что выполняется прямо сейчас: раздел, файл, сколько минут идёт, %;
 *  — что стоит в очереди: раздел, файл, позиция;
 *  — кнопку «Отменить» для любой активной задачи — из любого раздела;
 *  — подсказку «не подаёт признаков жизни», если задача давно не двигается
 *    (зависший процесс больше не останется невидимым — его видно и можно
 *    отменить одним щелчком).
 *
 * Работает с любым движком с Job API (≥ 1.1.0): started_at берётся из снапшота
 * (движок ≥ 1.4.1), на старых — время считается от created_at.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Clock, Square, ListOrdered, AlertTriangle } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";
import { listEngineJobsFull, cancelJobById, type EngineJobState } from "@/lib/engine-bridge";

/** Раздел сайта, откуда пришла задача (для строки «Конвертер: файл.mp4»). */
function sectionOf(type: string | undefined, t: (k: string) => string): string {
  switch (type) {
    case "transcribe":
      return t("Транскрипция");
    case "media":
      return t("Медиа");
    case "convert":
      return t("Конвертер");
    default:
      return type || t("Задача");
  }
}

/** «идёт 12 мин» / «идёт 1 ч 03 мин» от started_at (или created_at на старых движках). */
function elapsedText(fromTs: number | undefined, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (!fromTs) return "";
  const sec = Math.max(0, Date.now() / 1000 - fromTs);
  if (sec < 60) return t("идёт меньше минуты");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("идёт {n} мин", { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return t("идёт {h} ч {m} мин", { h, m: m < 10 ? `0${m}` : m });
}

/** Сколько минут задача не подаёт признаков жизни (для подсказки о зависании). */
const STUCK_AFTER_MS = 10 * 60 * 1000;
/** Сигнатура «жизни» задачи: процент + размер лога + стадия. */
function lifeSignature(j: EngineJobState): string {
  const p = j.progress || {};
  return `${p.percent ?? 0}|${(p.log || []).length}|${p.stage ?? ""}`;
}

export function EngineQueueBar() {
  const { engineServerOnline } = useOnboarding();
  const { t } = useI18n();
  const [jobs, setJobs] = useState<EngineJobState[] | null>(null);
  const [unsupported, setUnsupported] = useState(false); // движок без Job API (≤ 1.0.x)
  const inFlight = useRef(false);
  // history of «жизни» задач: job_id → {sig, since} — для детекта зависания
  const life = useRef<Map<string, { sig: string; since: number }>>(new Map());
  const [now, setNow] = useState(() => Date.now()); // тик для пересчёта «идёт N мин»

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const list = await listEngineJobsFull();
      if (list === null) {
        // 404/офлайн: у старого движка Job API нет — панель не показываем никогда
        setUnsupported((prev) => prev || true);
      } else {
        setUnsupported(false);
        setJobs(list);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Опрос: пока движок online — раз в 3 c (в фоновой вкладке раз в 10 c).
  useEffect(() => {
    if (!engineServerOnline || unsupported) return;
    void refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    const slowInterval = setInterval(() => {
      if (document.visibilityState === "hidden") void refresh();
    }, 10000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      clearInterval(slowInterval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [engineServerOnline, unsupported, refresh]);

  // Тик каждые 10 c: пересчитать «идёт N мин» без лишних запросов
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(tick);
  }, []);

  const active = (jobs || []).filter(
    (j) => j.status === "running" || j.status === "queued"
  );
  const running = active.filter((j) => j.status === "running");
  const queued = active.filter((j) => j.status === "queued");

  // Детект зависания: сигнатура жизни не менялась дольше STUCK_AFTER_MS
  const stuckMins = new Map<string, number>();
  for (const j of running) {
    const sig = lifeSignature(j);
    const prev = life.current.get(j.job_id);
    if (!prev || prev.sig !== sig) {
      life.current.set(j.job_id, { sig, since: now });
    } else {
      const silentMs = now - prev.since;
      if (silentMs > STUCK_AFTER_MS) {
        stuckMins.set(j.job_id, Math.floor(silentMs / 60000));
      }
    }
  }
  // Подчищаем историю завершённых задач, чтобы Map не рос бесконечно
  if (jobs) {
    const alive = new Set(active.map((j) => j.job_id));
    for (const id of Array.from(life.current.keys())) {
      if (!alive.has(id)) life.current.delete(id);
    }
  }

  async function cancel(jobId: string) {
    await cancelJobById(jobId);
    void refresh();
  }

  if (!engineServerOnline || unsupported) return null;
  if (!jobs || active.length === 0) return null;

  return (
    <div className="bg-[#0e1424]/80 border-b border-[#263147]/60">
      <div className="max-w-7xl mx-auto px-6 py-2.5">
        <div className="flex items-start gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#8fa3c8] mt-0.5 flex-shrink-0">
            <ListOrdered className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t("Очередь движка")}</span>
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            {running.map((j) => {
              const p = j.progress || {};
              const percent = typeof p.percent === "number" ? Math.round(p.percent) : null;
              const stuck = stuckMins.get(j.job_id);
              return (
                <div key={j.job_id} className="flex items-center gap-2 text-sm min-w-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400 flex-shrink-0" />
                  <span className="truncate min-w-0">
                    <span className="font-medium">{sectionOf(j.type, t)}</span>
                    {j.label ? <span className="text-muted-foreground">: {j.label}</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                    {elapsedText(j.started_at || j.created_at, t)}
                  </span>
                  {percent !== null && percent > 0 && (
                    <span className="text-xs font-mono font-bold text-sky-400 flex-shrink-0">{percent}%</span>
                  )}
                  {stuck !== undefined && (
                    <span className="hidden lg:inline-flex items-center gap-1 text-xs text-amber-400 flex-shrink-0">
                      <AlertTriangle className="w-3 h-3" />
                      {t("не подаёт признаков жизни {n} мин — можно отменить и запустить заново", { n: stuck })}
                    </span>
                  )}
                  <button
                    onClick={() => void cancel(j.job_id)}
                    className="ml-auto px-2 py-0.5 rounded-md bg-[#1b2334] hover:bg-[#263147] text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors flex-shrink-0"
                    title={t("Отменить задачу — можно из любого раздела")}
                  >
                    <Square className="w-2.5 h-2.5" />
                    {t("Отменить")}
                  </button>
                </div>
              );
            })}
            {queued.map((j) => (
              <div key={j.job_id} className="flex items-center gap-2 text-sm min-w-0 opacity-80">
                <Clock className="w-3.5 h-3.5 text-[#8fa3c8] flex-shrink-0" />
                <span className="truncate min-w-0">
                  <span className="font-medium">{sectionOf(j.type, t)}</span>
                  {j.label ? <span className="text-muted-foreground">: {j.label}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                  {typeof j.queue_position === "number" && j.queue_position > 1
                    ? t("В очереди — впереди ещё {n}", { n: j.queue_position - 1 })
                    : t("В очереди")}
                </span>
                <button
                  onClick={() => void cancel(j.job_id)}
                  className="ml-auto px-2 py-0.5 rounded-md bg-[#1b2334] hover:bg-[#263147] text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors flex-shrink-0"
                  title={t("Убрать из очереди")}
                >
                  <Square className="w-2.5 h-2.5" />
                  {t("Отменить")}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
