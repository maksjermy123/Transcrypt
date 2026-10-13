"""Subtitle parsing shared by transcription and media pipelines."""

import re


def parse_subtitles(path: str) -> list[dict]:
    """Parse an SRT or VTT file into Whisper-compatible segments."""
    def clean(text: str) -> str:
        text = text.replace("\r", "\n")
        text = re.sub(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", "", text)
        text = re.sub(r"</?(?:c(?:\.[^>]*)?|v[^>]*|i|b|u)>", "", text)
        text = re.sub(r"<[^>]+>", "", text)
        return re.sub(r"\s+", " ", text).strip()

    def timestamp(value: str) -> float:
        parts = value.replace(",", ".").split(":")
        if len(parts) == 3:
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        raise ValueError(f"Unsupported subtitle timestamp: {value}")

    with open(path, "r", encoding="utf-8", errors="ignore") as handle:
        blocks = re.split(r"\n\s*\n", handle.read().replace("\r\n", "\n").replace("\r", "\n"))

    segments: list[dict] = []
    seen: set[tuple[float, str]] = set()
    for block in blocks:
        lines = block.strip().split("\n")
        timestamp_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timestamp_index is None:
            continue
        start_text, _, end_text = lines[timestamp_index].partition("-->")
        text = clean(" ".join(lines[timestamp_index + 1:]))
        if not text:
            continue
        try:
            start = timestamp(start_text.strip().split(" ")[0])
            end = timestamp(end_text.strip().split(" ")[0])
        except (ValueError, IndexError):
            continue
        key = (round(start, 2), text)
        if key not in seen:
            seen.add(key)
            segments.append({"start": start, "end": end, "text": text})
    return segments
