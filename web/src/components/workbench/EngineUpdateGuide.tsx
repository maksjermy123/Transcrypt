"use client";

/**
 * Баннер «Движок устарел» + раскрывающаяся инструкция обновления на месте.
 *
 * Ключевая идея (по отзыву пользователя): кнопка на баннере НЕ должна уводить
 * в настройки/онбординг — она раскрывает прямо здесь пошаговую инструкцию
 * с командой установки под ОС пользователя и кнопкой копирования.
 *
 * Используется в TranscribeTab / MediaTab / ConvertTab (баннер) и в SettingsTab
 * (embedded — без баннера, как постоянный раздел «Обновление движка»).
 */

import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Check,
  Terminal,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { EngineHealth } from "@/lib/engine-bridge";

/** Последняя версия движка, которую поддерживает сайт (health: jobs + queue). */
export const LATEST_ENGINE_VERSION = "1.2.0";

export type EngineUpdateReason = "no-jobs" | "no-queue";

const REPO_RAW = "https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install";

interface OSInfo {
  label: string;
  terminal: string;
  openHint: string;
  command: string;
}

/** ОС пользователя: сначала health движка (авторитетно), потом userAgent. */
function detectOS(health: EngineHealth | null): OSInfo {
  const sysName = (health?.system_name || "").toLowerCase();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const WIN: OSInfo = {
    label: "Windows",
    terminal: "PowerShell",
    openHint: "Win+R → введите «powershell» → Enter (НЕ обычный cmd)",
    command: `iwr -useb ${REPO_RAW}/install-win.ps1 | iex`,
  };
  const LINUX: OSInfo = {
    label: "Linux",
    terminal: "Терминал",
    openHint: "Ctrl+Alt+T в большинстве дистрибутивов",
    command: `bash -c "$(curl -fsSL ${REPO_RAW}/install-linux.sh)"`,
  };
  const MAC: OSInfo = {
    label: "macOS",
    terminal: "Терминал (Terminal.app)",
    openHint: "Cmd+Пробел → введите «Terminal» → Enter",
    command: `bash -c "$(curl -fsSL ${REPO_RAW}/install-mac.command)"`,
  };
  // health движка надёжнее UA (браузер может быть не той ОС, что движок)
  if (sysName) {
    if (sysName.includes("win")) return WIN;
    if (sysName.includes("linux")) return LINUX;
    if (sysName.includes("mac") || sysName.includes("darwin")) return MAC;
  }
  if (/Win/.test(ua)) return WIN;
  if (/Mac/.test(ua) && !/iPhone|iPad|Android/.test(ua)) return MAC;
  if (/Linux/.test(ua) && !/Android/.test(ua)) return LINUX;
  return MAC;
}

const REASONS: Record<
  EngineUpdateReason,
  {
    title: (v: string) => string;
    why: string;
    tone: "amber" | "sky";
  }
> = {
  "no-jobs": {
    title: (v) => `Движок ${v || "1.0.x"} — задачи не переживают переключение вкладок`,
    why: "Сейчас задача выполняется, только пока открыта вкладка. После обновления задачи идут в фоне на движке: результат ждёт вас даже после закрытия браузера.",
    tone: "amber",
  },
  "no-queue": {
    title: (v) => `Движок ${v || "1.1.0"} — без очереди задач`,
    why: "Задачи на разных вкладках мешают друг другу. После обновления лишние встанут в очередь, а на мощном компьютере тяжёлые пойдут параллельно — ни один результат не пропадёт.",
    tone: "sky",
  },
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

interface EngineUpdateGuideProps {
  reason: EngineUpdateReason;
  health: EngineHealth | null;
  /** Режим раздела в Настройках: без баннера-обёртки, инструкция всегда раскрыта. */
  embedded?: boolean;
}

export function EngineUpdateGuide({ reason, health, embedded = false }: EngineUpdateGuideProps) {
  const [open, setOpen] = useState(embedded);
  const [copied, setCopied] = useState(false);
  const os = detectOS(health);
  const cfg = REASONS[reason];

  async function handleCopy() {
    const ok = await copyText(os.command);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2000);
  }

  const steps: { title: string; detail: string }[] = [
    {
      title: "Скопируйте команду",
      detail: `Команда для ${os.label} — та же, что ставила движок в первый раз. Кнопка «Копировать» справа.`,
    },
    {
      title: `Откройте ${os.terminal}`,
      detail: os.openHint,
    },
    {
      title: "Вставьте команду и нажмите Enter",
      detail: "Установка обновит движок поверх старого и займёт 1–3 минуты: зависимости и модели уже на компьютере, скачивать почти ничего не придётся.",
    },
    {
      title: "Вернитесь на сайт",
      detail: "Баннер исчезнет сам в течение минуты — сайт проверяет движок автоматически. Если нет, обновите страницу (Cmd+Shift+R или Ctrl+F5).",
    },
  ];

  // ─── Раскрывающаяся инструкция ───
  const guide = (
    <div className="mt-3 rounded-xl border border-[#263147]/60 bg-[#0b0f19]/80 p-4">
      {/* Версия: текущая → целевая */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="text-muted-foreground">Обновление:</span>
        <code className="px-2 py-0.5 rounded-md bg-[#1b2334] font-mono text-amber-300">
          движок {health?.version || "1.0.x"}
        </code>
        <span className="text-muted-foreground">→</span>
        <code className="px-2 py-0.5 rounded-md bg-emerald-500/10 font-mono text-emerald-300">
          {LATEST_ENGINE_VERSION}
        </code>
      </div>

      {/* Шаги */}
      <ol className="space-y-2.5 mb-4">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-gradient-primary text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">{s.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* Команда */}
      <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5 min-w-0">
            <Terminal className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">
              Команда для {os.label} — выполните в {os.terminal}
            </span>
          </span>
          <button
            onClick={handleCopy}
            className="px-2.5 py-1 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
        <code className="block text-[11px] font-mono text-emerald-300/90 break-all leading-relaxed select-all">
          {os.command}
        </code>
      </div>

      {/* Заметки */}
      <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground leading-relaxed">
        <p className="flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
          Модели Whisper, настройки, история результатов и очередь задач сохраняются — удалять старый движок не нужно.
        </p>
        <p className="flex items-start gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
          Запускайте обновление, когда активные задачи завершены — установщик перезапускает движок.
        </p>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-1">{cfg.why}</p>
        {guide}
      </div>
    );
  }

  const tone =
    cfg.tone === "amber"
      ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
      : "border-sky-500/30 bg-sky-500/5 text-sky-200";
  const toneSub = cfg.tone === "amber" ? "text-amber-200/80" : "text-sky-200/80";

  return (
    <div className={`mb-5 p-3 rounded-xl border ${tone} text-sm flex items-start gap-3`}>
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{cfg.title(health?.version || "")}</p>
        <p className={`text-xs ${toneSub} mt-1 leading-relaxed`}>{cfg.why}</p>
        {open && guide}
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-gradient-primary text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-90 flex-shrink-0 inline-flex items-center gap-1.5 self-start"
      >
        {open ? "Скрыть инструкцию" : "Как обновить"}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}
