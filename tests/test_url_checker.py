# -*- coding: utf-8 -*-
"""Тесты классификатора ссылок (синхронизирован с веб-версией).

Прогон: python -m unittest tests.test_url_checker -v
(именно так тесты запускает CI) или pytest.
Покрывает: classify_url (видео / не-видео / unknown), filter_video_urls
и extract_urls_from_text. Кейсы повторяют веб-классификатор InboxQueue.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.utils.url_checker import (  # noqa: E402
    VIDEO,
    UNKNOWN,
    NOT_VIDEO,
    YOUTUBE_PAGE,
    PLAYLIST,
    PROFILE,
    SECTION,
    classify_url,
    filter_video_urls,
    extract_urls_from_text,
    tidy_url,
    not_video_message,
)


class UrlClassifierTests(unittest.TestCase):
    def verdict(self, url):
        v, hint = classify_url(url)
        return v, hint

    # ── YouTube: страницы НЕ-видео отклоняются ──
    def test_youtube_non_video(self):
        studio = ("https://studio.youtube.com/channel/UCH6Irgx2JZFo6mP1GjygSJg/videos/"
                  "short?theme=light&filter=%5B%5D")
        self.assertEqual(self.verdict(studio), (NOT_VIDEO, YOUTUBE_PAGE))
        self.assertEqual(self.verdict("https://www.youtube.com/channel/UCabc1234567"), (NOT_VIDEO, YOUTUBE_PAGE))
        self.assertEqual(self.verdict("https://youtube.com/@somechannel"), (NOT_VIDEO, YOUTUBE_PAGE))
        self.assertEqual(self.verdict("https://www.youtube.com/feed/subscriptions"), (NOT_VIDEO, YOUTUBE_PAGE))
        self.assertEqual(self.verdict("https://www.youtube.com/results?search_query=test"), (NOT_VIDEO, YOUTUBE_PAGE))
        self.assertEqual(self.verdict("https://www.youtube.com/"), (NOT_VIDEO, YOUTUBE_PAGE))
        self.assertEqual(self.verdict("https://www.youtube.com/watch"), (NOT_VIDEO, YOUTUBE_PAGE))
        self.assertEqual(self.verdict("https://www.youtube.com/watch?app=desktop"), (NOT_VIDEO, YOUTUBE_PAGE))
        self.assertEqual(self.verdict("https://www.youtube.com/playlist?list=PL1234567890"), (NOT_VIDEO, PLAYLIST))
        self.assertEqual(self.verdict("https://www.youtube.com/embed/videoseries?list=PLx"), (NOT_VIDEO, PLAYLIST))
        self.assertEqual(self.verdict("https://music.youtube.com/channel/UCxx"), (NOT_VIDEO, YOUTUBE_PAGE))

    # ── YouTube: страницы видео проходят ──
    def test_youtube_video(self):
        vid = "dQw4w9WgXcQ"
        self.assertEqual(self.verdict(f"https://www.youtube.com/watch?v={vid}"), (VIDEO, None))
        self.assertEqual(self.verdict(f"https://youtube.com/watch?v={vid}&t=30s"), (VIDEO, None))
        self.assertEqual(self.verdict(f"https://m.youtube.com/watch?v={vid}"), (VIDEO, None))
        self.assertEqual(self.verdict(f"https://music.youtube.com/watch?v={vid}"), (VIDEO, None))
        self.assertEqual(self.verdict(f"https://www.youtube-nocookie.com/embed/{vid}"), (VIDEO, None))
        self.assertEqual(self.verdict(f"https://youtu.be/{vid}"), (VIDEO, None))
        self.assertEqual(self.verdict(f"https://www.youtube.com/shorts/{vid}"), (VIDEO, None))
        self.assertEqual(self.verdict(f"https://www.youtube.com/live/{vid}"), (VIDEO, None))

    # ── VK ──
    def test_vk(self):
        self.assertEqual(self.verdict("https://vk.com/video-12345_67890"), (VIDEO, None))
        self.assertEqual(self.verdict("https://vkvideo.ru/video-1_2"), (VIDEO, None))
        self.assertEqual(self.verdict("https://vk.com/clip-1_2"), (VIDEO, None))
        self.assertEqual(self.verdict("https://vk.com/video_ext.php?oid=1&id=2"), (VIDEO, None))
        self.assertEqual(self.verdict("https://vk.com/video"), (NOT_VIDEO, SECTION))
        self.assertEqual(self.verdict("https://vk.com/id123456"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://vk.com/durov"), (NOT_VIDEO, PROFILE))

    # ── Rutube / Дзен ──
    def test_rutube_dzen(self):
        h32 = "a" * 32
        self.assertEqual(self.verdict(f"https://rutube.ru/video/{h32}/"), (VIDEO, None))
        self.assertEqual(self.verdict("https://rutube.ru/play/embed/abc123def"), (VIDEO, None))
        self.assertEqual(self.verdict("https://rutube.ru/channel/12345/"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://dzen.ru/video/watch/abc123"), (VIDEO, None))
        self.assertEqual(self.verdict("https://dzen.ru/shorts/abc123"), (VIDEO, None))
        self.assertEqual(self.verdict("https://dzen.ru/some_article_profile"), (NOT_VIDEO, PROFILE))

    # ── TikTok / Twitch / Vimeo / OK / Bilibili ──
    def test_platforms(self):
        self.assertEqual(self.verdict("https://www.tiktok.com/@user/video/7301234567890"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.tiktok.com/@user/photo/7301234567890"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.tiktok.com/@user"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://www.tiktok.com/discover/cats"), (NOT_VIDEO, SECTION))
        self.assertEqual(self.verdict("https://vt.tiktok.com/ZSabc123/"), (UNKNOWN, None))

        self.assertEqual(self.verdict("https://clips.twitch.tv/FunnyClipName"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.twitch.tv/videos/123456789"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.twitch.tv/streamer/clip/FunnyClipName"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.twitch.tv/streamer"), (UNKNOWN, None))

        self.assertEqual(self.verdict("https://vimeo.com/123456789"), (VIDEO, None))
        self.assertEqual(self.verdict("https://vimeo.com/video/123456789"), (VIDEO, None))
        self.assertEqual(self.verdict("https://vimeo.com/channels/staffpicks"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://vimeo.com/showcase/abc"), (NOT_VIDEO, PROFILE))

        self.assertEqual(self.verdict("https://ok.ru/video/123456789"), (VIDEO, None))
        self.assertEqual(self.verdict("https://ok.ru/live/123456789"), (VIDEO, None))
        self.assertEqual(self.verdict("https://ok.ru/"), (NOT_VIDEO, SECTION))

        self.assertEqual(self.verdict("https://www.bilibili.com/video/BV1xx411c7mD"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.bilibili.com/bangumi/play/ep123"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.bilibili.com/space/12345"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://space.bilibili.com/12345"), (UNKNOWN, None))  # как в вебе
        self.assertEqual(self.verdict("https://b23.tv/abc123"), (UNKNOWN, None))

    # ── X / Facebook / Instagram / Threads ──
    def test_social(self):
        self.assertEqual(self.verdict("https://x.com/user/status/1234567890123"), (VIDEO, None))
        self.assertEqual(self.verdict("https://twitter.com/user/status/1234567890123"), (VIDEO, None))
        self.assertEqual(self.verdict("https://x.com/elonmusk"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://x.com/home"), (NOT_VIDEO, SECTION))
        self.assertEqual(self.verdict("https://t.co/abc123"), (UNKNOWN, None))

        self.assertEqual(self.verdict("https://www.facebook.com/reel/123456789"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.facebook.com/watch/?v=123456789"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.facebook.com/user/videos/123456789"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.facebook.com/watch"), (NOT_VIDEO, SECTION))
        self.assertEqual(self.verdict("https://fb.watch/abc123"), (UNKNOWN, None))

        self.assertEqual(self.verdict("https://www.instagram.com/reel/Cabc123_-/"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.instagram.com/p/Cabc123_-/"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.instagram.com/instagram/"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://www.instagram.com/explore/tags/cats/"), (NOT_VIDEO, SECTION))

        self.assertEqual(self.verdict("https://www.threads.net/@user/post/Cabc123"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.threads.net/@user"), (NOT_VIDEO, PROFILE))

    # ── SoundCloud / Loom / Rumble / Odysee / BitChute / Streamable ──
    def test_audio_video_sites(self):
        self.assertEqual(self.verdict("https://soundcloud.com/artist/track-name"), (VIDEO, None))
        self.assertEqual(self.verdict("https://soundcloud.com/discover"), (NOT_VIDEO, SECTION))
        self.assertEqual(self.verdict("https://soundcloud.com/artist"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://on.soundcloud.com/abc123"), (UNKNOWN, None))

        self.assertEqual(self.verdict("https://www.loom.com/share/abc123def456"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.loom.com/embed/abc123def456"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.loom.com/"), (UNKNOWN, None))

        self.assertEqual(self.verdict("https://rumble.com/vabc123-some-video.html"), (VIDEO, None))
        self.assertEqual(self.verdict("https://rumble.com/embed/abc123"), (VIDEO, None))
        self.assertEqual(self.verdict("https://rumble.com/browse/live/"), (NOT_VIDEO, SECTION))

        self.assertEqual(self.verdict("https://odysee.com/@channel:5/video-title:6"), (VIDEO, None))
        self.assertEqual(self.verdict("https://odysee.com/@channel:5"), (UNKNOWN, None))

        self.assertEqual(self.verdict("https://www.bitchute.com/video/abc123/"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.bitchute.com/channel/abc/"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://streamable.com/abc123"), (VIDEO, None))

    # ── Reddit / Dailymotion ──
    def test_reddit_dailymotion(self):
        self.assertEqual(self.verdict("https://www.reddit.com/r/videos/comments/abc123/title/"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.reddit.com/r/videos/"), (NOT_VIDEO, PROFILE))
        self.assertEqual(self.verdict("https://redd.it/abc123"), (UNKNOWN, None))

        self.assertEqual(self.verdict("https://www.dailymotion.com/video/x8abcde"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.dailymotion.com/embed/video/x8abcde"), (VIDEO, None))
        self.assertEqual(self.verdict("https://www.dailymotion.com/search/cats/"), (NOT_VIDEO, SECTION))
        self.assertEqual(self.verdict("https://dai.ly/x8abcde"), (VIDEO, None))
        self.assertEqual(self.verdict("https://dai.ly/"), (NOT_VIDEO, SECTION))

    # ── Сокращённые и чужие домены — пропускаются (unknown) ──
    def test_unknown_passes(self):
        for url in (
            "https://some-random-site.org/video/123",
            "https://example.com",
            "https://rutube.ru/weird/abc",
            "https://www.youtube.com/oops/xyz",
        ):
            v, _ = self.verdict(url)
            self.assertIn(v, (VIDEO, UNKNOWN), url)

    # ── Экстракция ссылок из текста ──
    def test_extract_urls(self):
        text = ("Смотрите https://youtu.be/dQw4w9WgXcQ и вот https://rutube.ru/video/"
                + "a" * 32
                + "/ ещё в скобках (https://vimeo.com/123456789), а это не ссылка.")
        urls = extract_urls_from_text(text)
        self.assertEqual(len(urls), 3)
        self.assertEqual(urls[0], "https://youtu.be/dQw4w9WgXcQ")
        self.assertEqual(urls[2], "https://vimeo.com/123456789")  # закрывающая скобка срезана
        self.assertEqual(extract_urls_from_text("нет ссылок тут"), [])
        self.assertEqual(extract_urls_from_text(""), [])

    # ── Фильтрация списка ──
    def test_filter_video_urls(self):
        good = "https://youtu.be/dQw4w9WgXcQ"
        bad_channel = "https://studio.youtube.com/channel/UCH6Irgx2JZFo6mP1GjygSJg/videos"
        bad_profile = "https://www.tiktok.com/@user"
        unknown = "https://some-site.org/clip"
        accepted, rejected = filter_video_urls(
            [good, bad_channel, bad_profile, unknown, good]
        )
        self.assertEqual(accepted, [good, unknown])
        self.assertEqual(len(rejected), 2)
        self.assertIn("канала или студии", rejected[0])
        self.assertIn("профиля или канала", rejected[1])

    def test_not_video_message_text(self):
        msg = not_video_message("https://youtu.be/playlist?list=x", PLAYLIST)
        self.assertIn("плейлист", msg)
        msg2 = not_video_message("https://" + "very-long-" * 20 + "url.com/x", SECTION)
        self.assertLess(len(msg2), 200)  # URL обрезан до 60 символов

    def test_tidy_url(self):
        self.assertEqual(tidy_url("https://x.com/a,"), "https://x.com/a")
        self.assertEqual(tidy_url("https://x.com/a)"), "https://x.com/a")
        self.assertEqual(tidy_url("https://x.com/(wiki)"), "https://x.com/(wiki)")  # парная — не режем
        self.assertEqual(tidy_url("https://x.com/a?x=1&amp;y=2"), "https://x.com/a?x=1&y=2")

    def test_garbage_is_unknown(self):
        self.assertEqual(classify_url("")[0], UNKNOWN)
        self.assertEqual(classify_url("   ")[0], UNKNOWN)
        self.assertEqual(classify_url("ftp://example.com/x")[0], UNKNOWN)
        self.assertEqual(classify_url("javascript:alert(1)")[0], UNKNOWN)


if __name__ == "__main__":
    unittest.main()
