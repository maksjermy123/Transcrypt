# Transcrypt (VoxPaperAi Pro)

Универсальный инструмент для **транскрибации, скачивания и обработки медиа** — в гибридной архитектуре:

| | Браузерный движок (transformers.js + WASM) | Локальный Python-движок (engine_server.py) |
|---|---|---|
| Где работает | Прямо в браузере, через WASM/WebGPU | Локально на компьютере (Python 3) |
| URL-задачи (YouTube) | ❌ Блокируется CORS+bot-защитой YouTube | ✅ yt-dlp с impersonate Chrome |
| Локальные файлы | ✅ Whisper через transformers.js | ✅ Нативный Whisper (Python) |
| Установка | Не нужна — открыть сайт | `pip install -r requirements.txt` + `python engine_server.py` |
| Скорость | Средняя (WASM) | Высокая (нативный Whisper) |
| Десктоп-приложение | ❌ | ✅ PyQt6 GUI в `src/` |

Сайт автоматически определяет, запущен ли локальный движок (пингует `127.0.0.1:8765`), и использует его если есть — иначе fallback на браузерный Whisper.

---

## 🌐 Веб-версия

**Адрес после деплоя:** `https://maksjermy123.github.io/Transcrypt/`

**Архитектура:**

```
Пользователь открывает https://maksjermy123.github.io/Transcrypt/
        ↓
[1] Авто-пинг http://127.0.0.1:8765/api/health (1.5 сек)
        ↓
[2] Если движок online — индикатор зелёный, URL-задачи доступны
    Если движок offline — индикатель жёлтый, URL-задачи недоступны,
    но локальные файлы работают через браузерный Whisper
        ↓
[3] Онбординг (только при первом открытии):
    • Приветствие → Ресурсы ПК → Установить Whisper (браузерный)
    • Выбор модели (Tiny/Base) → Загрузка → Готово + закладки
        ↓
[4] Рабочая страница: 3 вкладки
    • Транскрипция: Subtitles-First стратегия для URL через движок
    • Медиа: скачать видео/аудио, очистить аудио, hardsub (через движок)
    • Конвертер: медиа (ffmpeg.wasm или движок), изображения (Canvas), текст
```

### Транскрипция: стратегия Subtitles-First

Для URL-задач (через локальный движок) реализована стратегия из оригинального `engine_server.py`:

1. **Поиск субтитров** на выбранном языке (или fallback `ru → en → uk`)
2. Если есть ручные субтитры — берём их (быстро, без Whisper)
3. Если есть только авто-субтитры — берём их
4. Если субтитров нет — скачиваем аудиодорожку через yt-dlp
5. Распознавание через нативный Whisper с настройкой CPU-потоков
6. Экспорт в SRT, VTT, TXT, JSON

Это в 10-100 раз быстрее, чем распознавать всё через Whisper, если у видео уже есть субтитры.

### Медиа: 4 операции

1. **Скачать видео** — yt-dlp с `format: bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]`
2. **Скачать аудио** — yt-dlp с postprocessor FFmpegExtractAudio → MP3 192k
3. **Очистить аудио** — ffmpeg с фильтрами `afftdn` (шумоподавление), `highpass=80`, `lowpass=12000`, `loudnorm` (EBU R128)
4. **Вшить субтитры (hardsub)** — если URL YouTube: скачать субтитры на выбранном языке → fallback на Whisper-генерацию → ffmpeg с фильтром `subtitles`

### Конвертер

- **Медиа** — через локальный ffmpeg (если движок online) или через ffmpeg.wasm в браузере
- **Изображения** — Canvas API (PNG/JPEG/WebP)
- **Текст** — File API (.txt, .md, .csv, .json)

---

## 🖥 Локальный движок (опционально, для URL-задач)

Если хотите работать с YouTube/TikTok/Instagram URL, запустите локальный Python-движок:

### Установка

```bash
git clone https://github.com/maksjermy123/Transcrypt
cd Transcrypt

# Python 3.10+
python -m venv .venv
source .venv/bin/activate  # на Windows: .venv\Scripts\activate

pip install -r requirements.txt
```

`requirements.txt` включает:
- `yt-dlp` — скачивание с YouTube/TikTok/Instagram
- `openai-whisper` — распознавание речи
- `torch` — для Whisper
- `ffmpeg-python` — для медиа-операций (также нужен системный ffmpeg)
- `curl-cffi` — TLS-impersonation (обход блокировок YouTube)

Дополнительно для macOS: `brew install deno` (для JS-челленджей YouTube)

### Запуск

```bash
python engine_server.py
# или с портом:
python engine_server.py 8765
```

Движок откроется на `http://127.0.0.1:8765`. Сервер печатает:
```
🚀 VoxPaperAi Pro — Локальный движок запущен!
📡 Порт: http://127.0.0.1:8765
🌐 Откройте веб-интерфейс: https://maksjermy123.github.io/Transcrypt/
```

### Проверка работоспособности

```bash
curl http://127.0.0.1:8765/api/health
# Должен вернуть:
# {"status":"ok","version":"1.0.0","platform":"darwin","device":"cpu","ffmpeg":true,...}
```

После запуска движка — обновите страницу `https://maksjermy123.github.io/Transcrypt/` — индикатор в шапке станет зелёным, и все URL-задачи заработают.

### Эндпоинты API

| Method | Endpoint | Описание |
|--------|----------|----------|
| GET | `/api/health` | Статус: версия, устройство, ffmpeg, модели |
| GET | `/api/progress` | Прогресс активной задачи (полинг) |
| GET | `/api/download?file=PATH` | Скачать готовый файл |
| POST | `/api/transcribe` | Транскрипция (URL или file_path) — Subtitles-First |
| POST | `/api/media` | Скачать видео/аудио, очистить аудио, hardsub |
| POST | `/api/convert` | Конвертация медиа/документов/изображений |
| POST | `/api/upload` | Загрузка файла с веб-страницы на движок (multipart) |
| POST | `/api/stop` | Отмена активной задачи |

CORS: `Access-Control-Allow-Origin: *` — позволяет веб-странице на GitHub Pages обращаться к вашему локальному движку.

---

## 🖥 Десктоп-версия (PyQt6)

Полноценное настольное приложение на PyQt6 в `src/`. Запуск на macOS (dev):

```bash
./run_dev.command            # запустить приложение
./run_dev.command --tests    # прогнать тесты
```

Release-сборка macOS:
```bash
./.venv/bin/python -m pip install -r requirements-build.txt
./tools/build_release.sh
```

---

## 🚀 Деплой веб-версии на GitHub Pages

Деплой автоматизирован через GitHub Actions (`.github/workflows/deploy-web.yml`).

1. Repo → Settings → Pages → Source: **GitHub Actions**
2. Любой пуш в `main`, изменяющий `web/`, триггерит пересборку
3. Через ~2 минуты сайт доступен на `https://maksjermy123.github.io/Transcrypt/`

Веб-версия находится в папке [`web/`](./web/) — Next.js 16 + TypeScript + Tailwind CSS 4 + shadcn/ui.

---

## Структура репозитория

```
Transcrypt/
├── web/                          # Веб-версия (Next.js, деплоится на GitHub Pages)
│   ├── src/
│   │   ├── app/                   # layout + главная страница
│   │   ├── components/
│   │   │   ├── onboarding/        # 6-шаговый интерактивный гид
│   │   │   └── workbench/        # Рабочая страница: Транскрипция, Медиа, Конвертер
│   │   └── lib/
│   │       ├── whisper.ts          # transformers.js — Whisper в браузере
│   │       ├── engine-bridge.ts   # Мост к локальному engine_server.py
│   │       ├── ffmpeg.ts           # ffmpeg.wasm для браузера
│   │       ├── onboarding-store.ts # Zustand store
│   │       └── subtitles.ts       # SRT/VTT генерация
│   ├── .github/workflows/deploy-web.yml  # CI для GitHub Pages
│   └── README.md
│
├── src/                          # Python-код десктоп-версии (PyQt6)
│   ├── core/
│   │   ├── downloader.py          # yt-dlp с impersonate Chrome
│   │   ├── engine.py              # WhisperEngine (нативный Whisper)
│   │   ├── converter.py           # ffmpeg-конвертация
│   │   ├── subtitles.py           # Парсинг SRT/VTT
│   │   └── ...
│   ├── ui/                        # PyQt6 интерфейс (вкладки, виджеты)
│   └── utils/                     # runtime, конфиг, диагностика
│
├── engine_server.py              # HTTP-сервер: мост между web UI и Python
├── docs/site/index.html          # Старый веб-интерфейс (для исторической справки)
├── tests/                        # unittest-наборы
└── README.md                     # этот файл
```

---

## Лицензия

См. [LICENSE](./LICENSE).
