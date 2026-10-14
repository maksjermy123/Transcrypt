"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Server,
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  Terminal,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useOnboarding } from "@/lib/onboarding-store";
import { checkEngineHealth, type EngineHealth } from "@/lib/engine-bridge";

type LocalPhase = "idle" | "downloading" | "waiting" | "online" | "error";

const RAW_BASE = "https://raw.githubusercontent.com/maksjermy123/Transcrypt/main/engine-install";

function detectPlatform(): "mac" | "win" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator as any).platform?.toLowerCase() || "";
  if (ua.includes("mac") || platform.includes("mac")) return "mac";
  if (ua.includes("win") || platform.includes("win")) return "win";
  if (ua.includes("linux") || platform.includes("linux")) return "linux";
  return "unknown";
}

const PLATFORM_INFO: Record<
  "mac" | "win" | "linux" | "unknown",
  { label: string; filename: string; instructions: string }
> = {
  mac: {
    label: "macOS",
    filename: "install-mac.command",
    instructions:
      "Скачайте файл install-mac.command, затем дважды кликните по нему в Finder. Скрипт создаст venv, установит whisper+yt-dlp и запустит движок на 127.0.0.1:8765.",
  },
  win: {
    label: "Windows",
    filename: "install-win.bat",
    instructions:
      "Скачайте файл install-win.bat и дважды кликните по нему в проводнике. Скрипт создаст venv, установит whisper+yt-dlp и запустит движок на 127.0.0.1:8765.",
  },
  linux: {
    label: "Linux",
    filename: "install-linux.sh",
    instructions:
      "Скачайте файл и запустите в терминале: bash install-linux.sh. Скрипт создаст venv, установит whisper+yt-dlp и запустит движок на 127.0.0.1:8765.",
  },
  unknown: {
    label: "Неизвестная платформа",
    filename: "",
    instructions: "Не удалось определить вашу ОС. Скачайте нужный файл вручную из репозитория.",
  },
};

export function LocalEngineStep({ onSkip }: { onSkip: () => void }) {
  const { engineServerOnline, setEngineServerOnline, setEngineServerHealth } = useOnboarding();
  const [phase, setPhase] = useState<LocalPhase>(engineServerOnline ? "online" : "idle");
  // Инициализируем платформу синхронно (на клиенте navigator доступен сразу)
  const [platform] = useState<"mac" | "win" | "linux" | "unknown">(() =>
    typeof navigator === "undefined" ? "unknown" : detectPlatform()
  );
  const [polling, setPolling] = useState(false);
  const [waitTime, setWaitTime] = useState(0);
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    timerRef.current = id as unknown as NodeJS.Timeout;
    return () => {
      clearInterval(id);
    };
  }, [polling, setEngineServerOnline, setEngineServerHealth]);

  function downloadInstaller() {
    if (platform === "unknown") return;
    const filename = PLATFORM_INFO[platform].filename;
    if (!filename) return;

    setPhase("downloading");

    // Триггерим скачивание файла через <a download>
    const a = document.createElement("a");
    a.href = `${RAW_BASE}/${filename}`;
    a.download = filename;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Через 3 секунды начинаем поллинг — пользователь должен был кликнуть по файлу
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
    onSkip();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className="mt-10 glass-card rounded-2xl p-6 text-left"
    >
      <div className="flex items-start gap-3 mb-4">
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
              : "Локальный движок для YouTube URL"}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {phase === "online" ? (
              <>
                Движок online на <code className="font-mono">127.0.0.1:8765</code>.
                Теперь доступны URL-задачи (YouTube, TikTok, Instagram), скачивание видео/аудио, hardsub.
                Платформа: <span className="text-foreground font-medium">{health?.system_name}</span>,
                устройство: <span className="text-foreground font-medium">{health?.device}</span>,
                ffmpeg: <span className="text-foreground font-medium">{health?.ffmpeg ? "✓" : "✗"}</span>.
              </>
            ) : (
              <>
                Браузерный Whisper работает только с локальными файлами. Чтобы скачивать с
                YouTube/TikTok и работать с URL, установите локальный Python-движок — он
                использует yt-dlp с маскировкой под Chrome и обходит все блокировки.
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
          >
            {platform !== "unknown" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Ваша платформа:</span>
                  <span className="px-2 py-0.5 rounded-md bg-[#7c5bf5]/15 text-[#7c5bf5] text-xs font-medium">
                    {PLATFORM_INFO[platform].label}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {PLATFORM_INFO[platform].instructions}
                </p>

                <button
                  onClick={downloadInstaller}
                  className="w-full sm:w-auto bg-gradient-primary text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 transition-opacity inline-flex items-center gap-2 justify-center"
                >
                  <Download className="w-4 h-4" />
                  Скачать установщик для {PLATFORM_INFO[platform].label}
                </button>

                <div className="text-xs text-muted-foreground bg-[#0b0f19]/40 rounded-lg p-3">
                  <div className="font-medium text-foreground mb-1">Что произойдёт:</div>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Скачается файл ~5 КБ (это bash/bat скрипт)</li>
                    <li>Запустите его — он создаст venv в <code className="font-mono">~/.transcrypt-engine/</code></li>
                    <li>Установит Whisper (~800 МБ) и yt-dlp — <strong>это займёт ~5 минут при первом запуске</strong></li>
                    <li>Запустит движок на <code className="font-mono">127.0.0.1:8765</code></li>
                    <li>Откроет сайт в браузере — индикатор станет зелёным автоматически</li>
                  </ol>
                </div>
              </div>
            )}

            {platform === "unknown" && (
              <div className="text-xs text-muted-foreground">
                Не удалось определить вашу операционную систему. Скачайте нужный установщик
                вручную из{" "}
                <a
                  href="https://github.com/maksjermy123/Transcrypt/tree/main/engine-install"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#7c5bf5] hover:underline"
                >
                  папки engine-install в репозитории
                </a>
                .
              </div>
            )}

            <div className="mt-4 flex items-center gap-3 pt-4 border-t border-[#263147]">
              <button
                onClick={skip}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
              >
                Пропустить — продолжить без локального движка
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}

        {phase === "downloading" && (
          <motion.div
            key="downloading"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="text-sm text-muted-foreground"
          >
            <p className="mb-2">📄 Скачиваем установщик…</p>
            <p className="text-xs">Если файл не скачался автоматически — проверьте папку «Загрузки».</p>
          </motion.div>
        )}

        {phase === "waiting" && (
          <motion.div
            key="waiting"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>
                Ожидаем запуска движка... (прошло {waitTime}с)
              </span>
            </div>
            <div className="text-xs text-muted-foreground bg-[#0b0f19]/40 rounded-lg p-3 space-y-1.5">
              <p className="font-medium text-foreground">Пока вы ждёте:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Откройте скачанный файл (двойной клик по install-*.{platform === "win" ? "bat" : platform === "mac" ? "command" : "sh"})</li>
                {platform === "mac" && (
                  <li className="text-amber-400">
                    macOS может спросить «Are you sure?» — это нормально для скриптов из интернета,
                    нажмите ОК.
                  </li>
                )}
                {platform === "mac" && (
                  <li className="text-amber-400">
                    Если macOS блокирует с «не можем проверить разработчика»,
                    откройте Системные настройки → Конфиденциальность и безопасность →
                    нажмите «Всё равно открыть».
                  </li>
                )}
                <li>Откроется терминал — скрипт будет печатать прогресс установки</li>
                <li>Ждите ~5 минут (первый раз ставится Whisper ~800 МБ)</li>
                <li>Когда движок запустится, кнопка ниже станет зелёной автоматически</li>
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
                  <span>Платформа: <span className="text-foreground font-medium">{health.system_name}</span></span>
                )}
                {health?.device && (
                  <span>Устройство: <span className="text-foreground font-medium">{health.device}</span></span>
                )}
                {health?.recommended_threads != null && (
                  <span>Потоки Whisper: <span className="text-foreground font-medium">{health.recommended_threads}</span></span>
                )}
                <span>
                  ffmpeg: <span className="text-foreground font-medium">{health?.ffmpeg ? "✓" : "✗"}</span>
                </span>
                <span>
                  ffprobe: <span className="text-foreground font-medium">{health?.ffprobe ? "✓" : "✗"}</span>
                </span>
              </div>
            </div>
            <button
              onClick={skip}
              className="bg-gradient-primary text-white px-5 py-2.5 rounded-xl font-medium hover:opacity-90 inline-flex items-center gap-2"
            >
              <ArrowRight className="w-4 h-4" />
              Продолжить →
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {phase !== "online" && (
        <details className="mt-5 text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground inline-flex items-center gap-1.5">
            <Terminal className="w-3 h-3" />
            Ручная установка (для опытных пользователей)
          </summary>
          <div className="mt-3 bg-[#0b0f19] rounded-xl p-3 font-mono text-[11px] space-y-1.5">
            <div className="text-muted-foreground"># 1. Склонировать репозиторий</div>
            <div className="text-foreground">git clone https://github.com/maksjermy123/Transcrypt</div>
            <div className="text-foreground">cd Transcrypt</div>
            <div className="text-muted-foreground mt-2"># 2. Создать venv и установить зависимости</div>
            <div className="text-foreground">python -m venv .venv</div>
            <div className="text-foreground">source .venv/bin/activate  # на Windows: .venv\Scripts\activate</div>
            <div className="text-foreground">pip install -r engine-install/requirements-engine.txt</div>
            <div className="text-muted-foreground mt-2"># 3. Запустить движок</div>
            <div className="text-foreground">python engine_server.py</div>
            <div className="text-muted-foreground mt-2"># Движок откроется на http://127.0.0.1:8765</div>
            <div className="text-muted-foreground"># Обновите эту страницу — индикатор станет зелёным</div>
          </div>
        </details>
      )}
    </motion.div>
  );
}
