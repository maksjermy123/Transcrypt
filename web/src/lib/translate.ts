"use client";

/**
 * Клиентская библиотека перевода — веб-порт src/core/translator.py.
 *
 * Стратегия выбора транспорта:
 *  1. Если локальный движок (engine_server.py) online — шлём текст на него
 *     (POST /api/translate на 127.0.0.1:8765), как это делает десктоп.
 *  2. Иначе — на серверный прокси /api/translate (этот же сайт), который
 *     повторяет логику translator.py: Google gtx + чанкинг + ретраи.
 *
 * Локальный файл на переводы не влияет — они всегда идут через онлайн-API
 * (Google/DeepL), как и в десктопной версии.
 */

import type { EngineProgress } from "./engine-bridge";
export type { EngineProgress };

export type TranslateProvider = "google" | "deepl";

export type TranslateOptions = {
  targetLang: string;
  provider?: TranslateProvider;
  apiKey?: string;
  engineOnline?: boolean;
  onProgress?: (percent: number, eta?: string) => void;
};

/** Чанкинг — копия Translator._split_text_chunks (не режет слова) */
export function splitTextChunks(text: string, chunkSize = 1200): string[] {
  text = text || "";
  if (text.length <= chunkSize) return text ? [text] : [];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > chunkSize) {
    const window = remaining.slice(0, chunkSize);
    let cut = Math.max(
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? ")
    );
    if (cut < chunkSize / 2) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = chunkSize;
    chunks.push(remaining.slice(0, cut + 1).trimEnd());
    remaining = remaining.slice(cut + 1).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Запрос к локальному движку (Google-перевод на engine_server) */
async function engineTranslate(text: string, targetLang: string): Promise<string> {
  // Движок имеет отдельный эндпоинт /api/translate (без поллинга прогресса)
  const resp = await fetch("http://127.0.0.1:8765/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, target_lang: targetLang }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Движок: HTTP ${resp.status} ${t.slice(0, 120)}`);
  }
  const data = await resp.json();
  if (data.status !== "success") throw new Error(data.message || "Ошибка движка");
  return data.translated_text as string;
}

/** Запрос к серверному прокси /api/translate */
async function proxyTranslate(
  text: string,
  targetLang: string,
  provider: TranslateProvider,
  apiKey?: string
): Promise<string> {
  const resp = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      target_lang: targetLang,
      provider,
      api_key: apiKey || undefined,
    }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || data.status !== "success") {
    throw new Error(data?.message || `HTTP ${resp.status}`);
  }
  return data.translated_text as string;
}

/**
 * Прямой вызов MyMemory из браузера (CORS разрешён, без ключа).
 * Использует квоту IP пользователя — работает даже без серверного прокси
 * (например, на статичном GitHub Pages).
 */
async function myMemoryClientTranslate(text: string, targetLang: string): Promise<string> {
  const resp = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 4800))}&langpair=autodetect|${encodeURIComponent(targetLang)}`,
    { signal: AbortSignal.timeout(20000) }
  );
  if (!resp.ok) throw new Error(`MyMemory HTTP ${resp.status}`);
  const data = await resp.json();
  const t = data?.responseData?.translatedText;
  if (typeof t !== "string" || !t || t.includes("MYMEMORY WARNING")) {
    throw new Error("MyMemory: квота исчерпана или пустой ответ");
  }
  return t;
}

/**
 * Запрос к серверному прокси /api/translate.
 * Возвращает null, если прокси недоступен (статичный хостинг без API) —
 * тогда вызывающий код переключается на клиентский фолбэк.
 */
async function proxyTranslateOrNull(
  text: string,
  targetLang: string,
  provider: TranslateProvider,
  apiKey?: string
): Promise<string | null> {
  try {
    return await proxyTranslate(text, targetLang, provider, apiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404/405 = прокси не существует (статический хостинг) → пробуем клиентский фолбэк
    if (msg.includes("404") || msg.includes("405") || msg.includes("Failed to fetch")) {
      return null;
    }
    throw err; // реальная ошибка провайдера — отдаём наверх
  }
}

/**
 * Перевод текста. Копия Translator.translate_text: чанкинг, прогресс, ETA.
 * Цепочка: движок → серверный прокси (gtx → MyMemory → LLM) → MyMemory из браузера.
 */
export async function translateText(
  text: string,
  opts: TranslateOptions
): Promise<string> {
  const { targetLang, provider = "google", apiKey, engineOnline, onProgress } = opts;
  if (!text.trim()) return "";

  const chunks = splitTextChunks(text, 1200);
  const total = chunks.length;
  const started = Date.now();
  const out: string[] = [];

  for (let i = 0; i < total; i++) {
    let res: string | null = null;

    if (engineOnline && provider === "google") {
      res = await engineTranslate(chunks[i], targetLang);
    }

    if (res === null) {
      try {
        res = await proxyTranslateOrNull(chunks[i], targetLang, provider, apiKey);
      } catch (err) {
        // Прокси есть, но провайдер упал — последний шанс: MyMemory из браузера
        try {
          res = await myMemoryClientTranslate(chunks[i], targetLang);
        } catch {
          throw err;
        }
      }
      // Прокси отсутствует (статичный хостинг) — MyMemory напрямую
      if (res === null) {
        res = await myMemoryClientTranslate(chunks[i], targetLang);
      }
    }

    out.push(res);

    if (onProgress && total > 0) {
      const done = i + 1;
      let percent = Math.round((done / total) * 100);
      if (percent > 99) percent = 99;
      const elapsed = (Date.now() - started) / 1000;
      const speed = done / Math.max(elapsed, 0.001);
      const etaSec = (total - done) / Math.max(speed, 0.001);
      const eta =
        etaSec > 60
          ? `Осталось: ~${Math.floor(etaSec / 60)} мин. ${Math.round(etaSec % 60)} сек.`
          : `Осталось: ~${Math.round(etaSec)} сек.`;
      onProgress(percent, eta);
    }
    // Мягкая задержка между чанками (как в translator.py)
    if (total > 1) await new Promise((r) => setTimeout(r, 250));
  }
  return out.join("");
}

/**
 * Батч-перевод массива строк (для построчного PDF LAYOUT).
 * Копия Translator.translate_batch: строки объединяются разделителем в батчи
 * ≤2400 символов; если провайдер испортил разделитель — fallback по одной.
 */
export async function translateBatch(
  texts: string[],
  opts: TranslateOptions & { separator?: string }
): Promise<string[]> {
  const {
    targetLang,
    provider = "google",
    apiKey,
    engineOnline,
    onProgress,
    separator = "\n[[[VOXPAPER_SEG]]]\n",
  } = opts;

  const total = texts.length;
  if (!total) return [];

  // Движок не умеет батчи — если он online, шлём батчи группами на его эндпоинт по одной строке.
  // Для простоты при engineOnline отправляем одну большую пачку текстом с разделителем — движок
  // переведёт её как единый текст (Google сохраняет маркеры-слова).
  if (engineOnline && provider === "google") {
    const joined = texts.join(separator);
    try {
      const res = await engineTranslate(joined, targetLang);
      const parts = res.split(separator);
      if (parts.length === total) return parts;
    } catch {
      /* fallback ниже */
    }
    // Fallback: по одной строке на движке
    const out: string[] = [];
    for (let i = 0; i < total; i++) {
      out.push(texts[i]?.trim() ? await engineTranslate(texts[i], targetLang) : texts[i] ?? "");
      onProgress?.(Math.round(((i + 1) / total) * 100));
    }
    return out;
  }

  // Прокси умеет нативный батч-режим
  const resp = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      batch: texts,
      separator,
      target_lang: targetLang,
      provider,
      api_key: apiKey || undefined,
    }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || data.status !== "success") {
    throw new Error(data?.message || `HTTP ${resp.status}`);
  }
  onProgress?.(100);
  return data.batch as string[];
}
