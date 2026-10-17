"use client";

import { motion } from "framer-motion";
import {
  Download,
  MonitorSmartphone,
  ExternalLink,
  ArrowRight,
  ShieldCheck,
  Info,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

type DesktopOs = "windows" | "macos" | "linux";
type DesktopArch = "x64" | "arm64";

interface DesktopTarget {
  os: DesktopOs;
  arch: DesktopArch;
}

/**
 * Стабильные ссылки «последний релиз» — имена файлов артефактов версионированы
 * НЕ в имени (каждый релиз перезаписывает те же имена), поэтому ссылка
 * releases/latest/download/... всегда отдаёт актуальную сборку.
 */
const RELEASE_BASE = "https://github.com/maksjermy123/Transcrypt/releases/latest/download/";
const RELEASES_PAGE = "https://github.com/maksjermy123/Transcrypt/releases";

const ASSETS: Record<string, string> = {
  "windows:x64": "VoxPaperAi-Pro-windows-x64.zip",
  "macos:arm64": "VoxPaperAi-Pro-macos-apple-silicon.zip",
  "macos:x64": "VoxPaperAi-Pro-macos-intel.zip",
  "linux:x64": "VoxPaperAi-Pro-linux-x64.tar.gz",
};

/**
 * Определение ОС и архитектуры по браузеру.
 *  - ОС: userAgent + userAgentData.platform.
 *  - Архитектура: userAgentData.architecture (Chrome/Edge), для Safari —
 *    WebGL-рендерер (Apple M1/M2/… → arm64, Intel → x64; Safari не даёт UA-CH).
 * По умолчанию для macOS считаем Apple Silicon (современные маки доминируют),
 * но рядом всегда есть обе ссылки — пользователь может исправить вручную.
 */
function detectTarget(): DesktopTarget {
  if (typeof navigator === "undefined") return { os: "windows", arch: "x64" };
  const ua = navigator.userAgent;
  let os: DesktopOs;
  if (/Windows/i.test(ua)) os = "windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macos";
  else if (/Linux|X11/i.test(ua)) os = "linux";
  else os = "windows";

  let arch: DesktopArch = "x64";
  if (os === "macos") {
    arch = "arm64";
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      if (gl && ext) {
        const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
        if (/Apple M\d|Apple GPU/i.test(renderer)) arch = "arm64";
        else if (/Intel/i.test(renderer)) arch = "x64";
      }
    } catch {
      /* остаёмся на умолчании */
    }
  }
  const uad = (navigator as unknown as { userAgentData?: { architecture?: string } }).userAgentData;
  if (uad?.architecture) {
    const a = uad.architecture.toLowerCase();
    if (a === "arm") arch = "arm64";
    else if (a === "x86") arch = "x64";
  }
  return { os, arch };
}

const OS_LABEL: Record<DesktopOs, string> = {
  windows: "Windows 64-bit",
  macos: "macOS",
  linux: "Linux",
};

export function DesktopStep({ onNext }: { onNext: () => void }) {
  const { t } = useI18n();
  const [target, setTarget] = useState<DesktopTarget | null>(null);

  useEffect(() => {
    setTarget(detectTarget());
  }, []);

  const primaryAsset = target ? ASSETS[`${target.os}:${target.arch}`] : null;
  const primaryLabel = target
    ? `${t(OS_LABEL[target.os])}${target.os === "macos" ? (target.arch === "arm64" ? ` (${t("Apple Silicon")})` : ` (${t("Intel")})`) : ""}`
    : "";

  const others: Array<{ key: string; label: string; asset: string }> = [
    { key: "windows:x64", label: t("Windows 64-bit"), asset: ASSETS["windows:x64"] },
    { key: "macos:arm64", label: `${t("macOS")} — ${t("Apple Silicon")} (M1/M2/M3/M4)`, asset: ASSETS["macos:arm64"] },
    { key: "macos:x64", label: `${t("macOS")} — ${t("Intel")}`, asset: ASSETS["macos:x64"] },
    { key: "linux:x64", label: t("Linux 64-bit"), asset: ASSETS["linux:x64"] },
  ].filter((o) => o.asset !== primaryAsset);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-2xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#7c5bf5]/15 mb-5">
          <MonitorSmartphone className="w-8 h-8 text-[#7c5bf5]" />
        </div>
        <h2 className="text-3xl font-bold mb-3">{t("Скачайте программу")}</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          {t("VoxPaperAi Pro — полностью локальное приложение: сайт и браузер не нужны. Установщик собран на GitHub автоматически из открытых исходников. Бесплатно.")}
        </p>
      </div>

      {/* Главная кнопка — под определённую систему */}
      <div className="glass-card rounded-2xl p-6 mb-5 border-[#7c5bf5]/40 glow-primary">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-semibold mb-1">{t("Для вашей системы:")}</h3>
            <p className="text-sm text-muted-foreground">
              {target ? primaryLabel : t("Определяем систему…")}
            </p>
          </div>
          {primaryAsset && (
            <a
              href={RELEASE_BASE + primaryAsset}
              className="bg-gradient-primary text-white px-6 py-3.5 rounded-xl font-semibold hover:opacity-90 transition-opacity glow-primary inline-flex items-center gap-2"
            >
              <Download className="w-5 h-5" />
              {t("Скачать")}
            </a>
          )}
        </div>
      </div>

      {/* Все системы — на случай неточного определения */}
      <div className="glass-card rounded-2xl p-5 mb-5">
        <h3 className="font-medium mb-3 text-sm">{t("Другие системы и версии:")}</h3>
        <div className="grid sm:grid-cols-2 gap-2">
          {others.map((o) => (
            <a
              key={o.key}
              href={RELEASE_BASE + o.asset}
              className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] transition-colors text-sm"
            >
              <span>{o.label}</span>
              <Download className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            </a>
          ))}
        </div>
        <a
          href={RELEASES_PAGE}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#7c5bf5] hover:underline"
        >
          {t("Все версии на GitHub Releases")} <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Как установить — по определённой ОС */}
      {target && (
        <div className="glass-card rounded-2xl p-5 mb-5">
          <h3 className="font-medium mb-3 text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-[#7c5bf5]" />
            {t("Как установить:")}
          </h3>
          {target.os === "windows" && (
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>{t("Распакуйте ZIP в любую папку — внутри лежит «VoxPaperAi Pro».")}</li>
              <li>{t("Запустите «VoxPaperAi Pro». Если появится окно SmartScreen: «Подробнее» → «Выполнить в любом случае» (программа без цифровой подписи, исходники открыты на GitHub).")}</li>
              <li>{t("При первом запуске программа сама попросит согласие с политикой и отказом от ответственности — это обязательно и всегда бывает в начале.")}</li>
            </ol>
          )}
          {target.os === "macos" && (
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>{t("Распакуйте ZIP и перетащите «VoxPaperAi Pro.app» в папку «Программы».")}</li>
              <li>{t("Первый запуск: правый клик по программе → «Открыть» (приложение без подписи Apple; в Терминале можно снять карантин: xattr -cr \"/Applications/VoxPaperAi Pro.app\").")}</li>
              <li>{t("При первом запуске программа сама попросит согласие с политикой и отказом от ответственности — это обязательно и всегда бывает в начале.")}</li>
            </ol>
          )}
          {target.os === "linux" && (
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>{t("Распакуйте архив: tar -xzf <файл>.tar.gz — появится папка «VoxPaperAi Pro».")}</li>
              <li>{t("Запустите исполняемый файл «VoxPaperAi Pro» внутри папки (при необходимости установите системные библиотеки libxcb).")}</li>
              <li>{t("При первом запуске программа сама попросит согласие с политикой и отказом от ответственности — это обязательно и всегда бывает в начале.")}</li>
            </ol>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground flex items-start gap-2 mb-8">
        <ShieldCheck className="w-3.5 h-3.5 text-[#7c5bf5] flex-shrink-0 mt-0.5" />
        <span>
          {t("Согласие с политикой конфиденциальности и отказом от ответственности вы подтвердили на предыдущем шаге. Файлы не покидают компьютер. Программа бесплатна.")}
        </span>
      </div>

      <div className="text-center">
        <button
          onClick={onNext}
          className="text-[#7c5bf5] hover:underline font-medium text-sm inline-flex items-center gap-1.5"
        >
          {t("Продолжить в браузере — рабочая страница доступна и так")}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}
