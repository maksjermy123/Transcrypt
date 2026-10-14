"use client";

import { motion } from "framer-motion";
import { Upload, Download, Trash2, FileText, Loader2, Languages as LangIcon } from "lucide-react";
import { useState, useCallback, useRef } from "react";
import { LANGUAGES, translateText } from "@/lib/translator";
import { downloadFile } from "@/lib/subtitles";

export function TranslateTab() {
  const [text, setText] = useState("");
  const [source, setSource] = useState("ru");
  const [target, setTarget] = useState("en");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult("");
    try {
      const out = await translateText(text, target, source);
      setResult(out);
    } catch (err: any) {
      setError(err?.message ?? "Ошибка перевода");
    } finally {
      setLoading(false);
    }
  }

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("text/")) {
      const t = await f.text();
      setText(t);
    }
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) {
      setError("Файл слишком большой (макс 1 МБ для текста)");
      return;
    }
    const t = await f.text();
    setText(t);
  }

  function download() {
    const name = `transcrypt_${source}-${target}.txt`;
    downloadFile(name, result, "text/plain");
  }

  function swapLangs() {
    setSource(target);
    setTarget(source);
    setText(result);
    setResult(text);
  }

  const charCount = text.length;
  const chunkCount = Math.ceil(charCount / 4500);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Перевод текста</h1>
        <p className="text-sm text-muted-foreground">
          Бесплатный перевод через MyMemory API. Текст делится на чанки и
          переводится по границам предложений. Поддержка 14 языков.
        </p>
      </div>

      {/* Языки */}
      <div className="glass-card rounded-2xl p-4 mb-5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <LangIcon className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">С:</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-1.5 text-sm"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={swapLangs}
          className="p-1.5 rounded-lg bg-[#1b2334] hover:bg-[#263147] text-muted-foreground hover:text-foreground"
          title="Поменять местами"
        >
          ⇄
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">На:</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="bg-[#0b0f19] border border-[#263147] rounded-lg px-3 py-1.5 text-sm"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {charCount} символов{chunkCount > 1 ? ` · ${chunkCount} чанков` : ""}
        </div>
      </div>

      {/* Ввод/вывод */}
      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Исходный текст</h3>
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="text-xs text-[#7c5bf5] hover:underline inline-flex items-center gap-1"
              >
                <Upload className="w-3 h-3" />
                Файл
              </button>
              {text && (
                <button
                  onClick={() => setText("")}
                  className="text-xs text-muted-foreground hover:text-red-400 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Очистить
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.csv,text/*"
            hidden
            onChange={handleFile}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            placeholder="Вставьте текст или перетащите .txt файл сюда…"
            className={`w-full h-72 bg-[#0b0f19] border ${
              dragOver ? "border-[#7c5bf5]" : "border-[#263147]"
            } rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-[#7c5bf5]/50`}
          />
        </div>

        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Перевод</h3>
            {result && (
              <button
                onClick={download}
                className="text-xs text-[#7c5bf5] hover:underline inline-flex items-center gap-1"
              >
                <Download className="w-3 h-3" />
                Скачать .txt
              </button>
            )}
          </div>
          <div className="w-full h-72 bg-[#0b0f19] border border-[#263147] rounded-xl p-3 text-sm overflow-y-auto whitespace-pre-wrap">
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Переводим…
              </div>
            ) : error ? (
              <div className="text-red-400 text-sm">{error}</div>
            ) : result ? (
              result
            ) : (
              <div className="text-muted-foreground text-sm">Здесь появится перевод…</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <button
          onClick={run}
          disabled={!text.trim() || loading || source === target}
          className="bg-gradient-primary text-white px-8 py-3 rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed glow-primary inline-flex items-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Переводим…
            </>
          ) : (
            <>
              <Languages />
              Перевести
            </>
          )}
        </button>
      </div>

      <div className="mt-6 glass-card rounded-2xl p-4 flex gap-3">
        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Про перевод:</p>
          Бесплатный MyMemory API переводит по 4500 символов за запрос. Лимит
          50000 слов/день. Для конфиденциальных файлов рекомендуется сначала
          транскрибировать локально через Whisper, а затем перевести здесь.
        </div>
      </div>
    </div>
  );
}

function Languages() {
  return <LangIcon className="w-4 h-4" />;
}
