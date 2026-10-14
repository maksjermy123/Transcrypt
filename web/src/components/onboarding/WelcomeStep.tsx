"use client";

import { motion } from "framer-motion";
import { Mic, Download, FileAudio, Languages, Cpu, ShieldCheck } from "lucide-react";

const features = [
  {
    icon: Mic,
    title: "Транскрипция аудио и видео",
    text: "Whisper превращает голос в текст прямо в вашем браузере. С таймкодами, без отправки файлов на сервер.",
  },
  {
    icon: FileAudio,
    title: "Готовые субтитры",
    text: "Экспорт в SRT, VTT и TXT — для видео, блогов, лекций и подкастов.",
  },
  {
    icon: Languages,
    title: "Перевод текста",
    text: "Бесплатный перевод между 14 языками через MyMemory API — никаких ключей и подписок.",
  },
  {
    icon: Cpu,
    title: "Ресурсы вашего ПК",
    text: "Распознавание идёт на CPU/GPU вашего компьютера. Приватно: файлы не покидают браузер.",
  },
  {
    icon: ShieldCheck,
    title: "Без установки и без архивов",
    text: "Ничего не нужно скачивать и распаковывать. Модель кешируется один раз и живёт в IndexedDB браузера.",
  },
  {
    icon: Download,
    title: "Бесплатно и навсегда",
    text: "GitHub Pages + Whisper в браузере. Никаких подписок, лимитов и платных API.",
  },
];

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-4xl mx-auto px-6 py-10"
    >
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-primary glow-primary mb-6">
          <Mic className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
          Привет! Это <span className="text-gradient">Transcrypt</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Локальный инструмент для транскрипции, субтитров и перевода. Whisper
          работает прямо в браузере, использует ресурсы вашего компьютера и
          ничего не отправляет в интернет.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08 }}
            className="glass-card rounded-2xl p-5 hover:border-[#7c5bf5]/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-[#7c5bf5]/15 flex items-center justify-center mb-3">
              <f.icon className="w-5 h-5 text-[#7c5bf5]" />
            </div>
            <h3 className="font-semibold mb-1.5">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {f.text}
            </p>
          </motion.div>
        ))}
      </div>

      <div className="text-center">
        <button
          onClick={onNext}
          className="bg-gradient-primary text-white px-8 py-3.5 rounded-xl font-medium hover:opacity-90 transition-opacity glow-primary"
        >
          Продолжить →
        </button>
        <p className="text-xs text-muted-foreground mt-4">
          Настройка займёт ~3 минуты. Модель скачается один раз и останется в кеше браузера.
        </p>
      </div>
    </motion.div>
  );
}
