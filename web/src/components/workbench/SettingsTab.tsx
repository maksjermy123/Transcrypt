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
 *  - Удаление VoxPaperAi: команда полного удаления с компьютера + очистка браузера
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
  Home,
} from "lucide-react";
import { useOnboarding, MODEL_INFO, isBrowserModel, type WhisperModelId } from "@/lib/onboarding-store";
import { useSettings } from "@/lib/settings-store";
import { checkEngineHealth, updateEngineYtDlp, fetchLatestYtDlpVersion, compareYtDlpVersions, type EngineHealth } from "@/lib/engine-bridge";
import { EngineUpdateGuide, isEngineOutdated } from "@/components/workbench/EngineUpdateGuide";
import { detectHardware, detectWebGPU, isModelCached } from "@/lib/whisper";
import { recommendedThreads } from "@/lib/onboarding-store";
import { useI18n } from "@/lib/i18n";

const ALL_MODELS: WhisperModelId[] = ["tiny", "base", "small", "medium", "large-v3"];

export function SettingsTab({
  onInstallEngine,
  onGoHome,
}: {
  onInstallEngine: () => void;
  /** Кнопка «На стартовую страницу» — переход к приветствию/онбордингу. */
  onGoHome?: () => void;
}) {
  const { t } = useI18n();
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

  // ─── Обновление yt-dlp одной кнопкой (движок ≥ 1.3.6) ───
  const [ytdlpLatest, setYtdlpLatest] = useState<string | null>(null);
  const [ytdlpState, setYtdlpState] = useState<"idle" | "updating" | "done" | "error">("idle");
  const [ytdlpResult, setYtdlpResult] = useState<{ upgraded: boolean; oldVersion: string; newVersion: string; message: string } | null>(null);

  async function handleUpdateYtDlp() {
    setYtdlpState("updating");
    setYtdlpResult(null);
    const res = await updateEngineYtDlp();
    if (!res.ok) {
      setYtdlpResult({ upgraded: false, oldVersion: "", newVersion: "", message: res.message });
      setYtdlpState("error");
      return;
    }
    setYtdlpResult({ upgraded: res.upgraded, oldVersion: res.oldVersion, newVersion: res.newVersion, message: "" });
    setYtdlpState("done");
    if (res.upgraded && res.restarting) {
      // Движок перезапускается сам — через несколько секунд диагностика покажет новую версию
      setTimeout(async () => {
        const h = await checkEngineHealth();
        if (h) setHealth(h);
      }, 6000);
    }
  }

  // ─── Удаление VoxPaperAi: команда под ОС + очистка браузера ───
  const REPO_RAW = "https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install";
  const detectedOS = (() => {
    const sysName = health?.system_name || "";
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    if (sysName === "Windows" || /Win/.test(ua)) {
      return {
        label: "Windows",
        // -NoExit: окно не закроется, пользователь увидит результат удаления
        command: `iwr -useb ${REPO_RAW}/uninstall-win.ps1 -OutFile "$env:TEMP\\vpai-uninstall.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "$env:TEMP\\vpai-uninstall.ps1"`,
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
      t(
        "Удалить все данные VoxPaperAi из этого браузера?\n\n" +
        "· Кеш моделей браузерного Whisper\n" +
        "· Настройки и онбординг (пройдёте гайд заново)\n" +
        "· Историю результатов и активные задачи\n\n" +
        "Данные на компьютере (движок) не трогаются — для них есть команда Шага 1."
      )
    );
    if (!ok) return;
    try {
      // localStorage: ключи VoxPaperAi (технические ключи transcrypt-* сохранены)
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
    // Последняя версия yt-dlp на PyPI — для бейджа «доступна обновление».
    // При ошибке (нет сети/блокировка) — просто без бейджа, кнопка работает и так.
    fetchLatestYtDlpVersion().then((v) => {
      if (!cancelled && v) setYtdlpLatest(v);
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
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{t("Настройки")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Железо, движок, модели и переводчик — всё под вашим контролем.")} </p>
        </div>
        {/* Кнопка возврата на стартовую страницу (раньше был домик в шапке сайта) */}
        {onGoHome && (
          <button
            onClick={onGoHome}
            className="flex-shrink-0 text-xs px-4 py-2 rounded-xl bg-[#1b2334] hover:bg-[#232c40] border border-[#263147] text-muted-foreground hover:text-foreground inline-flex items-center gap-2 transition-colors"
            title={t("Вернуться на стартовую страницу — приветствие и выбор режима")}
          >
            <Home className="w-4 h-4" />
            {t("На стартовую страницу")}
          </button>
        )}
      </div>

      {/* ─── Железо браузера ─── */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[#7c5bf5]" />  {t("Железо вашего компьютера")} </h3>
        {!hardware ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />  {t("Определяем…")} </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">{t("CPU-ядра")}</div>
              <div className="text-lg font-bold">{hardware.cpuCores}</div>
            </div>
            <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">{t("Потоки Whisper")}</div>
              <div className="text-lg font-bold">{threads ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">{t("резерв 25% под систему")}</div>
            </div>
            <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">{t("RAM (доступно браузеру)")}</div>
              <div className="text-lg font-bold">
                {hardware.deviceMemory ? `≤ ${hardware.deviceMemory} ГБ` : t("не сообщается")}
              </div>
            </div>
            <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">WebGPU</div>
              <div className="text-lg font-bold flex items-center gap-1.5">
                {hardware.webgpu ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />  {t("доступен")} </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-amber-400" />  {t("нет — WASM")} </>
                )}
              </div>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
          <Monitor className="w-3 h-3" />
          {t("Платформа:")} {hardware?.platform || "—"}  {t("· Вся обработка идёт локально, данные не покидают компьютер")} </p>
      </section>

      {/* ─── Локальный движок ─── */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Server className="w-4 h-4 text-[#7c5bf5]" />  {t("Локальный движок")} </h3>
          <span
            className={`text-xs px-2.5 py-1 rounded-lg font-medium ${
              engineServerOnline
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-amber-500/10 text-amber-400"
            }`}
          >
            {engineServerOnline ? "Online · 127.0.0.1:8765" : t("Не запущен")}
          </span>
        </div>

        {engineServerOnline && health ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <DiagItem label={t("Версия")} value={health.version || "1.0.0"} />
              <DiagItem label={t("Платформа")} value={health.system_name || health.platform || "—"} />
              <DiagItem label={t("Устройство Whisper")} value={health.device || "Auto"} />
              <DiagItem label={t("CPU-потоки")} value={String(health.recommended_threads ?? "—")} />
              <DiagItem label="FFmpeg" value={health.ffmpeg ? t("найден") : t("не найден")} ok={health.ffmpeg} />
              <DiagItem label="FFprobe" value={health.ffprobe ? t("найден") : t("не найден")} ok={health.ffprobe} />
            <DiagItem
              label="LibreOffice"
              value={health.libreoffice ? t("найден") : t("не нужен (PDF работает в браузере)")}
              ok={health.libreoffice}
            />
            <DiagItem
              label={t("Модели движка")}
              value={(health.whisper_models ?? []).length ? t("{n} уровней", { n: (health.whisper_models ?? []).length }) : "—"}
            />
            <DiagItem
              label="yt-dlp"
              value={health.ytdlp || "—"}
              ok={ytdlpLatest ? compareYtDlpVersions(ytdlpLatest, health.ytdlp || "") <= 0 : undefined}
            />
            </div>

            {/* Обновление yt-dlp одной кнопкой — без PowerShell/терминала (движок ≥ 1.3.6) */}
            {health.ytdlp && (
              <div className="mt-4 rounded-xl border border-[#263147]/60 bg-[#0b0f19]/40 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs min-w-0">
                    <p className="font-semibold mb-0.5">{t("yt-dlp — загрузчик видео (YouTube и др.)")}</p>
                    {ytdlpState === "done" && ytdlpResult?.upgraded ? (
                      <p className="text-emerald-400">
                        {t("Обновлено: {a} → {b}. Движок перезапускается — через несколько секунд снова online.", { a: ytdlpResult.oldVersion, b: ytdlpResult.newVersion })}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        {t("Установлена версия")} {health.ytdlp}
                        {ytdlpLatest && compareYtDlpVersions(ytdlpLatest, health.ytdlp) > 0
                          ? ` · ${t("доступна")} ${ytdlpLatest}`
                          : ytdlpLatest
                            ? ` · ${t("актуальная")}`
                            : ""}
                      </p>
                    )}
                    {ytdlpState === "error" && ytdlpResult?.message && (
                      <p className="mt-2 text-red-400 whitespace-pre-line">{ytdlpResult.message}</p>
                    )}
                  </div>
                  <button
                    onClick={handleUpdateYtDlp}
                    disabled={ytdlpState === "updating"}
                    className="flex-shrink-0 text-xs px-4 py-2 rounded-xl font-medium inline-flex items-center gap-2 border border-[#7c5bf5]/40 text-[#cfc2ff] hover:bg-[#7c5bf5]/10 disabled:opacity-60 disabled:cursor-wait transition-colors"
                  >
                    {ytdlpState === "updating" ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t("Обновляем… до минуты")}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        {t("Обновить yt-dlp")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Движок отстаёт от сайта — постоянное место инструкции обновления */}
            {(!health.jobs || !health.queue || health.docs === false || isEngineOutdated(health)) && (
              <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
                <p className="text-xs font-semibold text-sky-200 mb-2">{t("Доступно обновление движка")}</p>
                <EngineUpdateGuide
                  embedded
                  reason={
                    !health.jobs
                      ? "no-jobs"
                      : !health.queue
                        ? "no-queue"
                        : health.docs === false
                          ? "no-docs"
                          : "outdated"
                  }
                  health={health}
                />
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>
              {t("Локальный движок открывает URL-задачи (YouTube/TikTok), нативный Whisper и ffmpeg-операции. Браузер сам находит его при каждом открытии страницы — достаточно один раз установить.")} </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={onInstallEngine}
                className="bg-gradient-primary text-white px-4 py-2 rounded-xl text-xs font-semibold hover:opacity-90 inline-flex items-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                {t("Установить движок (1 команда)")} </button>
              {engineServerOnline && (
                <button
                  onClick={() => setStep("engine")}
                  className="text-red-400/80 hover:text-red-400 text-xs px-3 py-2 rounded-xl border border-red-500/20 hover:border-red-500/40 inline-flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("Удалить движок")} </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ─── Модели Whisper ─── */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[#7c5bf5]" />  {t("Модели Whisper")} </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("Активная модель:")} <b className="text-foreground">{MODEL_INFO[selectedModel ?? "base"].name}</b>{t(". Браузерный кеш — модель скачивается один раз и мгновенно подхватывается при следующих открытиях.")} </p>
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
                        {t("АКТИВНА")} </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {browserCapable
                      ? t("Браузер: ~{a} МБ · Движок: ~{b} МБ · RAM: {c} ГБ", { a: info.sizeMB, b: info.engineSizeMB, c: info.ramGB })
                      : t("Только движок: ~{b} МБ · RAM: {c} ГБ", { b: info.engineSizeMB, c: info.ramGB })}
                    {" · "}
                    {info.speed}
                  </div>
                </div>
                <div className="text-xs flex-shrink-0">
                  {!browserCapable ? (
                    <span className="text-muted-foreground">{t("кеш: движок")}</span>
                  ) : cached === "checking" ? (
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />  {t("проверка…")} </span>
                  ) : cached ? (
                    <span className="text-emerald-400 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />  {t("в кеше браузера")} </span>
                  ) : (
                    <span className="text-muted-foreground">{t("не кеширована")}</span>
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
                  {active ? t("Выбрана") : t("Выбрать")}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Перевод ─── */}
      <section className="rounded-2xl border border-[#263147]/60 bg-[#111827]/40 p-5">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Languages className="w-4 h-4 text-[#7c5bf5]" />  {t("Перевод")} </h3>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-muted-foreground w-40">{t("Провайдер:")}</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "google" | "deepl")}
              className="bg-[#1b2334] border border-[#263147] rounded-lg px-3 py-2 text-sm"
            >
              <option value="google">{t("Google (бесплатно, без ключа)")}</option>
              <option value="deepl">{t("DeepL (нужен API-ключ)")}</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-muted-foreground w-40">{t("PDF режим:")}</label>
            <select
              value={pdfMode}
              onChange={(e) => setPdfMode(e.target.value as "LAYOUT" | "FAST")}
              className="bg-[#1b2334] border border-[#263147] rounded-lg px-3 py-2 text-sm"
            >
              <option value="LAYOUT">{t("LAYOUT — сохраняет картинки и разметку")}</option>
              <option value="FAST">{t("FAST — только текст")}</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-muted-foreground w-40 inline-flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />  {t("DeepL API-ключ:")} </label>
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
                title={showKey ? t("Скрыть ключ") : t("Показать ключ")}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("хранится только в вашем браузере (localStorage)")} </span>
          </div>
        </div>
      </section>

      {/* ─── Удаление VoxPaperAi с компьютера ─── */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2 text-red-300/90">
          <ShieldAlert className="w-4 h-4" />  {t("Удаление VoxPaperAi")} </h3>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground leading-relaxed">
            <p className="mb-2">
              <strong className="text-foreground">{t("Шаг 1 — команда на компьютере")}</strong>  {t("удаляет всё, что создавала программа: папку движка")} <code className="px-1 rounded bg-[#1b2334] font-mono">~/.transcrypt-engine</code>  {t("(venv, код, логи), автозапуск, модели Whisper, скачанный ffmpeg и результаты задач. Освободившееся место покажет сам скрипт.")} </p>
            <p>
              <strong className="text-foreground">{t("Шаг 2 — кнопка ниже")}</strong>  {t("чистит данные в этом браузере: кеш моделей браузерного Whisper, настройки онбординга, историю результатов.")} </p>
          </div>

          <div className="rounded-xl bg-[#0b0f19] border border-[#263147]/60 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                {t("Команда полного удаления (")}{detectedOS.label}{t(") — выполните в Терминале")} </span>
              <button
                onClick={() => copyUninstallCommand()}
                className="px-2.5 py-1 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
              >
                {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCmd ? t("Скопировано") : t("Копировать")}
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
            {t("Шаг 2 · Очистить данные в браузере")} </button>
        </div>
      </section>

      {/* ─── Опасная зона ─── */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
        <h3 className="font-semibold text-sm mb-3 text-red-300/90">{t("Сброс")}</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (confirm(t("Пройти онбординг заново? Выбранная модель и настройки переводчика сохранятся."))) {
                reset();
              }
            }}
            className="text-xs px-4 py-2 rounded-xl bg-[#1b2334] hover:bg-[#232c40] border border-[#263147] inline-flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("Онбординг заново")} </button>
          <button
            onClick={() => {
              if (confirm(t("Сбросить настройки переводчика (провайдер, ключ DeepL, PDF режим)?"))) {
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
            {t("Сбросить настройки переводчика")} </button>
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
