import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Transcrypt — локальная транскрипция и медиа-обработка в браузере",
  description:
    "Whisper работает прямо в браузере, используя ресурсы вашего компьютера. Транскрипция, скачивание видео/аудио, очистка звука, вшивание субтитров. Без установки, без серверов, без скачивания архивов. Бесплатно.",
  keywords: [
    "Transcrypt",
    "Whisper",
    "транскрипция",
    "субтитры",
    "hardsub",
    "ffmpeg.wasm",
    "WebGPU",
    "WASM",
    "бесплатно",
    "приватность",
  ],
  authors: [{ name: "VoxPaperAi" }],
  icons: {
    icon: "/logo.svg",
  },
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
        {children}
        <Toaster />
      </body>
    </html>
  );
}
