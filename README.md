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
    • Выбор из трёх путей: браузер / браузер + локальный движок /
      программа на компьютер (со сравнением и честными ограничениями)
    • Согласие с политикой и отказом от ответственности (путь с движком/программой)
    • Уровень Whisper выбирается позже — на вкладке Транскрипция или в Настройках
        ↓
[4] Рабочая страница: 6 вкладок
    • Транскрипция: Subtitles-First стратегия для URL через движок;
      очередь файлов+ссылок (любой текстовый файл читается, ссылки извлекаются)
    • Медиа: скачивание видео/аудио по ссылкам (через движок)
    • Конвертер: медиа (ffmpeg.wasm или движок), изображения (Canvas), документы
    • Перевод: текст и файлы TXT/DOCX/PDF (включая LAYOUT), перевод результата
      транскрипции — переключатель «Перевод/Оригинал» в карточке результата
    • Настройки, О программе
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

### Медиа: скачивание видео/аудио

1. **Скачать видео** — yt-dlp с `format: bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]`
2. **Скачать аудио** — yt-dlp с postprocessor FFmpegExtractAudio → MP3 192k

Ссылки проверяются ещё при добавлении в очередь: страницы каналов/студии/плейлистов
YouTube и профили платформ отклоняются с объяснением — в обработку попадают только
ссылки на конкретные ролики. Очистка аудио (`clean_audio`) и вшивание субтитров
(`hardsub`) остались в API движка и в настольной программе (PyQt) — в веб-интерфейсе
они не используются.

### Конвертер

- **Медиа** — через локальный ffmpeg (если движок online) или через ffmpeg.wasm в браузере
- **Изображения** — Canvas API (PNG/JPEG/WebP)
- **Текст** — File API (.txt, .md, .csv, .json)

---

## 🖥 Локальный движок (1-клик установщик)

Для URL-задач (YouTube/TikTok/Instagram) нужен локальный Python-движок. Устанавливается автоматически во время онбординга:

### Способ 1 — Автоматически (рекомендуется)

На шаге «Установить движок» в онбординге:
1. Сайт определяет вашу платформу (macOS/Windows/Linux)
2. Кнопка «Скачать установщик для {платформа}» скачивает скрипт (~5 КБ)
3. Запустите скачанный файл двойным кликом (macOS/Windows) или `bash install-linux.sh`
4. Скрипт:
   - Создаст venv в `~/.transcrypt-engine/`
   - Скачает `engine_server.py` и `requirements-engine.txt` из GitHub
   - Установит Whisper + yt-dlp (~5 минут при первом запуске, ~800 МБ)
   - Запустит движок на `http://127.0.0.1:8765`
   - Откроет браузер с сайтом
5. Сайт автоматически опрашивает `127.0.0.1:8765` каждые 2 секунды
6. Когда движок поднимется — индикатор в шапке станет зелёным, и кнопка «Продолжить» активируется

### Способ 2 — Вручную

```bash
git clone https://github.com/maksjermy123/Transcrypt
cd Transcrypt
python -m venv .venv
source .venv/bin/activate  # на Windows: .venv\Scripts\activate
pip install -r engine-install/requirements-engine.txt
python engine_server.py
```

### Способ 3 — Только браузерный режим

Локальный движок **необязателен**. Если хотите работать только с локальными файлами — нажмите «Пропустить» в онбординге. Браузерный Whisper через transformers.js будет распознавать локальные аудио/видео без установки Python.

### Установка файлов

| Файл | Описание |
|------|----------|
| `engine-install/install-mac.command` | Установщик для macOS (двойной клик в Finder) |
| `engine-install/install-win.bat` | Установщик для Windows (двойной клик в проводнике) |
| `engine-install/install-linux.sh` | Установщик для Linux (`bash install-linux.sh`) |
| `engine-install/requirements-engine.txt` | Минимальный набор зависимостей (без PyQt6) |

### Проверка работоспособности

```bash
curl http://127.0.0.1:8765/api/health
# Должен вернуть:
# {"status":"ok","version":"1.0.0","platform":"darwin","device":"cpu","ffmpeg":true,...}
```

### Управление движком

| Команда | Действие |
|---------|----------|
| `tail -f ~/.transcrypt-engine/engine.log` | Смотреть логи |
| `kill $(cat ~/.transcrypt-engine/engine.pid)` | Остановить движок |
| `~/.transcrypt-engine/venv/bin/python ~/.transcrypt-engine/engine_server.py` | Запустить вручную |
| `rm -rf ~/.transcrypt-engine` | Полное удаление |

### Эндпоинты API

| Method | Endpoint | Описание |
|--------|----------|----------|
| GET | `/api/health` | Статус: версия, устройство, ffmpeg, модели |
| GET | `/api/progress` | Прогресс активной задачи (полинг) |
| GET | `/api/download?file=PATH` | Скачать готовый файл |
| POST | `/api/transcribe` | Транскрипция (URL или file_path) — Subtitles-First |
| POST | `/api/media` | Скачать видео/аудио, очистить аудио, hardsub (веб-интерфейс использует только скачивание) |
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
