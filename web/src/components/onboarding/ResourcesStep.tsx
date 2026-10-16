"use client";

import { motion } from "framer-motion";
import {
  Cpu,
  MemoryStick,
  Gauge,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { detectHardware, detectWebGPU } from "@/lib/whisper";
import { recommendedThreads, type HardwareInfo } from "@/lib/onboarding-store";
import { translate, useI18n } from "@/lib/i18n";

export function ResourcesStep({ onNext }: { onNext: () => void }) {
  const { t } = useI18n();
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [webgpu, setWebgpu] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const raw = detectHardware();
      const gpu = await detectWebGPU();
      const threads = recommendedThreads(raw.cpuCores);
      const info: HardwareInfo = {
        cpuCores: raw.cpuCores,
        deviceMemory: raw.deviceMemory,
        webgpu: gpu,
        threads,
        userAgent: raw.userAgent,
        platform: raw.platform,
      };
      setHw(info);
      setWebgpu(gpu);
    })();
  }, []);

  const meetsMinimum = hw ? hw.cpuCores >= 2 : false;
  const ramOk = hw?.deviceMemory ? hw.deviceMemory >= 2 : true; // Если не доступно, не пугаем пользователя

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45 }}
      className="max-w-3xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/15 mb-5">
          <AlertTriangle className="w-8 h-8 text-amber-400" />
        </div>
        <h2 className="text-3xl font-bold mb-3">{t("Ресурсы вашего компьютера")}</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          {t("VoxPaperAi работает локально — все вычисления идут на вашем CPU и GPU. Распознавание речи нагружает процессор, поэтому важно понимать, что вы готовы запустить.")} </p>
      </div>

      {hw ? (
        <div className="glass-card rounded-2xl p-6 mb-8">
          <h3 className="font-semibold mb-5 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-[#7c5bf5]" />
            {t("Обнаруженное железо")} </h3>
          <div className="grid grid-cols-2 gap-4">
            <SpecRow
              icon={Cpu}
              label={t("Процессор (ядра)")}
              value={t("{n} ядер", { n: hw.cpuCores })}
              ok={meetsMinimum}
            />
            <SpecRow
              icon={MemoryStick}
              label={t("Оперативная память")}
              value={hw.deviceMemory ? `${hw.deviceMemory} ГБ` : t("Недоступно для проверки")}
              ok={ramOk}
            />
            <SpecRow
              icon={Gauge}
              label={t("Потоки для Whisper")}
              value={t("{n} (рекомендация)", { n: hw.threads })}
              ok
            />
            <SpecRow
              icon={Zap}
              label={t("WebGPU ускорение")}
              value={webgpu ? t("Доступно") : "WASM (CPU)"}
              ok={!!webgpu}
              warn={!webgpu}
            />
          </div>
          <div className="mt-5 pt-5 border-t border-[#263147] text-xs text-muted-foreground">
            <p className="mb-1">
              <span className="text-foreground font-medium">{t("Платформа:")}</span> {hw.platform || t("неизвестно")}
            </p>
            <p>
              {t("Браузер:")} {parseBrowser(hw.userAgent)}
            </p>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-6 mb-8 text-center text-muted-foreground">
          {t("Анализируем ваше железо…")} </div>
      )}

      <div className="glass-card rounded-2xl p-5 mb-8 border-amber-500/30">
        <div className="flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="text-foreground font-medium mb-1">{t("Что будет происходить:")}</p>
            <ul className="space-y-1.5 list-disc list-inside">
              <li>{t("CPU будет загружен на ~70-90% во время распознавания")}</li>
              <li>{t("При наличии WebGPU часть работы возьмёт на себя видеокарта")}</li>
              <li>{t("Whisper займёт до 1.5 ГБ оперативной памяти")}</li>
              <li>{t("Все файлы остаются на вашем устройстве — ничего не уходит в интернет")}</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="text-center">
        <button
          onClick={onNext}
          disabled={!hw}
          className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
        >
          {t("Понятно, продолжить →")} </button>
      </div>
    </motion.div>
  );
}

function SpecRow({
  icon: Icon,
  label,
  value,
  ok,
  warn = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  ok: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-[#0b0f19]/40">
      <div className="w-9 h-9 rounded-lg bg-[#1b2334] flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-[#7c5bf5]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground truncate">{label}</div>
        <div className="font-medium text-sm truncate">{value}</div>
      </div>
      {ok ? (
        <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
      ) : warn ? (
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
      ) : (
        <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
      )}
    </div>
  );
}

function parseBrowser(ua: string): string {
  if (/edg/i.test(ua)) return "Microsoft Edge";
  if (/chrome/i.test(ua)) return "Google Chrome";
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return "Safari";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/opera|opr/i.test(ua)) return "Opera";
  return translate("Неизвестный браузер");
}
