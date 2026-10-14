import type { NextConfig } from "next";

/**
 * Next.js конфиг для Transcrypt.
 * Деплой идёт на GitHub Pages по адресу https://maksjermy123.github.io/Transcrypt/
 * поэтому basePath жёстко = "/Transcrypt".
 *
 * Для локальной разработки: bun run dev → http://localhost:3000 (basePath пустой).
 */

const isGH = process.env.GITHUB_ACTIONS === "true";
const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "Transcrypt";

const nextConfig: NextConfig = {
  // Статичный экспорт — всегда (нам не нужен Node-сервер)
  output: "export",
  // Для GitHub Pages — базовый путь = имя репозитория
  basePath: isGH ? `/${repoName}` : "",
  // Инлайним basePath в клиентский бандл: его использует self-hosted
  // ffmpeg.js (src/lib/ffmpeg.ts → /ffmpeg/ffmpeg.js)
  env: {
    NEXT_PUBLIC_BASE_PATH: isGH ? `/${repoName}` : "",
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
