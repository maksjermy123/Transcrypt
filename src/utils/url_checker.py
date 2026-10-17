# -*- coding: utf-8 -*-
"""Проверка ссылок: это страница с видео или нет.

Задача: отсечь ссылки, которые НЕ ведут на конкретный ролик, ДО отправки
в обработку — иначе пользователь ждёт минутами и получает непонятную ошибку
yt-dlp (классика: ссылка на YouTube Studio или на канал вместо видео).

Точная синхронизация с веб-классификатором classifyVideoUrl
(web/src/components/workbench/InboxQueue.tsx) — правила и приоритеты совпадают.

Вердикты:
  VIDEO      — уверенно страница конкретного видео/аудио (есть ID ролика);
  UNKNOWN    — проверить нельзя (сокращённые ссылки, живые эфиры, чужие домены,
               yt-dlp поддерживает 1000+ сайтов) — пропускаем как раньше;
  NOT_VIDEO  — уверенно НЕ видео (канал, студия, плейлист, профиль, поиск,
               разделы каталога) — отклоняем с объяснением.
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

VIDEO = "video"
UNKNOWN = "unknown"
NOT_VIDEO = "not_video"

# Подсказки о причине отказа (синхронизированы с вебом)
YOUTUBE_PAGE = "youtube-page"  # студия/канал/страница YouTube
PLAYLIST = "playlist"          # плейлист, а не ролик
PROFILE = "profile"            # профиль/канал, а не ролик
SECTION = "section"            # поиск/каталог/служебный раздел

YT_VIDEO_ID = r"[A-Za-z0-9_-]{11}"

# ── Тексты-объяснения для ссылок «не на видео» (как в вебе) ──
NOT_VIDEO_MESSAGES = {
    YOUTUBE_PAGE: (
        "это страница канала или студии YouTube, а не видео. "
        "Нужна ссылка на конкретный ролик (youtube.com/watch?v=… или youtu.be/…)."
    ),
    PLAYLIST: (
        "это плейлист, а не отдельное видео. "
        "Нужна ссылка на конкретный ролик (youtube.com/watch?v=…)."
    ),
    PROFILE: (
        "это страница профиля или канала, а не конкретное видео. "
        "Откройте нужный ролик и скопируйте ссылку на него."
    ),
    SECTION: (
        "это раздел сайта (поиск или каталог), а не видео. "
        "Откройте нужный ролик и скопируйте ссылку на него."
    ),
}

_TRIM_CHARS = "\"'\u00ab\u00bb)hetian…  "  # используется только в справочнике ниже


def tidy_url(raw: str) -> str:
    """Срезает хвостовую пунктуацию и закрывающие скобки, разворачивает &amp;."""
    u = (raw or "").strip().replace("&amp;", "&")
    # Срезаем хвостовую пунктуацию и непарные закрывающие скобки.
    while u:
        last = u[-1]
        if last in TRAILING_URL_PUNCT:
            # Парная закрывающая скобка: срезаем, только если внутри нет открывающей.
            if last == ")" and "(" in u:
                break
            if last == "}" and "{" in u:
                break
            if last == "]" and "[" in u:
                break
            u = u[:-1]
            continue
        break
    return u


TRAILING_URL_PUNCT = set(".,;:!?…\"'\u00bb\u00ab)}]>]")


def short_url_label(u: str, max_len: int = 60) -> str:
    """Короткое отображение ссылки для сообщений (длинные обрезаем)."""
    u = u or ""
    return u if len(u) <= max_len else u[: max_len - 1] + "…"


def not_video_message(url: str, hint: str) -> str:
    """Текст-объяснение, почему ссылка отклонена (по подсказке классификатора)."""
    shown = short_url_label(url)
    reason = NOT_VIDEO_MESSAGES.get(hint, NOT_VIDEO_MESSAGES[SECTION])
    return f"Ссылка {shown} пропущена — {reason}"


def classify_url(raw: str) -> tuple[str, str | None]:
    """Классифицирует ссылку.

    Возвращает (verdict, hint): hint не None только для NOT_VIDEO.
    Никогда не бросает исключений.
    """
    try:
        u = (raw or "").strip()
        if not u:
            return UNKNOWN, None
        if "://" not in u:
            u = "https://" + u
        try:
            parts = urlsplit(u)
        except ValueError:
            return UNKNOWN, None
        scheme = (parts.scheme or "").lower()
        if scheme not in ("http", "https"):
            return UNKNOWN, None
        host = (parts.hostname or "").lower()
        if host.startswith("www."):
            host = host[4:]
        path = parts.path or "/"
        search = ("?" + parts.query) if parts.query else ""
        return _classify(host, path, search)
    except Exception:
        return UNKNOWN, None


def _classify(host: str, path: str, search: str) -> tuple[str, str | None]:
    # ── YouTube (вкл. studio./m./music./nocookie/youtu.be) ──
    if re.search(r"(^|\.)youtube\.com$|(^|\.)youtube-nocookie\.com$|^youtu\.be$", host):
        if host == "studio.youtube.com":
            return NOT_VIDEO, YOUTUBE_PAGE
        if host == "youtu.be":
            vid = path.lstrip("/").split("/")[0]
            if re.match(rf"^{YT_VIDEO_ID}", vid):
                return VIDEO, None
            if path in ("/", ""):
                return NOT_VIDEO, YOUTUBE_PAGE
            return UNKNOWN, None
        if path == "/watch":
            if re.search(rf"[?&]v={YT_VIDEO_ID}", search):
                return VIDEO, None
            return NOT_VIDEO, YOUTUBE_PAGE
        if re.match(rf"^/(?:shorts|embed|live|v)/{YT_VIDEO_ID}", path) and "videoseries" not in path:
            return VIDEO, None
        if (
            re.match(
                r"^(?:/(?:playlist|channel|c|user|results|feed|gaming|trending)(?:/|$)|/@|/(?:embed/)?videoseries(?:/|$))",
                path,
            )
            or path in ("/", "")
        ):
            hint = PLAYLIST if path.startswith("/playlist") or "videoseries" in path else YOUTUBE_PAGE
            return NOT_VIDEO, hint
        return UNKNOWN, None

    # ── VK / VK Видео ──
    if re.search(r"(^|\.)vk\.com$|(^|\.)vk\.ru$|(^|\.)vkvideo\.(?:ru|com)$", host):
        if re.match(r"^/(?:video|clip)[-_\d]", path):
            return VIDEO, None
        if path in ("/video", "/clip"):
            if re.search(r"z=(?:video|clip)[-_\d]", search):
                return VIDEO, None
            return NOT_VIDEO, SECTION
        if re.match(r"^/video_ext\.php$", path):
            if re.search(r"[?&](?:oid|id)=", search):
                return VIDEO, None
            return NOT_VIDEO, SECTION
        return NOT_VIDEO, PROFILE

    # ── Rutube ──
    if re.search(r"(^|\.)rutube\.ru$", host):
        if re.match(r"^/video/[0-9a-f]{32}/?$", path, re.IGNORECASE):
            return VIDEO, None
        if re.match(r"^/(?:play/embed|shorts)/[0-9a-z-]+/?$", path, re.IGNORECASE):
            return VIDEO, None
        if re.match(r"^(?:/$|/(?:channel|hashtags?|search|feed|categor\w*)\b)", path):
            return NOT_VIDEO, PROFILE
        return UNKNOWN, None

    # ── Дзен ──
    if re.search(r"(^|\.)dzen\.ru$", host):
        if re.match(r"^/video/watch/[^/]+", path) or re.match(r"^/shorts/[^/]+", path):
            return VIDEO, None
        return NOT_VIDEO, PROFILE

    # ── TikTok (вкл. vt.tiktok.com — сокращения не проверить) ──
    if re.search(r"(^|\.)tiktok\.com$", host):
        if re.match(r"^/@[A-Za-z0-9._-]+/(?:video|photo)/\d+", path):
            return VIDEO, None
        if re.match(r"^/@[A-Za-z0-9._-]+/?$", path):
            return NOT_VIDEO, PROFILE
        if re.match(r"^/(?:discover|tag|music|hashtag)", path):
            return NOT_VIDEO, SECTION
        return UNKNOWN, None

    # ── Twitch ──
    if re.search(r"(^|\.)twitch\.tv$", host):
        if host.startswith("clips."):
            return (VIDEO, None) if len(path) > 1 else (NOT_VIDEO, SECTION)
        if re.match(r"^/videos/\d+", path) or re.match(r"^/[^/]+/clip/", path):
            return VIDEO, None
        return UNKNOWN, None  # канал может быть в прямом эфире

    # ── Vimeo ──
    if re.search(r"(^|\.)vimeo\.com$", host):
        if re.match(r"^/(?:video/)?\d+(?:$|[/?])", path):
            return VIDEO, None
        if re.match(r"^/user\d+/review/", path):
            return VIDEO, None
        if re.match(r"^(?:/$|/(?:channels?|groups?|categories?|album|showcase|user\d+))", path):
            return NOT_VIDEO, PROFILE
        return UNKNOWN, None

    # ── Одноклассники ──
    if re.search(r"(^|\.)ok\.ru$", host):
        if re.match(r"^/(?:video|videoembed|live)/\d+", path) or re.search(r"/status/\d+", path):
            return VIDEO, None
        if path in ("/", ""):
            return NOT_VIDEO, SECTION
        return UNKNOWN, None

    # ── Bilibili (b23.tv — сокращения не проверить) ──
    if re.search(r"(^|\.)bilibili\.com$", host):
        if re.match(r"^/video/[A-Za-z0-9]+", path) or re.match(r"^/bangumi/play/", path):
            return VIDEO, None
        if re.match(r"^/(?:space|user)", path):
            return NOT_VIDEO, PROFILE
        return UNKNOWN, None
    if host == "b23.tv":
        return UNKNOWN, None

    # ── X / Twitter (t.co — сокращения) ──
    if re.search(r"(^|\.)x\.com$|(^|\.)twitter\.com$", host):
        if re.match(r"^/[^/]+/status(?:es)?/\d+", path):
            return VIDEO, None
        if re.match(r"^/(?:home|explore|search|notifications|messages|settings|hashtag)\b", path):
            return NOT_VIDEO, SECTION
        return NOT_VIDEO, PROFILE
    if host == "t.co":
        return UNKNOWN, None

    # ── Facebook / fb.watch ──
    if re.search(r"(^|\.)facebook\.com$", host):
        if re.match(r"^/reel/\d+", path):
            return VIDEO, None
        if re.match(r"^/watch/?", path) and re.search(r"[?&]v=\d+", search):
            return VIDEO, None
        if re.match(r"^/(?:video\.php|watch/live)", path) and re.search(r"[?&]v=\d+", search):
            return VIDEO, None
        if re.match(r"^/[^/]+/videos/", path):
            return VIDEO, None
        if re.match(r"^/(?:reel|watch|videos)(?:/|$)", path):
            return NOT_VIDEO, SECTION
        return UNKNOWN, None
    if host == "fb.watch":
        return UNKNOWN, None

    # ── Instagram ──
    if re.search(r"(^|\.)instagram\.com$", host):
        if re.match(r"^/(?:reel|reels|p|tv)/[A-Za-z0-9_-]+", path):
            return VIDEO, None
        if re.match(r"^/(?:explore|accounts)\b", path):
            return NOT_VIDEO, SECTION
        if re.match(r"^/[A-Za-z0-9._]+/?$", path):
            return NOT_VIDEO, PROFILE
        return UNKNOWN, None

    # ── Threads ──
    if re.search(r"(^|\.)threads\.(?:net|com)$", host):
        if re.match(r"^/[^/]+/post/[A-Za-z0-9_-]+", path):
            return VIDEO, None
        if re.match(r"^/@", path):
            return NOT_VIDEO, PROFILE
        return UNKNOWN, None

    # ── SoundCloud ──
    if re.search(r"(^|\.)soundcloud\.com$", host):
        if host.startswith("on."):
            return UNKNOWN, None  # on.soundcloud.com — сокращения
        if re.match(r"^/(?:discover|search|charts|feed|you|upload)\b", path):
            return NOT_VIDEO, SECTION
        if re.match(r"^/[^/]+/[^/?#]+", path):
            return VIDEO, None  # исполнитель/трек
        return NOT_VIDEO, PROFILE

    # ── Loom ──
    if re.search(r"(^|\.)loom\.com$", host):
        if re.match(r"^/(?:share|embed|recordings?)/[A-Za-z0-9]+", path):
            return VIDEO, None
        return UNKNOWN, None

    # ── Rumble ──
    if re.search(r"(^|\.)rumble\.com$", host):
        if re.match(r"^/(?:embed|v)/[A-Za-z0-9]+", path) or re.match(r"^/[A-Za-z0-9]+-[^/]*\.html", path):
            return VIDEO, None
        if re.match(r"^/(?:user|search|browse)\b", path):
            return NOT_VIDEO, SECTION
        return UNKNOWN, None

    # ── Odysee ──
    if re.search(r"(^|\.)odysee\.com$", host):
        if re.match(r"^/@[^/]+/[^/]+", path):
            return VIDEO, None
        return UNKNOWN, None

    # ── BitChute ──
    if re.search(r"(^|\.)bitchute\.com$", host):
        if re.match(r"^/(?:video|embed)/[A-Za-z0-9]+", path):
            return VIDEO, None
        if re.match(r"^/channel/", path):
            return NOT_VIDEO, PROFILE
        return UNKNOWN, None

    # ── Streamable ──
    if re.search(r"(^|\.)streamable\.com$", host):
        if re.match(r"^/[A-Za-z0-9]+/?$", path):
            return VIDEO, None
        return UNKNOWN, None

    # ── Reddit (redd.it — сокращения) ──
    if re.search(r"(^|\.)reddit\.com$", host):
        if re.match(r"^/r/[^/]+/comments/[A-Za-z0-9]+", path):
            return VIDEO, None
        if re.match(r"^/(?:user|r)/", path):
            return NOT_VIDEO, PROFILE
        return UNKNOWN, None
    if host == "redd.it":
        return UNKNOWN, None

    # ── Dailymotion / dai.ly ──
    if re.search(r"(^|\.)dailymotion\.com$", host):
        if re.match(r"^/(?:video|embed/video)/[A-Za-z0-9]+", path):
            return VIDEO, None
        if re.match(r"^(?:/$|/(?:search|profile|channel|playlist)\b)", path):
            return NOT_VIDEO, SECTION
        return UNKNOWN, None
    if host == "dai.ly":
        return (VIDEO, None) if len(path) > 1 else (NOT_VIDEO, SECTION)

    return UNKNOWN, None


def filter_video_urls(urls: list[str]) -> tuple[list[str], list[str]]:
    """Прогоняет список ссылок через классификатор.

    Возвращает (accepted, rejected_messages): принятые ссылки в исходном
    порядке и список текстов-объяснений для отклонённых.
    """
    accepted: list[str] = []
    rejected: list[str] = []
    seen: set[str] = set()
    for raw in urls:
        url = tidy_url(raw)
        if not url or len(url) <= 4 or url in seen:
            continue
        seen.add(url)
        verdict, hint = classify_url(url)
        if verdict == NOT_VIDEO:
            rejected.append(not_video_message(url, hint or SECTION))
        else:
            accepted.append(url)
    return accepted, rejected


# Ссылки, добавляемые в списки, всегда с протоколом; для устойчивости к
# «грязному» тексту чистим хвост. Используется file_list и импортом из файлов.
URL_EXTRACT_RE = re.compile(r"https?://[^\s<>\"'`]+", re.IGNORECASE)


def extract_urls_from_text(text: str) -> list[str]:
    """Достаёт все http(s)-ссылки из текста (в любом месте строки), без дублей."""
    if not text:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for match in URL_EXTRACT_RE.findall(text):
        u = tidy_url(match)
        if u and len(u) > 4 and u not in seen:
            seen.add(u)
            out.append(u)
    return out
