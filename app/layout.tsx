import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: {
    default: "TokenBurn — AI cost intelligence",
    template: "%s · TokenBurn",
  },
  description:
    "TokenBurn is the cost governance layer for production AI. Ingest normalized LLM usage, attribute spend to features, detect anomalies and optimize with evidence.",
};

export const viewport: Viewport = {
  themeColor: "#080808",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body
        className="min-h-screen bg-obsidian font-sans text-ink antialiased"
        style={{ "--font-jetbrains": "'JetBrains Mono', monospace" } as CSSProperties}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
