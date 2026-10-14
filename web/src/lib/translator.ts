"use client";

/**
 * Бесплатный перевод текста через MyMemory API.
 * — Не требует API-ключа
 * — Поддерживает CORS
 * — Лимит: ~5000 символов на запрос и 50000 слов/день
 * — Разбиваем длинный текст на чанки по границам предложений.
 */

const MAX_CHARS = 4500;

function chunkText(text: string, max = MAX_CHARS): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let buf = "";
  // Разделяем по предложениям (точка/воскл/вопр + пробел/перенос)
  const sentences = text.match(/[^.!?…]+[.!?…]*/g) || [text];
  for (const s of sentences) {
    if ((buf + s).length > max) {
      if (buf) parts.push(buf.trim());
      buf = s;
      if (buf.length > max) {
        // Очень длинное предложение — режем по словам
        const words = buf.split(/\s+/);
        buf = "";
        for (const w of words) {
          if ((buf + " " + w).length > max) {
            if (buf) parts.push(buf.trim());
            buf = w;
          } else {
            buf += (buf ? " " : "") + w;
          }
        }
      }
    } else {
      buf += s;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

export async function translateText(
  text: string,
  targetLang: string,
  sourceLang: string = "ru"
): Promise<string> {
  const chunks = chunkText(text);
  const translated: string[] = [];

  for (const chunk of chunks) {
    const url =
      "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(chunk) +
      `&langpair=${sourceLang}|${targetLang}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Ошибка перевода: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const t = data?.responseData?.translatedText;
    if (!t) {
      throw new Error("Не удалось получить перевод: " + (data?.responseStatus ?? "unknown"));
    }
    translated.push(t);
  }

  return translated.join(" ");
}

export const LANGUAGES: { code: string; name: string }[] = [
  { code: "ru", name: "Русский" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Português" },
  { code: "uk", name: "Українська" },
  { code: "pl", name: "Polski" },
  { code: "tr", name: "Türkçe" },
  { code: "ar", name: "العربية" },
  { code: "zh", name: "中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
];
