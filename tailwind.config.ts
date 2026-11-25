import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: "#080808",
        surface: {
          base: "#080808",
          sidebar: "#0A0A0A",
          card: "#141414",
          raised: "#1B1B1B",
          sunken: "#0D0D0D",
          hover: "#222222",
        },
        graphite: {
          DEFAULT: "#141414",
          raised: "#1B1B1B",
          sunken: "#0D0D0D",
          hover: "#222222",
        },
        hairline: {
          DEFAULT: "#303030",
          strong: "#3D3D3D",
          faint: "#242424",
        },
        chrome: {
          DEFAULT: "#D4D4D8",
          bright: "#FFFFFF",
          dim: "#A1A1AA",
          faint: "#737373",
        },
        ink: {
          DEFAULT: "#F5F5F5",
          muted: "#A1A1AA",
          faint: "#8A8A8A",
          dim: "#525252",
        },
        accent: {
          blue: "#3B82F6",
          sky: "#38BDF8",
          cyan: "#06B6D4",
          teal: "#14B8A6",
          emerald: "#10B981",
          lime: "#84CC16",
          amber: "#F59E0B",
          orange: "#F97316",
          rose: "#F43F5E",
          pink: "#EC4899",
          violet: "#8B5CF6",
          purple: "#A855F7",
          indigo: "#6366F1",
        },
        provider: {
          openai: "#F2F5F7",
          anthropic: "#D97757",
          gemini: "#5C8DFF",
          groq: "#F43E01",
          mistral: "#FF8205",
          custom: "#94A3B8",
        },
        signal: {
          good: "#34D399",
          warn: "#FBBF24",
          bad: "#FB7185",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "var(--font-geist-mono)", "monospace"],
      },
      borderRadius: {
        lg: "12px",
        xl: "14px",
        md: "9px",
        sm: "6px",
      },
      boxShadow: {
        panel: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.6), 0 18px 44px -30px rgba(0,0,0,0.95)",
        lift: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 48px -26px rgba(0,0,0,0.9)",
        pop: "0 24px 60px -12px rgba(0,0,0,0.9), 0 0 0 1px rgba(70,70,70,0.7)",
        chrome: "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -1px 0 rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.55)",
        glow: "0 0 0 1px rgba(255,255,255,0.14), 0 8px 26px -14px rgba(255,255,255,0.18)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22,1,0.36,1) both",
        shimmer: "shimmer 1.8s linear infinite",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
