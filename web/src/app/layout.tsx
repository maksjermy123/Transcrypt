import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { THEME_BOOTSTRAP_SNIPPET } from "@/lib/theme";
import { ThemeSync } from "@/components/ThemeSync";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VoxPaperAi — локальная транскрипция и медиа-обработка в браузере",
  description:
    "Whisper работает прямо в браузере, используя ресурсы вашего компьютера. Транскрипция и перевод, конвертация файлов, скачивание видео и аудио по ссылкам (через локальный движок). Без установки, без серверов. Бесплатно.",
  keywords: [
    "VoxPaperAi",
    "Transcrypt",
    "Whisper",
    "транскрипция",
    "субтитры",
    "скачивание видео",
    "ffmpeg.wasm",
    "WebGPU",
    "WASM",
    "бесплатно",
    "приватность",
  ],
  authors: [{ name: "VoxPaperAi" }],
  // Используем ОТНОСИТЕЛЬНЫЕ URL (без / в начале) — Next.js с output:"export"
  // и basePath не подставляет basePath в metadata.icons автоматически.
  // Относительные URL резолвятся от текущей страницы (с trailing slash).
  icons: {
    icon: [
      { url: "favicon.svg", type: "image/svg+xml" },
      { url: "favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "favicon-48.png", type: "image/png", sizes: "48x48" },
      { url: "favicon-96.png", type: "image/png", sizes: "96x96" },
      { url: "favicon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: ["favicon.ico"],
    apple: [
      { url: "apple-touch-icon.png", sizes: "180x180" },
    ],
  },
  manifest: "site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0b0f19",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        {/* Тема до первой отрисовки — без мигания тёмным при включённой светлой */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SNIPPET }} />
        {children}
        <ThemeSync />
        <Toaster />
      </body>
    </html>
  );
}
