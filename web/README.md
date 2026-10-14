# Transcrypt — Инструкция по деплою на GitHub Pages

## Что это

Полностью бесплатный веб-сайт для транскрипции аудио/видео, перевода текста и
конвертации изображений. **Whisper работает прямо в браузере** через
`transformers.js` + WebAssembly, используя ресурсы компьютера пользователя.
Никаких серверов, никаких подписок, никаких скачиваний архивов.

## Архитектура

```
Пользователь открывает сайт
        ↓
[1] Если онбординг уже пройдён — сразу рабочая страница
    Иначе — интерактивный гид из 6 шагов
        ↓
[2] Гид устанавливает движок:
    • transformers.js (~5 МБ) с CDN
    • WASM-бинарник (~25 МБ) с CDN
    • Модель Whisper Tiny (40 МБ) или Base (77 МБ) с Hugging Face
        ↓
[3] Всё кешируется в Cache API браузера
    При следующем открытии — мгновенно берётся из кеша
        ↓
[4] Рабочая страница: 3 вкладки
    • Транскрипция (Whisper → SRT/VTT/TXT)
    • Конвертер (изображения PNG/JPEG/WebP, текстовые файлы)
    • Перевод (14 языков через MyMemory API)
```

## Файлы проекта

```
download/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # корневой layout, тёмная тема
│   │   ├── page.tsx                # главная: онбординг ↔ рабочая
│   │   └── globals.css             # стили (тёмный minimal #0b0f19 + фиолет #7c5bf5)
│   ├── components/
│   │   ├── onboarding/
│   │   │   ├── OnboardingWizard.tsx # степ-индикатор + AnimatePresence
│   │   │   ├── WelcomeStep.tsx      # шаг 1: что умеет
│   │   │   ├── ResourcesStep.tsx    # шаг 2: ресурсы ПК + детект железа
│   │   │   ├── EngineStep.tsx       # шаг 3: установка движка + прогресс
│   │   │   ├── ModelChoiceStep.tsx  # шаг 4: выбор Whisper Tiny/Base
│   │   │   ├── ModelDownloadStep.tsx# шаг 5: загрузка модели + прогресс
│   │   │   └── DoneStep.tsx         # шаг 6: финал + закладки
│   │   └── workbench/
│   │       ├── Workbench.tsx        # рабочая страница с табами
│   │       ├── TranscribeTab.tsx    # вкладка транскрипции
│   │       ├── ConvertTab.tsx       # вкладка конвертера
│   │       └── TranslateTab.tsx     # вкладка перевода
│   └── lib/
│       ├── onboarding-store.ts     # Zustand store с persist
│       ├── whisper.ts               # обёртка над transformers.js
│       ├── translator.ts           # MyMemory API клиент
│       └── subtitles.ts            # SRT/VTT/TXT генерация
├── next.config.ts                  # для GitHub Pages: output: "export", basePath
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json                  # shadcn/ui конфиг
├── .github/
│   └── workflows/
│       └── deploy.yml               # GitHub Actions: build → Pages
└── README.md                        # этот файл
```

## Установка локально для разработки

```bash
cd download
bun install
bun run dev
# открыть http://localhost:3000
```

## Деплой на GitHub Pages

### Вариант A — Автоматический через GitHub Actions (рекомендуется)

1. **Запушьте содержимое папки `download/` в корень вашего репозитория GitHub**
   (или в ветку `main`, или в подкаталог — workflows всё равно сработают).

2. **В настройках репозитория** откройте Settings → Pages → Source:
   выберите **GitHub Actions**.

3. **Обновите `next.config.ts`** — замените `basePath` на имя репозитория:

   ```ts
   const nextConfig: NextConfig = {
     output: "export",
     basePath: "/Transcrypt",          // ← имя репозитория
     images: { unoptimized: true },
     typescript: { ignoreBuildErrors: true },
   };
   ```

4. **Запушьте** — GitHub Actions автоматически соберёт статический сайт
   и опубликует на `https://<username>.github.io/Transcrypt/`.

### Вариант B — Ручная сборка и деплой

```bash
cd download
bun install
# Обязательно обновите basePath в next.config.ts на имя репозитория
bun run build
# В папке ./out появится готовый статический сайт

# Если используете gh-pages:
bunx gh-pages -d out -b gh-pages
# или просто скопируйте содержимое out/ в docs/ репозитория
# и в Settings → Pages → Source укажите ветку main /docs
```

## Что увидит пользователь при первом открытии

1. **Приветствие** — крупный логотип, краткое описание, кнопка «Продолжить».
2. **Ресурсы ПК** — система показывает обнаруженное железо: число ядер CPU,
   ОЗУ (если доступно), наличие WebGPU, рекомендованное число потоков для
   Whisper. Предупреждение о нагрузке.
3. **Установить движок** — одна большая кнопка. Браузер грузит
   `transformers.js` (~5 МБ) + WASM-бинарник (~25 МБ) с CDN jsdelivr. Всё
   кешируется в Cache API браузера. Никаких архивов, никакого install.
4. **Выбрать Whisper** — две карточки: Tiny (40 МБ, быстрее, для слабых ПК)
   и Base (77 МБ, точнее, рекомендуется). Пользователь кликает и идёт дальше.
5. **Загрузка модели** — прогресс-бар с текущим файлом и процентом. Модель
   берётся с Hugging Face, кешируется в IndexedDB браузера.
6. **Финал + закладки** — кнопка «Добавить в закладки» (через Ctrl/Cmd+D),
   пошаговое описание, что будет происходить при следующем открытии.

## Что происходит при повторном открытии

- Браузер открывает страницу из Service Worker-кеша (если настроен) или
  из HTTP-кеша.
- Zustand читает `localStorage` → понимает, что онбординг пройден, движок
  готов, модель скачана.
- Сразу показывается рабочая страница.
- При попытке что-то сделать (например, транскрибировать файл) — движок
  инициализируется из Cache API за секунды, модель берётся из IndexedDB
  мгновенно.
- **Ни одной повторной загрузки из интернета**.

## Ограничения (важно)

1. **YouTube-видео нельзя скачать прямо из браузера** — CORS-политика
   YouTube запрещает это. Пользователь должен скачать видео вручную или
   через сторонний сервис, а затем загрузить файл в Transcrypt.
2. **MyMemory API** для перевода имеет лимит 50000 слов/день — это
   достаточно для личного использования.
3. **WebGPU** доступен в Chrome 113+, Edge 113+, частично в Safari 17. В
   Firefox и старых браузерах Whisper работает на WASM/CPU — медленнее,
   но работает.
4. **Размер кеша**: ~80 МБ (движок + модель Base). При использовании
   Service Worker можно хранить в кеше почти всё, чтобы работало офлайн.

## Как обновить

- Чтобы добавить новую модель Whisper — измените `WhisperModelId` в
  `src/lib/onboarding-store.ts` и список в `ModelChoiceStep.tsx`.
- Чтобы подключить ffmpeg.wasm для конвертации аудио — установите
  `@ffmpeg/ffmpeg` и `@ffmpeg/util` через NPM и замените `ImageConverter` в
  `ConvertTab.tsx`.
- Чтобы добавить провайдера перевода (DeepL, LibreTranslate) — добавьте
  функции в `src/lib/translator.ts`.

## Темы и стили

Тема — тёмный minimal в стиле существующего сайта Transcrypt:
- Фон: `#0b0f19`
- Карточки: `#151b28` (полупрозрачный + backdrop-blur)
- Бордеры: `#263147`
- Акцент: `#7c5bf5` (фиолетовый)
- Glow-эффект: `rgba(124, 91, 245, 0.25)`

Все CSS-переменные лежат в `src/app/globals.css`.

## Ссылки

- `transformers.js` docs: https://huggingface.co/docs/transformers.js
- Whisper модели: https://huggingface.co/Xenova
- MyMemory API: https://mymemory.translated.net/
- GitHub Pages docs: https://docs.github.com/en/pages
