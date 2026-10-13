"""Small, UI-independent decisions used by the transcription pipeline."""


def needs_translation(
    target_language: str,
    requested_source_language: str,
    detected_source_language: str | None = None,
    subtitle_language: str | None = None,
) -> bool:
    """Return whether translation is useful for the resulting text.

    Whisper returns the detected language when the requested source language is
    ``auto``. That value is more reliable than the UI selection for deciding
    whether a translation would merely translate Russian back into Russian.
    """
    target = (target_language or "-").strip().lower()
    if target in {"", "-"}:
        return False

    source = subtitle_language or detected_source_language or requested_source_language
    source = (source or "").strip().lower()
    if source and source != "auto" and source == target:
        return False
    return True
