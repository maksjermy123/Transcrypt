"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Server,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowRight,
  Terminal,
  Clipboard,
  ClipboardCheck,
  ExternalLink,
  Info,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { checkEngineHealth, type EngineHealth } from "@/lib/engine-bridge";

type LocalPhase = "idle" | "waiting" | "online" | "error";

const RAW_BASE = "https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install";

type Platform = "mac" | "win" | "linux" | "unknown";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as any).platform?.toLowerCase() || "";
  if (ua.includes("mac") || platform.includes("mac")) return "mac";
  if (ua.includes("win") || platform.includes("win")) return "win";
  if (ua.includes("linux") || platform.includes("linux")) return "linux";
  return "unknown";
}

const PLATFORM_INFO: Record<
  Platform,
  {
    label: string;
    command: string;
    uninstallCommand: string;
    terminalName: string;
    openTerminalHint: string;
    steps: { step: string; detail: string }[];
  }
> = {
  mac: {
    label: "macOS",
    // Команда, которую пользователь копирует и вставляет в Terminal
    command:
      'bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/install-mac.command)"',
    uninstallCommand:
      'bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-mac.command)"',
    terminalName: "Terminal.app",
    openTerminalHint:
      "Cmd+Space → введите «Terminal» → Enter. Или откройте Finder → Программы → Утилиты → Terminal",
    steps: [
      {
        step: "Откройте Terminal",
        detail:
          "Cmd+Space → введите «Terminal» → нажмите Enter. Откроется окно с чёрным фоном и текстовой строкой.",
      },
      {
        step: "Скопируйте команду ниже (кнопка «Скопировать команду»)",
        detail:
          "Команда автоматически попадёт в буфер обмена. Ничего скачивать не нужно — Terminal.app подписан Apple, Gatekeeper не мешает.",
      },
      {
        step: "Вставьте команду в Terminal и нажмите Enter",
        detail:
          "Cmd+V — вставить. Запустится установка (~5 минут первый раз, ставится Whisper ~800 МБ).",
      },
      {
        step: "Дождитесь сообщения «Установка завершена!»",
        detail:
          "Движок стартует на 127.0.0.1:8765 и откроет сайт в браузере. Этот индикатор позеленеет автоматически.",
      },
    ],
  },
  linux: {
    label: "Linux",
    command:
      'bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/install-linux.sh)"',
    uninstallCommand:
      'bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-linux.sh)"',
    terminalName: "Терминал",
    openTerminalHint:
      "Ctrl+Alt+T в большинстве дистрибутивов, или найдите «Терминал» в меню приложений",
    steps: [
      {
        step: "Откройте терминал",
        detail: "Ctrl+Alt+T — стандартный шорткат. Или найдите «Terminal» в меню приложений.",
      },
      {
        step: "Скопируйте команду ниже (кнопка «Скопировать команду»)",
        detail: "Команда попадёт в буфер обмена.",
      },
      {
        step: "Вставьте команду в терминал и нажмите Enter",
        detail:
          "Ctrl+Shift+V (или Shift+Insert) — вставка в терминале. Запустится установка (~5 минут первый раз).",
      },
      {
        step: "Дождитесь сообщения «Установка завершена!»",
        detail:
          "Движок стартует на 127.0.0.1:8765 и откроет сайт. Индикатор позеленеет автоматически.",
      },
    ],
  },
  win: {
    label: "Windows",
    // PowerShell one-liner — запускается из существующего PowerShell, никаких скачиваний
    command:
      "iwr -useb https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/install-win.ps1 | iex",
    uninstallCommand:
      "iwr -useb https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-win.ps1 | iex",
    terminalName: "PowerShell",
    openTerminalHint:
      "Win+R → введите «powershell» → Enter. Или: Пуск → найдите «PowerShell»",
    steps: [
      {
        step: "Откройте PowerShell",
        detail:
          "Win+R → введите «powershell» → Enter. Откроется синее окно PowerShell. НЕ используйте обычный cmd — там другая команда.",
      },
      {
        step: "Скопируйте команду ниже (кнопка «Скопировать команду»)",
        detail:
          "Команда попадёт в буфер обмена. PowerShell подписан Microsoft, SmartScreen не мешает.",
      },
      {
        step: "Вставьте команду в PowerShell и нажмите Enter",
        detail:
          "Правый клик в окне PowerShell = вставка (или Ctrl+V в новых версиях). Запустится установка (~5 минут первый раз).",
      },
      {
        step: "Дождитесь сообщения «Установка завершена!»",
        detail:
          "Движок стартует на 127.0.0.1:8765 и откроет сайт. Индикатор позеленеет автоматически.",
      },
    ],
  },
  unknown: {
    label: "Неизвестная платформа",
    command:
      'bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/install-linux.sh)"',
    uninstallCommand:
      'bash -c "$(curl -fsSL https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install/uninstall-linux.sh)"',
    terminalName: "терминал",
    openTerminalHint: "Откройте терминал вашей системы",
    steps: [
      {
        step: "Не удалось определить платформу",
        detail:
          "Скачайте установщик вручную с https://github.com/maksjermy123/Transcrypt/tree/main/engine-install",
      },
    ],
  },
};

export function LocalEngineStep({
  onSkip,
  hero = false,
}: {
  onSkip: () => void;
  /** hero — движок является главным шагом (режим локального движка) */
  hero?: boolean;
}) {
  const { engineServerOnline, setEngineServerOnline, setEngineServerHealth } = useOnboarding();
  const [phase, setPhase] = useState<LocalPhase>(engineServerOnline ? "online" : "idle");
  const [platform] = useState<Platform>(() =>
    typeof navigator === "undefined" ? "unknown" : detectPlatform()
  );
  const [polling, setPolling] = useState(false);
  const [waitTime, setWaitTime] = useState(0);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Активный поллинг
  useEffect(() => {
    if (!polling) return;

    const start = Date.now();
    const id = setInterval(async () => {
      const elapsed = Math.round((Date.now() - start) / 1000);
      setWaitTime(elapsed);

      const h = await checkEngineHealth();
      if (h && h.status === "ok") {
        setHealth(h);
        setPhase("online");
        setPolling(false);
        setEngineServerOnline(true);
        setEngineServerHealth(h);
        clearInterval(id);
      }
    }, 2000);

    timerRef.current = id as unknown as ReturnType<typeof setInterval>;
    return () => {
      clearInterval(id);
    };
  }, [polling, setEngineServerOnline, setEngineServerHealth]);

  /**
   * Копирование команды в буфер обмена пользователя.
   * Использует navigator.clipboard.writeText (Chrome 66+, Firefox 63+, Safari 13.1+).
   * Fallback на document.execCommand('copy') для старых браузеров.
   */
  async function copyCommand() {
    const cmd = PLATFORM_INFO[platform].command;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      // Начинаем поллинг — пользователь, скорее всего, сейчас вставит команду
      if (phase === "idle") {
        setPhase("waiting");
        setPolling(true);
      }
    } catch (err) {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = cmd;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
        if (phase === "idle") {
          setPhase("waiting");
          setPolling(true);
        }
      } catch (e) {
        console.error("Не удалось скопировать:", e);
      }
      document.body.removeChild(textarea);
    }
  }

  function startPolling() {
    if (phase === "idle") {
      setPhase("waiting");
      setPolling(true);
    }
  }

  function retryCheck() {
    setPhase("waiting");
    setPolling(true);
  }

  function skip() {
    if (timerRef.current) clearInterval(timerRef.current);
    setPolling(false);
    onSkip();
  }

  const info = PLATFORM_INFO[platform];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className={`glass-card rounded-2xl p-6 ${hero ? "" : "mt-6"} ${
        hero ? "border-[#7c5bf5]/40 shadow-[0_0_40px_-12px_rgba(124,91,245,0.4)]" : ""
      }`}
    >
      <div className="flex items-start gap-3 mb-5">
        <div
          className={`rounded-xl flex items-center justify-center flex-shrink-0 ${
            hero ? "w-14 h-14" : "w-12 h-12"
          } ${
            phase === "online"
              ? "bg-emerald-500/15"
              : phase === "error"
              ? "bg-red-500/15"
              : "bg-amber-500/15"
          }`}
        >
          {phase === "online" ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          ) : phase === "error" ? (
            <XCircle className="w-6 h-6 text-red-500" />
          ) : phase === "waiting" ? (
            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
          ) : (
            <Server className="w-6 h-6 text-amber-400" />
          )}
        </div>
        <div className="flex-1">
          <h3 className={`font-semibold mb-1 ${hero ? "text-xl" : "text-base"}`}>
            {phase === "online"
              ? "Локальный движок запущен и готов!"
              : hero
              ? "Установить движок — одна команда"
              : "Установка локального движка"}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {phase === "online" ? (
              <>
                Движок online на{" "}
                <code className="font-mono">127.0.0.1:8765</code>. URL-задачи и
                скачивание с YouTube/TikTok доступны.
              </>
            ) : (
              <>
                Никаких файлов скачивать не нужно — вы копируете{" "}
                <strong className="text-foreground">одну команду</strong> и
                вставляете её в {info.terminalName}. Скрипт сам скачает и установит
                всё необходимое.
              </>
            )}
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {(phase === "idle" || phase === "waiting") && (
          <motion.div
            key="command"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {/* Платформа */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Ваша платформа:</span>
              <span className="px-2 py-0.5 rounded-md bg-[#7c5bf5]/15 text-[#7c5bf5] text-xs font-medium">
                {info.label}
              </span>
            </div>

            {/* Команда + кнопка копирования */}
            <div className="bg-[#0b0f19] border border-[#263147] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-[#1b2334] border-b border-[#263147]">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>{info.terminalName}</span>
                </div>
                <button
                  onClick={copyCommand}
                  className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors inline-flex items-center gap-1.5 ${
                    copied
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-[#7c5bf5]/15 text-[#7c5bf5] hover:bg-[#7c5bf5]/25"
                  }`}
                >
                  {copied ? (
                    <>
                      <ClipboardCheck className="w-3 h-3" />
                      Скопировано ✓
                    </>
                  ) : (
                    <>
                      <Clipboard className="w-3 h-3" />
                      Скопировать команду
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all">
                {info.command}
              </pre>
            </div>

            {/* Инструкция — 4 шага */}
            <div className="bg-[#0b0f19]/40 rounded-xl p-4 border border-[#263147]">
              <div className="flex items-center gap-2 mb-3">
                <Info className="w-4 h-4 text-[#7c5bf5]" />
                <h4 className="font-medium text-sm">Пошаговая инструкция</h4>
              </div>
              <div className="space-y-3">
                {info.steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7c5bf5]/20 text-[#7c5bf5] text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{s.step}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {s.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Подсказка как открыть терминал */}
            <div className="text-xs text-muted-foreground bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
              <Terminal className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-foreground font-medium">Как открыть {info.terminalName}:</span>{" "}
                {info.openTerminalHint}
              </div>
            </div>

            {/* Статус поллинга (когда уже нажали скопировать) */}
            {phase === "waiting" && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#0b0f19]/60 border border-[#263147]">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Ожидаем запуска движка…</span>
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  {waitTime}с
                </span>
              </div>
            )}

            {/* Что будет делать скрипт */}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground inline-flex items-center gap-1.5">
                <Info className="w-3 h-3" />
                Что будет делать скрипт
              </summary>
              <ol className="list-decimal list-inside mt-2 space-y-1 ml-2">
                <li>Проверит Python 3.10+ и ffmpeg</li>
                <li>Создаст изолированное окружение в{" "}
                  <code className="font-mono text-[11px]">~/.transcrypt-engine/</code>
                </li>
                <li>Скачает <code className="font-mono text-[11px]">engine_server.py</code> из GitHub</li>
                <li>Установит Whisper + yt-dlp (~800 МБ, ~5 минут при первом запуске)</li>
                <li>Запустит движок на{" "}
                  <code className="font-mono text-[11px]">127.0.0.1:8765</code>
                </li>
                <li>Настроит автозапуск с системой (LaunchAgent/systemd/Registry)</li>
                <li>Откроет этот сайт в браузере — индикатор станет зелёным</li>
              </ol>
            </details>

            <div className="flex gap-2 pt-2">
              {phase === "idle" && (
                <button
                  onClick={startPolling}
                  className="text-xs bg-[#1b2334] hover:bg-[#263147] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  Я уже вставил — проверить
                </button>
              )}
              {phase === "waiting" && (
                <button
                  onClick={retryCheck}
                  className="text-xs bg-[#1b2334] hover:bg-[#263147] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  Проверить снова
                </button>
              )}
              <button
                onClick={skip}
                className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5"
              >
                Пропустить
              </button>
            </div>
          </motion.div>
        )}

        {phase === "online" && (
          <motion.div
            key="online"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Локальный движок запущен и отвечает на /api/health</span>
            </div>
            <div className="text-xs text-muted-foreground bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {health?.system_name && (
                  <span>Платформа:{" "}
                    <span className="text-foreground font-medium">{health.system_name}</span>
                  </span>
                )}
                {health?.device && (
                  <span>Устройство:{" "}
                    <span className="text-foreground font-medium">{health.device}</span>
                  </span>
                )}
                {health?.recommended_threads != null && (
                  <span>Потоки Whisper:{" "}
                    <span className="text-foreground font-medium">{health.recommended_threads}</span>
                  </span>
                )}
                <span>
                  ffmpeg:{" "}
                  <span className="text-foreground font-medium">
                    {health?.ffmpeg ? "✓" : "✗"}
                  </span>
                </span>
              </div>
            </div>

            {/* Кнопка удаления движка — показывается когда движок online */}
            <details className="text-xs">
              <summary className="cursor-pointer text-red-400 hover:text-red-300 inline-flex items-center gap-1.5">
                <XCircle className="w-3 h-3" />
                Удалить движок (полное удаление)
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-muted-foreground leading-relaxed">
                  Это полностью удалит локальный движок с компьютера:
                  ~800 МБ Whisper, venv, <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-[#1b2334]">engine_server.py</code>,
                  <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-[#1b2334] mx-1">src/</code>,
                  автозапуск с системой. Браузерный Whisper останется работать для локальных файлов.
                </p>
                <div className="bg-[#0b0f19] border border-red-500/30 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-red-500/10 border-b border-red-500/20">
                    <div className="flex items-center gap-2 text-xs text-red-300">
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Команда удаления для {info.terminalName}</span>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(info.uninstallCommand);
                          alert("Команда удаления скопирована. Откройте " + info.terminalName + " и вставьте (Cmd+V / Ctrl+Shift+V / правый клик).");
                        } catch {
                          const textarea = document.createElement("textarea");
                          textarea.value = info.uninstallCommand;
                          document.body.appendChild(textarea);
                          textarea.select();
                          document.execCommand("copy");
                          document.body.removeChild(textarea);
                          alert("Команда удаления скопирована. Откройте " + info.terminalName + " и вставьте.");
                        }
                      }}
                      className="text-xs px-2.5 py-1 rounded-md bg-red-500/15 text-red-300 hover:bg-red-500/25 inline-flex items-center gap-1.5"
                    >
                      <Clipboard className="w-3 h-3" />
                      Скопировать команду удаления
                    </button>
                  </div>
                  <pre className="p-3 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap break-all">
                    {info.uninstallCommand}
                  </pre>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Скрипт спросит подтверждение (yes/no) перед удалением. После удаления
                  индикатор в шапке этого сайта позеленеет → снова станет оранжевым.
                </p>
              </div>
            </details>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
