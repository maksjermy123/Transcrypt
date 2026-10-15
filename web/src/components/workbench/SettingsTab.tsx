"use client";

/**
 * Вкладка «Настройки» — веб-порт settings_tab.py из десктопа.
 *
 * Разделы:
 *  - Железо браузера: CPU-ядра, RAM, WebGPU, рекомендованное число потоков
 *    (логика runtime.py: резервируем 25% под систему)
 *  - Локальный движок: статус, платформа, ffmpeg/ffprobe/LibreOffice,
 *    устройство Whisper, кнопки установки/удаления (через онбординг)
 *  - Модели Whisper: 5 уровней, статус кеша браузера
 *  - Перевод: провайдер по умолчанию + ключ DeepL
 *  - Удаление Transcrypt: команда полного удаления с компьютера + очистка браузера
 *  - Сброс: онбординг заново / очистка настроек
 */

import { useEffect, useState } from "react";
import {
  Cpu,
  Server,
  BookOpen,
  Languages,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Trash2,
  Monitor,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Wrench,
  ShieldAlert,
  Copy,
  Check,
  Globe,
} from "lucide-react";
import { useOnboarding, MODEL_INFO, isBrowserModel, type WhisperModelId } from "@/lib/onboarding-store";
import { useSettings } from "@/lib/settings-store";
import { checkEngineHealth, type EngineHealth } from "@/lib/engine-bridge";
import { detectHardware, detectWebGPU, isModelCached } from "@/lib/whisper";
import { recommendedThreads } from "@/lib/onboarding-store";

const ALL_MODELS: WhisperModelId[] = ["tiny", "base", "small", "medium", "large-v3"];

export function SettingsTab({ onInstallEngine }: { onInstallEngine: () => void }) {
  const {
    selectedModel,
    setSelectedModel,
    engineServerOnline,
    reset,
    setStep,
  } = useOnboarding();
  const { provider, setProvider, deeplKey, setDeeplKey, pdfMode, setPdfMode } = useSettings();

  const [hardware, setHardware] = useState<{
    cpuCores: number;
    deviceMemory: number | null;
    webgpu: boolean;
    platform: string;
  } | null>(null);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [cacheStatus, setCacheStatus] = useState<Record<string, boolean | "checking">>({});
  const [showKey, setShowKey] = useState(false);

  // ─── Удаление Transcrypt: команда под ОС + очистка браузера ───
  const REPO_RAW = "https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install";
  const detectedOS = (() => {
    const sysName = health?.system_name || "";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (sysName === "Windows" || /Win/.test(ua)) {
      return {
        label: "Windows",
        command: `powershell -c "irm ${REPO_RAW}/uninstall-win.ps1 | iex"`,
      };
    }
    if (sysName === "Linux" || /Linux/.test(ua)) {
      return {
        label: "Linux",
        command: `bash -c "$(curl -fsSL ${REPO_RAW}/uninstall-linux.sh)"`,
      };
    }
    return {
      label: "macOS",
      command: `bash -c "$(curl -fsSL ${REPO_RAW}/uninstall-mac.command)"`,
    };
  })();
  const [copiedCmd, setCopiedCmd] = useState(false);

  async function copyUninstallCommand() {
    try {
      await navigator.clipboard.writeText(detectedOS.command);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = detectedOS.command;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  }

  /** Полная очистка данных программы в этом браузере:
   *  localStorage (онбординг, настройки, результаты, активная задача),
   *  Cache API (модели браузерного Whisper transformers.js), IndexedDB. */
  async function clearBrowserData() {
    const ok = confirm(
      "Удалить все данные Transcrypt из этого браузера?\n\n" +
      "· Кеш моделей браузерного Whisper\n" +
      "· Настройки и онбординг (пройдёте гайд заново)\n" +
      "· Историю результатов и активные задачи\n\n" +
      "Данные на компьютере (движок) не трогаются — для них есть команда Шага 1."
    );
    if (!ok) return;
    try {
      // localStorage: ключи Transcrypt
      const keys = Object.keys(localStorage).filter(
        (k) => k.startsWith("transcrypt") || k === "mockEngine.jobs"
      );
      keys.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    try {
      // Cache API: модели transformers.js и прочие кеши
      if (typeof caches !== "undefined") {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    } catch { /* ignore */ }
    try {
      // IndexedDB (если использовался)
      if (typeof indexedDB !== "undefined" && indexedDB.databases) {
        const dbs = await indexedDB.databases();
        dbs.forEach((d) => d.name && indexedDB.deleteDatabase(d.name));
      }
    } catch { /* ignore */ }
    alert("Данные браузера очищены. Страница перезагрузится — вы увидите приветственный гайд.");
    window.location.reload();
  }

  // Определение железа
  useEffect(() => {
    const hw = detectHardware();
    detectWebGPU().then((webgpu) => {
      setHardware({
        cpuCores: hw.cpuCores,
        deviceMemory: hw.deviceMemory,
        webgpu,
        platform: hw.platform,
      });
    });
  }, []);

  // Диагностика движка (запрос только когда движок online)
  useEffect(() => {
    if (!engineServerOnline) return;
    let cancelled = false;
    checkEngineHealth().then((h) => {
      if (!cancelled) setHealth(h);
    });
    return () => {
      cancelled = true;
    };
  }, [engineServerOnline]);

  // Статус кеша моделей браузера
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const status: Record<string, boolean | "checking"> = {};
      for (const m of ALL_MODELS) {
        if (!isBrowserModel(m)) {
          status[m] = false;
          continue;
        }
        status[m] = "checking";
        setCacheStatus({ ...status });
        status[m] = await isModelCached(m);
        setCacheStatus({ ...status });
      }
    }
    void check();
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, []);

  const threads = hardware ? recommendedThreads(hardware.cpuCores) : null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center flex-shrink-0">
          <Wrench className="w-5 h-5 text-[#7c5bf5]" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Настройки</h2>
          <p className="text-sm text-muted-foreground">
            Железо, движок, модели и переводчик — всё под вашим контролем.
          </p>
        </div>
      </div>

      {/* ─── Железо браузера ─── */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[#7c5bf5]" /> Железо вашего компьютера
        </h3>
        {!hardware ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Определяем…
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">CPU-ядра</div>
              <div className="text-lg font-bold">{hardware.cpuCores}</div>
            </div>
            <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">Потоки Whisper</div>
              <div className="text-lg font-bold">{threads ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">резерв 25% под систему</div>
            </div>
            <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">RAM (доступно браузеру)</div>
              <div className="text-lg font-bold">
                {hardware.deviceMemory ? `≤ ${hardware.deviceMemory} ГБ` : "не сообщается"}
              </div>
            </div>
            <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">WebGPU</div>
              <div className="text-lg font-bold flex items-center gap-1.5">
                {hardware.webgpu ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" /> доступен
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-amber-400" /> нет — WASM
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
          <Monitor className="w-3 h-3" />
          Платформа: {hardware?.platform || "—"} · Вся обработка идёт локально, данные не покидают компьютер
        </p>
      </section>

      {/* ─── Локальный движок ─── */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Server className="w-4 h-4 text-[#7c5bf5]" /> Локальный движок
          </h3>
          <span
            className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
              engineServerOnline
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-amber-500/10 text-amber-400"
            }`}
          >
            {engineServerOnline ? "Online · 127.0.0.1:8765" : "Не запущен"}
          </span>
        </div>

        {engineServerOnline && health ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <DiagItem label="Версия" value={health.version || "1.0.0"} />
            <DiagItem label="Платформа" value={health.system_name || health.platform || "—"} />
            <DiagItem label="Устройство Whisper" value={health.device || "Auto"} />
            <DiagItem label="CPU-потоки" value={String(health.recommended_threads ?? "—")} />
            <DiagItem label="FFmpeg" value={health.ffmpeg ? "найден" : "не найден"} ok={health.ffmpeg} />
            <DiagItem label="FFprobe" value={health.ffprobe ? "найден" : "не найден"} ok={health.ffprobe} />
            <DiagItem
              label="LibreOffice"
              value={health.libreoffice ? "найден" : "не нужен (PDF работает в браузере)"}
              ok={health.libreoffice}
            />
            <DiagItem
              label="Модели движка"
              value={(health.whisper_models ?? []).length ? `${(health.whisper_models ?? []).length} уровней` : "—"}
            />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>
              Локальный движок открывает URL-задачи (YouTube/TikTok), нативный Whisper и
              ffmpeg-операции. Браузер сам находит его при каждом открытии страницы —
              достаточно один раз установить.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onInstallEngine}
                className="bg-gradient-primary text-white px-4 py-2 rounded-xl text-xs font-semibold hover:opacity-90 inline-flex items-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                Установить движок (1 команда)
              </button>
              {engineServerOnline && (
                <button
                  onClick={() => setStep("engine")}
                  className="text-red-400/80 hover:text-red-400 text-xs px-3 py-2 rounded-xl border border-red-500/20 hover:border-red-500/40 inline-flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Удалить движок
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ─── Модели Whisper ─── */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[#7c5bf5]" /> Модели Whisper
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Активная модель: <b className="text-foreground">{MODEL_INFO[selectedModel ?? "base"].name}</b>.
          Браузерный кеш — модель скачивается один раз и мгновенно подхватывается при следующих открытиях.
        </p>
        <div className="space-y-2">
          {ALL_MODELS.map((m) => {
            const info = MODEL_INFO[m];
            const browserCapable = isBrowserModel(m);
            const cached = cacheStatus[m];
            const active = selectedModel === m;
            return (
              <div
                key={m}
                className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors ${
                  active
                    ? "border-[#7c5bf5]/50 bg-[#7c5bf5]/10"
                    : "border-[#263147]/60 bg-[#0b0f19]/60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{info.name}</span>
                    {active && (
                      <span className="text-[10px] bg-[#7c5bf5] text-white px-1.5 py-0.5 rounded-md font-semibold">
                        АКТИВНА
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {browserCapable
                      ? `Браузер: ~${info.sizeMB} МБ · Движок: ~${info.engineSizeMB} МБ · RAM: ${info.ramGB} ГБ`
                      : `Только движок: ~${info.engineSizeMB} МБ · RAM: ${info.ramGB} ГБ`}
                    {" · "}
                    {info.speed}
                  </div>
                </div>
                <div className="text-xs flex-shrink-0">
                  {!browserCapable ? (
                    <span className="text-muted-foreground">кеш: движок</span>
                  ) : cached === "checking" ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> проверка…
                    </span>
                  ) : cached ? (
                    <span className="text-emerald-400 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> в кеше браузера
                    </span>
                  ) : (
                    <span className="text-muted-foreground">не кеширована</span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedModel(m)}
                  disabled={active}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium flex-shrink-0 ${
                    active
                      ? "opacity-40 cursor-default text-muted-foreground"
                      : "bg-[#1b2334] hover:bg-[#232c40] border border-[#263147]"
                  }`}
                >
                  {active ? "Выбрана" : "Выбрать"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Перевод ─── */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Languages className="w-4 h-4 text-[#7c5bf5]" /> Перевод
        </h3>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-muted-foreground w-40">Провайдер:</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "google" | "deepl")}
              className="bg-[#1b2334] border border-[#263147] rounded-lg px-3 py-2 text-sm"
            >
              <option value="google">Google (бесплатно, без ключа)</option>
              <option value="deepl">DeepL (нужен API-ключ)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-muted-foreground w-40">PDF режим:</label>
            <select
              value={pdfMode}
              onChange={(e) => setPdfMode(e.target.value as "LAYOUT" | "FAST")}
              className="bg-[#1b2334] border border-[#263147] rounded-lg px-3 py-2 text-sm"
            >
              <option value="LAYOUT">LAYOUT — сохраняет картинки и разметку</option>
              <option value="FAST">FAST — только текст</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-muted-foreground w-40 inline-flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> DeepL API-ключ:
            </label>
            <div className="relative flex-1 min-w-[220px]">
              <input
                type={showKey ? "text" : "password"}
                value={deeplKey}
                onChange={(e) => setDeeplKey(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                className="w-full bg-[#1b2334] border border-[#263147] rounded-lg px-3 py-2 pr-10 text-sm"
              />
              <button
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                type="button"
                title={showKey ? "Скрыть ключ" : "Показать ключ"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              хранится только в вашем браузере (localStorage)
            </span>
          </div>
        </div>
      </section>

      {/* ─── Удаление Transcrypt с компьютера ─── */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2 text-red-300/90">
          <ShieldAlert className="w-4 h-4" /> Удаление Transcrypt
        </h3>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="mb-2">
              <strong className="text-foreground">Шаг 1 — команда на компьютере</strong> удаляет всё, что
              создавала программа: папку движка <code className="px-1 rounded bg-[#1b2334] font-mono">~/.transcrypt-engine</code> (venv, код, логи),
              автозапуск, модели Whisper, скачанный ffmpeg и результаты задач. Освободившееся место покажет сам скрипт.
            </p>
            <p>
              <strong className="text-foreground">Шаг 2 — кнопка ниже</strong> чистит данные в этом браузере:
              кеш моделей браузерного Whisper, настройки онбординга, историю результатов.
            </p>
          </div>

          <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                Команда полного удаления ({detectedOS.label}) — выполните в Терминале
              </span>
              <button
                onClick={() => copyUninstallCommand()}
                className="px-2.5 py-1 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
              >
                {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCmd ? "Скопировано" : "Копировать"}
              </button>
            </div>
            <code className="block text-[11px] font-mono text-emerald-300/90 break-all leading-relaxed select-all">
              {detectedOS.command}
            </code>
          </div>

          <button
            onClick={clearBrowserData}
            className="text-xs px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 inline-flex items-center gap-2 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Шаг 2 · Очистить данные в браузере
          </button>
        </div>
      </section>

      {/* ─── Опасная зона ─── */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <h3 className="font-semibold text-sm mb-3 text-red-300/90">Сброс</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (confirm("Пройти онбординг заново? Выбранная модель и настройки переводчика сохранятся.")) {
                reset();
              }
            }}
            className="text-xs px-4 py-2 rounded-xl bg-[#1b2334] hover:bg-[#232c40] border border-[#263147] inline-flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Онбординг заново
          </button>
          <button
            onClick={() => {
              if (confirm("Сбросить настройки переводчика (провайдер, ключ DeepL, PDF режим)?")) {
                useSettings.setState({
                  provider: "google",
                  deeplKey: "",
                  defaultTargetLang: "ru",
                  pdfMode: "LAYOUT",
                });
              }
            }}
            className="text-xs px-4 py-2 rounded-xl bg-[#1b2334] hover:bg-[#232c40] border border-[#263147] inline-flex items-center gap-2"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Сбросить настройки переводчика
          </button>
        </div>
      </section>
    </div>
  );
}

function DiagItem({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm font-medium flex items-center gap-1.5">
        {ok === true && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
        {ok === false && <XCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
        {value}
      </div>
    </div>
  );
}
