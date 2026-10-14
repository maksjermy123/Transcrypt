"use client";

/**
 * Утилиты для генерации и скачивания файлов субтитров и текста.
 */

type Segment = { text: string; timestamp: [number, number] | [number, number | null] };

function formatTimestamp(seconds: number, sep: "," | "." = ","): string {
  const ms = Math.round((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms, 3)}`;
}

function pad(n: number, len: number): string {
  return n.toString().padStart(len, "0");
}

export function segmentsToSRT(segments: Segment[]): string {
  return segments
    .map((seg, i) => {
      const start = formatTimestamp(seg.timestamp[0], ",");
      const endRaw = seg.timestamp[1];
      const end = endRaw == null ? formatTimestamp(seg.timestamp[0] + 5, ",") : formatTimestamp(endRaw, ",");
      const text = seg.text.trim();
      return `${i + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join("\n");
}

export function segmentsToVTT(segments: Segment[]): string {
  const body = segments
    .map((seg) => {
      const start = formatTimestamp(seg.timestamp[0], ".");
      const endRaw = seg.timestamp[1];
      const end = endRaw == null ? formatTimestamp(seg.timestamp[0] + 5, ".") : formatTimestamp(endRaw, ".");
      const text = seg.text.trim();
      return `${start} --> ${end}\n${text}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export function segmentsToPlainText(segments: Segment[]): string {
  return segments.map((s) => s.text.trim()).join(" ");
}

export function downloadFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${pad(s, 2)}`;
}
