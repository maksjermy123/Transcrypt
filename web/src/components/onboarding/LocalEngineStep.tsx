"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Server,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowRight,
  Zap,
  Folder,
  Terminal,
  ShieldAlert,
  FileCheck,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { checkEngineHealth, type EngineHealth } from "@/lib/engine-bridge";

type LocalPhase = "idle" | "downloading" | "waiting" | "online" | "error";

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
    filename: string;
    size: string;
    fileLabel: string;
    downloadFolder: string;
    openInstruction: { step: string; detail: string }[];
    gatekeeper?: { title: string; body: string };
  }
> = {
  mac: {
    label: "macOS",
    filename: "install-mac.command",
    size: "10 КБ",
    fileLabel: "install-mac.command",
    downloadFolder: "Загрузки (Downloads)",
    openInstruction: [
      {
        step: "Откройте Finder",
        detail: "Сделка Cmd+Space → «Finder» → Enter. Или кликните по иконке Finder в Dock.",
      },
      {
        step: "Перейдите в папку «Загрузки»",
        detail: "В боковом меню слева — раздел «Загрузки» (Downloads). Найдите файл install-mac.command.",
      },
      {
        step: "Дважды кликните по файлу",
        detail: "Откроется Terminal.app, и скрипт начнёт установку. Если спросит «Are you sure?» — нажмите «Открыть».",
      },
    ],
    gatekeeper: {
      title: "Если macOS блокирует запуск",
      body:
        '«не можем проверить разработчика» или «Identity cannot be verified» — откройте Системные настройки → Конфиденциальность и безопасность (Privacy & Security). Прокрутите вниз — будет кнопка «Всё равно открыть» (Open Anyway). Нажмите её и подтвердите.',
    },
  },
  win: {
    label: "Windows",
    filename: "install-win.bat",
    size: "9 КБ",
    fileLabel: "install-win.bat",
    downloadFolder: "Загрузки (Downloads)",
    openInstruction: [
      {
        step: "Откройте Проводник (Win+E)",
        detail: "Или кликните по иконке папки на панели задач.",
      },
      {
        step: "Перейдите в папку «Загрузки»",
        detail: "В левой панели — раздел «Загрузки». Найдите файл install-win.bat.",
      },
      {
        step: "Дважды кликните по install-win.bat",
        detail: "Откроется окно командной строки (cmd.exe), скрипт начнёт установку. Если Windows Defender SmartScreen спросит — нажмите «Дополнительные сведения» → «Всё равно запустить».",
      },
    ],
  },
  linux: {
    label: "Linux",
    filename: "install-linux.sh",
    size: "10 КБ",
    fileLabel: "install-linux.sh",
    downloadFolder: "~/Загрузки (или ~/Downloads)",
    openInstruction: [
      {
        step: "Откройте терминал",
        detail: "Ctrl+Alt+T в большинстве дистрибутивов, или найдите «Терминал» в меню приложений.",
      },
      {
        step: "Перейдите в папку загрузок",
        detail: "cd ~/Загрузки  (или: cd ~/Downloads — зависит от локали)",
      },
      {
        step: "Запустите скрипт",
        detail: "bash install-linux.sh — скрипт начнёт установку. Если терминал скажет permission denied, выполните: chmod +x install-linux.sh && bash install-linux.sh",
      },
    ],
  },
  unknown: {
    label: "Неизвестная платформа",
    filename: "",
    size: "",
    fileLabel: "установщик",
    downloadFolder: "папка загрузок",
    openInstruction: [
      {
        step: "Скачайте установщик вручную",
        detail:
          "Зайдите на https://github.com/maksjermy123/Transcrypt/tree/main/engine-install и скачайте файл для вашей платформы.",
      },
    ],
  },
};

export function LocalEngineStep({ onSkip }: { onSkip: () => void }) {
  const { engineServerOnline, setEngineServerOnline, setEngineServerHealth } = useOnboarding();
  const [phase, setPhase] = useState<LocalPhase>(engineServerOnline ? "online" : "idle");
  const [platform] = useState<Platform>(() =>
    typeof navigator === "undefined" ? "unknown" : detectPlatform()
  );
  const [polling, setPolling] = useState(false);
  const [waitTime, setWaitTime] = useState(0);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);

  // Активный поллинг после скачивания установщика
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
   * Magic button: инициирует скачивание установщика через fetch + Blob,
   * что гарантирует сохранение файла без навигации (в отличие от прямого <a href>).
   * После скачивания показывается инструкция с указанием где найти файл и как запустить.
   */
  async function installEngine() {
    if (platform === "unknown" || startedRef.current) return;
    startedRef.current = true;
    setPhase("downloading");

    const filename = PLATFORM_INFO[platform].filename;

    try {
      // Скачиваем скрипт через fetch — получаем Blob, который точно сохранится
      // как файл, без навигации на страницу с исходником.
      const resp = await fetch(`${RAW_BASE}/${filename}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();

      // Создаём objectURL и триггерим скачивание
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Ошибка скачивания установщика:", err);
      // Fallback на прямой <a download> — может привести к навигации,
      // но если fetch заблокирован CORS, это единственный вариант
      const a = document.createElement("a");
      a.href = `${RAW_BASE}/${filename}`;
      a.download = filename;
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    // Через 3 секунды переходим в фазу "waiting" с инструкциями
    setTimeout(() => {
      setPhase("waiting");
      setPolling(true);
    }, 3000);
  }

  function retryCheck() {
    setPhase("waiting");
    setPolling(true);
  }

  function skip() {
    if (timerRef.current) clearInterval(timerRef.current);
    setPolling(false);
    startedRef.current = false;
    onSkip();
  }

  const info = PLATFORM_INFO[platform];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="glass-card rounded-2xl p-6 mt-6"
    >
      <div className="flex items-start gap-3 mb-5">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
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
          ) : phase === "waiting" || phase === "downloading" ? (
            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
          ) : (
            <Server className="w-6 h-6 text-amber-400" />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base mb-1">
            {phase === "online"
              ? "Локальный движок запущен и готов!"
              : "Установка локального движка"}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {phase === "online" ? (
              <>
                Движок online на{" "}
                <code className="font-mono">127.0.0.1:8765</code>. Теперь доступны
                URL-задачи (YouTube, TikTok), скачивание видео/аудио, hardsub.
              </>
            ) : (
              <>
                Локальный движок — это Python-сервер на вашем компьютере. Он
                скачивает контент с YouTube/TikTok (обходя блокировки) и
                запускает нативный Whisper.
              </>
            )}
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {phase === "idle" && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Ваша платформа:</span>
              <span className="px-2 py-0.5 rounded-md bg-[#7c5bf5]/15 text-[#7c5bf5] text-xs font-medium">
                {info.label}
              </span>
            </div>

            {/* MAGIC BUTTON */}
            <button
              onClick={installEngine}
              disabled={platform === "unknown"}
              className="w-full bg-gradient-primary text-white px-5 py-4 rounded-xl font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-3 glow-primary text-lg"
            >
              <Zap className="w-5 h-5" />
              Установить движок
            </button>

            <div className="text-xs text-muted-foreground bg-[#0b0f19]/40 rounded-lg p-3">
              <div className="font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-400" />
                По клику произойдёт:
              </div>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Браузер скачает{" "}
                  <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-[#1b2334]">
                    {info.filename || "установщик"}
                  </code>{" "}
                  (~{info.size || "5 КБ"}) в папку «Загрузки»
                </li>
                <li>Появится подробная инструкция — где найти файл и как его открыть</li>
                <li>После запуска скрипт сам установит Whisper (~800 МБ) и запустит движок</li>
                <li>Когда движок поднимется — этот индикатор станет зелёным автоматически</li>
              </ol>
            </div>

            {platform === "mac" && (
              <div className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <strong>macOS:</strong> при первом запуске скрипта из интернета
                система может его заблокировать. Мы покажем, что делать —
                инструкция появится после клика.
              </div>
            )}

            {platform === "win" && (
              <div className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <strong>Windows:</strong> SmartScreen может пометить скрипт как
                «неопознанный» — это нормально. Мы покажем как обойти.
              </div>
            )}

            <button
              onClick={skip}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            >
              Пропустить — продолжить без локального движка
              <ArrowRight className="w-3 h-3" />
            </button>
          </motion.div>
        )}

        {phase === "downloading" && (
          <motion.div
            key="downloading"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>Скачиваем установщик…</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Файл <code className="font-mono">{info.filename}</code> сохраняется в
              папку «Загрузки». Если браузер показал диалог «Сохранить/Открыть» —
              выберите «Сохранить». Через пару секунд появится инструкция.
            </p>
          </motion.div>
        )}

        {phase === "waiting" && (
          <motion.div
            key="waiting"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {/* Статус поллинга */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[#0b0f19]/60 border border-[#263147]">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                <span>Ожидаем запуска движка…</span>
              </div>
              <span className="text-xs font-mono text-muted-foreground">
                {waitTime}с
              </span>
            </div>

            {/* Инструкция по открытию файла */}
            <div className="bg-[#0b0f19]/40 rounded-xl p-4 border border-[#7c5bf5]/20">
              <div className="flex items-center gap-2 mb-3">
                <FileCheck className="w-4 h-4 text-[#7c5bf5]" />
                <h4 className="font-medium text-sm">
                  Как запустить установщик ({info.label})
                </h4>
              </div>

              <div className="space-y-3">
                {info.openInstruction.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7c5bf5]/20 text-[#7c5bf5] text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{step.step}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {step.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Подсказка про местоположение файла */}
              <div className="mt-3 pt-3 border-t border-[#263147] flex items-start gap-2 text-xs">
                <Folder className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-muted-foreground">Файл </span>
                  <code className="font-mono px-1 py-0.5 rounded bg-[#1b2334] text-foreground">
                    {info.fileLabel}
                  </code>
                  <span className="text-muted-foreground"> лежит в </span>
                  <span className="text-foreground font-medium">{info.downloadFolder}</span>
                </div>
              </div>
            </div>

            {/* Предупреждение для macOS Gatekeeper */}
            {info.gatekeeper && (
              <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4">
                <div className="flex items-start gap-2 mb-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <h4 className="font-medium text-sm text-amber-300">
                    {info.gatekeeper.title}
                  </h4>
                </div>
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  {info.gatekeeper.body}
                </p>
              </div>
            )}

            {/* Что будет делать скрипт */}
            <div className="bg-[#0b0f19]/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Terminal className="w-4 h-4 text-[#7c5bf5]" />
                <h4 className="font-medium text-sm">Что будет делать скрипт</h4>
              </div>
              <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1">
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
            </div>

            <div className="flex gap-2">
              <button
                onClick={retryCheck}
                className="text-xs bg-[#1b2334] hover:bg-[#263147] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3 h-3" />
                Проверить снова
              </button>
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
