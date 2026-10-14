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

/**
 * Прямой вызов MyMemory из браузера (CORS разрешён, без ключа).
 * Использует квоту IP пользователя — работает даже без серверного прокси
 * (например, на статичном GitHub Pages).
 *
 * ⚠️ У MyMemory жёсткий лимит — 500 символов на запрос; при превышении API
 * возвращает 403 с текстом "QUERY LENGTH LIMIT EXCEEDED..." в translatedText.
 * Поэтому режем до 480 и распознаём ошибочные ответы (раньше текст ошибки
 * мог тихо вернуться как «перевод»).
 */
const MYMEMORY_ERR_RE =
  /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID (SOURCE|TARGET|LANG)|PLEASE SELECT|NO QUERY|API KEY/i;

async function myMemoryClientTranslate(text: string, targetLang: string): Promise<string> {
  const resp = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=autodetect|${encodeURIComponent(targetLang)}`,
    { signal: AbortSignal.timeout(20000) }
  );
  if (!resp.ok) throw new Error(`MyMemory HTTP ${resp.status}`);
  const data = await resp.json();
  const status = data?.responseStatus;
  const t = data?.responseData?.translatedText;
  if (status !== 200 || typeof t !== "string" || !t.trim() || MYMEMORY_ERR_RE.test(t)) {
    throw new Error(
      `MyMemory: ${typeof t === "string" ? t.slice(0, 90) : "пустой ответ"}`
    );
  }
  return t;
}

/**
 * MyMemory ≤500 символов за запрос — длинный текст режем на куски ≤480
 * и склеиваем ответы. Бросает ошибку, если не перевелся ни один кусок.
 */
async function myMemoryLongTranslate(text: string, targetLang: string): Promise<string> {
  if (text.length <= 480) return myMemoryClientTranslate(text, targetLang);
  const pieces = splitTextChunks(text, 480);
  const out: string[] = [];
  let lastErr: Error | null = null;
  for (const p of pieces) {
    try {
      out.push(await myMemoryClientTranslate(p, targetLang));
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      out.push(p); // не теряем кусок — оставляем оригинал
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (out.length && out.every((o, i) => o === pieces[i])) {
    throw lastErr ?? new Error("MyMemory: не удалось перевести текст");
  }
  return out.join(" ");
}

/**
 * Запрос к серверному прокси /api/translate.
 * Возвращает null, если прокси недоступен (статичный хостинг без API) —
 * тогда вызывающий код переключается на клиентский фолбэк.
 * «Недоступен» = сбой сети, 404/405 ИЛИ ответ не в формате нашего прокси
 * (например, HTML-страница 501 от статического сервера вместо JSON).
 */
async function proxyTranslateOrNull(
  text: string,
  targetLang: string,
  provider: TranslateProvider,
  apiKey?: string
): Promise<string | null> {
  let resp: Response;
  try {
    resp = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, target_lang: targetLang, provider, api_key: apiKey || undefined }),
    });
  } catch {
    return null; // сеть недоступна / прокси не существует
  }
  if (resp.status === 404 || resp.status === 405) return null;

  const data = await resp.json().catch(() => null);
  if (!data || (data.status !== "success" && data.status !== "error")) {
    return null; // это не наш прокси (заглушка статического хостинга)
  }
  if (!resp.ok || data.status !== "success") {
    throw new Error(data?.message || `HTTP ${resp.status}`);
  }
  return data.translated_text as string;
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
      try {
        res = await engineTranslate(chunks[i], targetLang);
      } catch {
        /* движок недоступен — идём в прокси/MyMemory */
      }
    }

    if (res === null) {
      try {
        res = await proxyTranslateOrNull(chunks[i], targetLang, provider, apiKey);
      } catch (err) {
        // Прокси есть, но провайдер упал — последний шанс: MyMemory из браузера
        try {
          res = await myMemoryLongTranslate(chunks[i], targetLang);
        } catch {
          throw err;
        }
      }
      // Прокси отсутствует (статичный хостинг) — MyMemory напрямую
      if (res === null) {
        res = await myMemoryLongTranslate(chunks[i], targetLang);
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

  // ─── 1. Локальный движок (если online) ───
  // Движок не умеет батчи — шлём одну пачку с разделителем (Google сохраняет
  // маркеры-слова); при расхождении — по одной строке. Любая ошибка движка
  // не фатальна: идём дальше по цепочке (прокси → MyMemory).
  if (engineOnline && provider === "google") {
    try {
      const joined = texts.join(separator);
      const res = await engineTranslate(joined, targetLang);
      const parts = res.split(separator);
      if (parts.length === total) return parts;

      // Разделитель испорчен — по одной строке на движке
      const out: string[] = new Array(total).fill("");
      for (let i = 0; i < total; i++) {
        out[i] = texts[i]?.trim() ? await engineTranslate(texts[i], targetLang) : texts[i] ?? "";
        onProgress?.(Math.round(((i + 1) / total) * 100));
      }
      return out;
    } catch {
      /* движок недоступен/упал — fallback ниже */
    }
  }

  // ─── 2. Серверный прокси (нативный батч-режим) ───
  // null = прокси отсутствует (статичный хостинг: 404/405/сбой сети) — не ошибка.
  let proxyFailed: Error | null = null;
  try {
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
    if (resp.status === 404 || resp.status === 405) {
      // Статический хостинг без API-роута (например, GitHub Pages)
    } else {
      const data = await resp.json().catch(() => null);
      if (!data || (data.status !== "success" && data.status !== "error")) {
        // ответ не от нашего прокси (HTML-заглушка статики) — считаем прокси отсутствующим
      } else if (!resp.ok || data.status !== "success") {
        throw new Error(data?.message || `HTTP ${resp.status}`);
      } else {
        onProgress?.(100);
        return data.batch as string[];
      }
    }
  } catch (err) {
    // Прокси есть, но провайдер упал (рейт-лимит и т.п.) — запомним и попробуем MyMemory
    proxyFailed = err instanceof Error ? err : new Error(String(err));
  }

  // ─── 3. MyMemory напрямую из браузера (статика или упавший прокси) ───
  // MyMemory принимает ≤500 символов, поэтому строки шлём по одной
  // (PDF-строки короткие). Ошибки отдельных строк не роняют файл:
  // непереведённые строки остаются с оригинальным текстом.
  const out: string[] = new Array(total).fill("");
  let done = 0;
  let failures = 0;
  let lastErr: Error | null = null;
  for (let i = 0; i < total; i++) {
    const piece = texts[i] ?? "";
    if (!piece.trim()) continue; // пустые остаются пустыми
    try {
      out[i] = await myMemoryClientTranslate(piece, targetLang);
    } catch (err) {
      out[i] = piece;
      failures++;
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
    done++;
    onProgress?.(Math.round((done / total) * 100));
    if (i < total - 1) await new Promise((r) => setTimeout(r, 150));
  }
  if (failures > 0 && failures >= done) {
    // не перевелось ни одной строки — отдаём самую информативную ошибку:
    // обычно это ответ MyMemory (квота/лимит), а не сетевой сбой прокси
    throw lastErr ?? proxyFailed ?? new Error("MyMemory: все строки не перевелись");
  }
  return out;
}
