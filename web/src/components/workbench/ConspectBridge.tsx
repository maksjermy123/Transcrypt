"use client";

/**
 * «Конспект в AI» — мост к нейросетям без ключей и аккаунтов (Путь А).
 *
 * Как работает (по решению пользователя): транскрипт уходит ФАЙЛОМ,
 * промт — ТЕКСТОМ в буфер обмена:
 *   1. Сайт скачивает транскрипт как .txt (полотно в URL не влезает,
 *      а файлом AI принимает любой объём).
 *   2. Промт-задание копируется в буфер обмена.
 *   3. Открывается вкладка выбранного AI (ChatGPT/Claude/Perplexity/Gemini) —
 *      пользователь прикрепляет файл, вставляет промт (Ctrl+V) и отправляет.
 * Логинимся мы нигде: пользователь пользуется СВОИМ аккаунтом AI.
 */

import { useState } from "react";
import { Sparkles, ChevronDown, FileText, Copy, Check, ExternalLink, HelpCircle } from "lucide-react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { downloadFile, formatStamp, type Segment } from "@/lib/subtitles";

type ProviderId = "chatgpt" | "claude" | "perplexity" | "gemini";

const PROVIDERS: { id: ProviderId; label: string; url: string; hint: string }[] = [
  { id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/", hint: "Открыть чат ChatGPT" },
  { id: "claude", label: "Claude", url: "https://claude.ai/new", hint: "Новый чат Claude" },
  { id: "perplexity", label: "Perplexity", url: "https://www.perplexity.ai/", hint: "Открыть Perplexity" },
  { id: "gemini", label: "Gemini", url: "https://gemini.google.com/app", hint: "Открыть Gemini" },
];

type TemplateId = "lecture" | "summary" | "questions" | "flashcards";

const TEMPLATES: { id: TemplateId; label: string; build: (ctx: { title: string }) => string }[] = [
  {
    id: "lecture",
    label: "Конспект лекции",
    build: ({ title }) =>
      `Я приложил(а) файл с транскриптом («${title}»).\n\n` +
      "Сделай по нему подробный конспект для подготовки к занятиям:\n" +
      "1. Тема и основные вопросы, которые разбираются.\n" +
      "2. Тезисы по смысловым разделам (с подзаголовками).\n" +
      "3. Все термины и определения — отдельным блоком «Словарь».\n" +
      "4. Примеры и аргументы, которыми это подтверждается.\n" +
      "5. Итог: 3–5 главных мыслей и что важно для экзамена.\n\n" +
      "Пиши структурировано (Markdown, заголовки и списки). Не выдумывай то, чего нет в транскрипте.",
  },
  {
    id: "summary",
    label: "Краткое резюме",
    build: ({ title }) =>
      `Я приложил(а) файл с транскриптом («${title}»). Сделай краткое резюме: ` +
      "5–7 предложений, передающих суть. Затем списком: 3 главных вывода. " +
      "Пиши только по материалу транскрипта, без домыслов.",
  },
  {
    id: "questions",
    label: "Вопросы для самопроверки",
    build: ({ title }) =>
      `Я приложил(а) файл с транскриптом («${title}»). Составь 12–15 вопросов для самопроверки ` +
      "по этому материалу: от простых (факты) к сложным (анализ и применение). " +
      "В конце дай блок «Ответы» с краткими ответами на каждый вопрос.",
  },
  {
    id: "flashcards",
    label: "Карточки для запоминания",
    build: ({ title }) =>
      `Я приложил(а) файл с транскриптом («${title}»). Составь 15–20 карточек для запоминания ` +
      "в формате «Вопрос — короткий ответ» (одна строка: вопрос; следующая — ответ). " +
      "Термины, даты, формулы и классификации — в первую очередь. Только факты из транскрипта.",
  },
];

const TEMPLATE_PREF_KEY = "transcrypt.prefs.conspectTemplate";

interface ConspectBridgeProps {
  /** Текст, который уйдёт файлом (текущий вид: перевод или оригинал) */
  text: string;
  segments: Segment[];
  sourceLabel?: string;
}

export function ConspectBridge({ text, segments, sourceLabel }: ConspectBridgeProps) {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<TemplateId>(() => {
    try {
      const saved = localStorage.getItem(TEMPLATE_PREF_KEY);
      return TEMPLATES.some((t) => t.id === saved) ? (saved as TemplateId) : "lecture";
    } catch {
      return "lecture";
    }
  });
  const [sent, setSent] = useState<{
    providerLabel: string;
    providerUrl: string;
    fileName: string;
  } | null>(null);
  const [copiedFlag, setCopiedFlag] = useState(false);

  function transcriptFileName(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `transkript-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.txt`;
  }

  function buildTranscriptFile(): string {
    const lines = [
      `Транскрипт: ${sourceLabel || "аудио/видео"}`,
      `Создан: ${new Date().toLocaleString("ru-RU")}`,
      "",
    ];
    if (segments.length > 0) {
      lines.push(...segments.map((s) => `[${formatStamp(s.timestamp[0])}] ${s.text.trim()}`));
    } else {
      lines.push(text);
    }
    return lines.join("\n");
  }

  async function launch(provider: (typeof PROVIDERS)[number]) {
    const fileName = transcriptFileName();
    const title = sourceLabel || "лекция/запись";
    // 1. Транскрипт — файлом (AI-чаты принимают файлы любого объёма)
    downloadFile(fileName, buildTranscriptFile(), "text/plain");
    // 2. Промт — текстом в буфер обмена
    const prompt = TEMPLATES.find((t) => t.id === template)?.build({ title }) ?? "";
    await copyTextToClipboard(prompt);
    setCopiedFlag(true);
    setTimeout(() => setCopiedFlag(false), 3000);
    // 3. Вкладка AI — пользователь прикрепляет файл и вставляет промт
    window.open(provider.url, "_blank", "noopener,noreferrer");
    setSent({ providerLabel: provider.label, providerUrl: provider.url, fileName });
    try {
      localStorage.setItem(TEMPLATE_PREF_KEY, template);
    } catch {
      /* ignore */
    }
  }

  async function reCopyPrompt() {
    const title = sourceLabel || "лекция/запись";
    const ok = await copyTextToClipboard(TEMPLATES.find((t) => t.id === template)?.build({ title }) ?? "");
    if (ok) {
      setCopiedFlag(true);
      setTimeout(() => setCopiedFlag(false), 2000);
    }
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-[#7c5bf5] flex-shrink-0" />
          <span className="text-sm font-semibold">Конспект в AI</span>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as TemplateId)}
            className="bg-[#0b0f19] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs"
            title="Что попросить у нейросети"
          >
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="bg-gradient-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:opacity-90 inline-flex items-center gap-2"
        >
          Открыть в моём AI
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => launch(p)}
              title={p.hint}
              className="px-3 py-2.5 rounded-xl bg-[#1b2334] hover:bg-[#263147] text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#7c5bf5]" />
              {p.label}
            </button>
          ))}
        </div>
      )}

      {sent && (
        <div className="mt-3 rounded-xl border border-[#7c5bf5]/30 bg-[#7c5bf5]/10 p-3 text-xs text-[#cfc2ff] space-y-2">
          <p className="font-medium text-[13px]">
            Файл «{sent.fileName}» скачан, промт скопирован. Открываем {sent.providerLabel} — осталось три шага:
          </p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>Прикрепите скачанный файл кнопкой со скрепкой (+ / «Прикрепить файл»)</li>
            <li>Вставьте промт из буфера обмена (Ctrl+V / Cmd+V)</li>
            <li>Отправьте сообщение</li>
          </ol>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={reCopyPrompt}
              className="px-2.5 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5"
            >
              {copiedFlag ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedFlag ? "Скопировано" : "Скопировать промт ещё раз"}
            </button>
            <button
              onClick={() => downloadFile(sent.fileName, buildTranscriptFile(), "text/plain")}
              className="px-2.5 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              Скачать файл ещё раз
            </button>
            <button
              onClick={() => window.open(sent.providerUrl, "_blank", "noopener,noreferrer")}
              className="px-2.5 py-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-xs font-medium inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Открыть {sent.providerLabel}
            </button>
          </div>
          <p className="text-muted-foreground flex items-start gap-1.5 pt-0.5">
            <HelpCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            Логинимся к вашему AI — VoxPaperAi не видит ваш аккаунт: промт и файл остаются на вашем компьютере до отправки.
          </p>
        </div>
      )}
    </div>
  );
}
