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
import { useI18n, type Lang } from "@/lib/i18n";

/** Последняя версия движка, которую поддерживает сайт. */
export const LATEST_ENGINE_VERSION = "1.3.3";

export type EngineUpdateReason = "no-jobs" | "no-queue" | "no-docs" | "outdated";

/**
 * Истинно, если версия движка в health ниже поддерживаемой сайтом.
 * Используется для баннера «outdated» — движок работает, но без свежих фиксов
 * (например, до 1.2.1 не скачивались файлы с кириллическими именами).
 */
export function isEngineOutdated(health: EngineHealth | null): boolean {
  const cur = (health?.version || "").trim();
  if (!cur) return false;
  const parse = (s: string) => s.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const a = parse(cur);
  const b = parse(LATEST_ENGINE_VERSION);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

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
    // Окно PowerShell больше не схлопывается: скачиваем файл и запускаем
    // с -NoExit — даже при ошибке консоль остаётся открытой, а Python
    // установится автоматически (winget/python.org), если его не было.
    command: `iwr -useb ${REPO_RAW}/install-win.ps1 -OutFile "$env:TEMP\\vpai-install.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "$env:TEMP\\vpai-install.ps1"`,
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
  "no-docs": {
    title: (v) => `Движок ${v || "1.2.x"} — без конвертации документов (Word ↔ PDF)`,
    why: "Конвертация Word ↔ PDF ↔ TXT и исправление «крякозябр» в кодировках появились в движке 1.3.0 — в старом окружении нет нужных библиотек, поэтому вкладка «Конвертер → Документы» даёт ошибки. Обновите движок той же командой установки — займёт 1–3 минуты, модели Whisper сохранятся.",
    tone: "sky",
  },
  outdated: {
    title: (v) => `Движок ${v || "1.2.0"} — доступно обновление до ${LATEST_ENGINE_VERSION}`,
    why: `В ${LATEST_ENGINE_VERSION} исправлено скачивание с YouTube: ошибка теперь показывает реальную причину, добавлены резервные способы скачивания (клиенты tv/web_safari и cookies из браузера) и retry пауза при HTTP 429; yt-dlp обновлён до 2026.8.19. Обновите движок той же командой установки — займёт 1–3 минуты.`,
    tone: "sky",
  },
};

/** EN-заголовки баннеров (динамика с версией — отдельные шаблоны) */
const TITLES_EN: Record<EngineUpdateReason, (v: string) => string> = {
  "no-jobs": (v) => `Engine ${v || "1.0.x"} — jobs don't survive tab switches`,
  "no-queue": (v) => `Engine ${v || "1.1.0"} — no job queue`,
  "no-docs": (v) => `Engine ${v || "1.2.x"} — no document conversion (Word ↔ PDF)`,
  outdated: (v) => `Engine ${v || "1.2.0"} — update to ${LATEST_ENGINE_VERSION} available`,
};

/** EN-тексты «почему» */
const WHY_EN: Record<EngineUpdateReason, string> = {
  "no-jobs":
    "Right now a job runs only while the tab is open. After the update, jobs run in the background on the engine: the result waits for you even after you close the browser.",
  "no-queue":
    "Jobs from different tabs fight each other. After the update, extra jobs queue up, and on a powerful machine heavy ones run in parallel — no result is lost.",
  "no-docs":
    "Word ↔ PDF ↔ TXT conversion and encoding fixes (no more mojibake) arrived in engine 1.3.0 — the old environment lacks the required libraries, so the Converter → Documents tab fails. Update the engine with the same install command — takes 1–3 minutes, Whisper models are kept.",
  outdated: `Engine ${LATEST_ENGINE_VERSION} fixes YouTube downloads: the error now shows the real cause, new fallback methods (tv/web_safari clients and cookies from your browser) and a retry pause on HTTP 429 were added; yt-dlp updated to 2026.8.19. Update with the same install command — takes 1–3 minutes.`,
};

function bannerTitle(reason: EngineUpdateReason, version: string, lang: Lang): string {
  return lang === "en"
    ? TITLES_EN[reason](version)
    : REASONS[reason].title(version);
}

function bannerWhy(reason: EngineUpdateReason, lang: Lang): string {
  return lang === "en" ? WHY_EN[reason] : REASONS[reason].why;
}

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
  const { t, lang } = useI18n();
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
        <p className="text-xs text-muted-foreground leading-relaxed mb-1">{bannerWhy(reason, lang)}</p>
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
        <p className="font-medium">{bannerTitle(reason, health?.version || "", lang)}</p>
        <p className={`text-xs ${toneSub} mt-1 leading-relaxed`}>{bannerWhy(reason, lang)}</p>
        {open && guide}
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-gradient-primary text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:opacity-90 flex-shrink-0 inline-flex items-center gap-1.5 self-start"
      >
        {open ? t("Скрыть инструкцию") : t("Как обновить")}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}
