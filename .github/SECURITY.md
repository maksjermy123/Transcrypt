# Политика безопасности / Security Policy

## Поддерживаемые версии / Supported versions

| Версия / Version | Поддержка / Supported |
| --- | --- |
| [последний релиз / latest release](https://github.com/maksjermy123/Transcrypt/releases/latest) | ✅ |
| предыдущие релизы / previous releases | ❌ — обновитесь / please upgrade |

Безопасность исправляется только в актуальном релизе: программа портативная,
обновление = скачать свежую сборку со страницы релизов.
/ Security fixes land only in the latest release: the app is portable, upgrading
means downloading the fresh build from the releases page.

## Как сообщить об уязвимости / How to report a vulnerability

**Пожалуйста, НЕ заводите публичный issue с деталями уязвимости.**
/ **Please do NOT open a public issue with vulnerability details.**

Используйте приватный канал GitHub — Private Vulnerability Reporting:
/ Use GitHub's private channel — Private Vulnerability Reporting:

1. Откройте вкладку **Security** репозитория →
   **Report a vulnerability** / Open the repo's **Security** tab → **Report a vulnerability**.
2. Опишите: затронутый компонент, шаги воспроизведения, ожидаемый vs фактический результат,
   версию программы (кнопка «Копировать отчёт о среде» в Настройках — полезное приложение).
   / Describe: affected component, reproduction steps, expected vs actual behaviour,
   app version (the "Copy environment report" button in Settings is a helpful attachment).
3. Первичный ответ — в течение **5 дней**. / Initial response within **5 days**.

Если приватный репортинг недоступен — напишите на почту владельца репозитория через
профиль GitHub. / If private reporting is unavailable, contact the repo owner via
their GitHub profile email.

## Что в области охвата / In scope

- **Десктоп-приложение (PyQt6)** и **локальный движок**: локальный API-сервер
  (привязан к `127.0.0.1`, порт 8765), файловые операции, subprocess-вызовы
  (ffmpeg/soffice/deno), обработка пользовательских файлов и ссылок.
  / Desktop app (PyQt6) and the local engine: the local API server (bound to
  `127.0.0.1`, port 8765), file operations, subprocess calls (ffmpeg/soffice/deno),
  handling of user-supplied files and URLs.
- **Веб-сайт (Next.js, GitHub Pages)**: XSS через пользовательский ввод,
  некорректная санитизация, небезопасные ссылки на движок.
  / Website (Next.js, GitHub Pages): XSS through user input, sanitization bugs,
  unsafe engine-link handling.
- **CI/CD (GitHub Actions)**: инъекция через неконтролируемые входы workflow.
  / CI/CD (GitHub Actions): injection through untrusted workflow inputs.

## Вне области охвата / Out of scope

- Проблемы сторонних сервисов (YouTube, VK и т.п.), их bot-защита (PO Token),
  доступность и изменение их интерфейсов. / Issues of third-party services
  (YouTube, VK, etc.), their bot protection (PO Token), availability, API changes.
- Отсутствие подписи сборок / code signing (macOS Gatekeeper, Windows SmartScreen) —
  известное ограничение бесплатного проекта без сертификатов подписи.
  / Missing code signing (macOS Gatekeeper, Windows SmartScreen) — a known
  limitation of a free project without signing certificates.
- Отчёты от автоматических сканеров без демонстрации реального воздействия.
  / Automated scanner reports without proof of real impact.
- Социальная инженерия, фишинг, физический доступ. / Social engineering,
  phishing, physical access.

## Целостность загрузок / Download integrity

Начиная с релиза **v1.0.8** каждый артефакт релиза сопровождается файлом
`<имя>.sha256` (SHA-256 контрольная сумма). Проверяйте скачиванное перед запуском:
/ Starting with release **v1.0.8**, every release artifact ships with a
`<name>.sha256` checksum file. Verify your download before running it:

- Windows (PowerShell): `Get-FileHash <файл> -Algorithm SHA256`
- macOS / Linux: `shasum -a 256 <файл>` или `sha256sum <файл>`

Скачивайте программу только со страницы
[releases/latest](https://github.com/maksjermy123/Transcrypt/releases/latest)
или с официального сайта проекта. / Only download from the
[releases/latest](https://github.com/maksjermy123/Transcrypt/releases/latest)
page or the project's official website.

## Безопасность пользователей / User safety notes

- Локальный движок слушает только `127.0.0.1` и не принимает соединения из сети.
  / The local engine listens on `127.0.0.1` only and accepts no remote connections.
- Программа не содержит телеметрии и не отправляет пользовательские файлы
  куда-либо, кроме явных запросов пользователя (скачивание по ссылке,
  перевод выбранного текста через публичные сервисы перевода).
  / The app contains no telemetry and never uploads user files anywhere except
  explicit user actions (downloading by URL, translating selected text through
  public translation services).
- Токены доступа YouTube-проверок (PO Token) решаются локально и не покидают
  машину пользователя. / YouTube challenge solving (PO Token) happens locally
  and never leaves the user's machine.
