import type { NextConfig } from "next";

/**
 * Next.js конфиг для Transcrypt.
 * Сайт живёт в корне: репозиторий называется voxpaperai.github.io,
 * GitHub Pages отдаёт его с https://voxpaperai.github.io/ — basePath не нужен.
 *
 * Если репозиторий когда-нибудь снова станет «проектным» (адрес вида
 * имя.github.io/репозиторий), basePath подставится автоматически из имени репо.
 *
 * Для локальной разработки: bun run dev → http://localhost:3000 (basePath пустой).
 */

const isGH = process.env.GITHUB_ACTIONS === "true";
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "voxpaperai.github.io";

// Корневой сайт (репозиторий вида <владелец>.github.io) живёт в корне домена.
// basePath нужен только «проектным» сайтам вида имя.github.io/репозиторий.
const basePath = isGH && !repoName.endsWith(".github.io") ? `/${repoName}` : "";

const nextConfig: NextConfig = {
  // Статичный экспорт — всегда (нам не нужен Node-сервер)
  output: "export",
  // "" на voxpaperai.github.io (сайт в корне) и локально; "/имя-репо" для проектных сайтов
  basePath,
  // Инлайним basePath в клиентский бандл: его использует self-hosted
  // ffmpeg.js (src/lib/ffmpeg.ts → /ffmpeg/ffmpeg.js)
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // GitHub Pages не поддерживает server-side image optimization
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Трейлинг-слэш важен для статичного хостинга
  trailingSlash: true,
};

export default nextConfig;
