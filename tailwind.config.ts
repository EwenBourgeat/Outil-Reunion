import type { Config } from "tailwindcss";

// Palette « bleu de plan » (cyanotype / blueprint) — cf. app locale d'origine.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F4F7FB",
        surface: "#FFFFFF",
        ink: "#0E243D",
        muted: "#566B80",
        faint: "#93A6B8",
        line: "#DBE6F1",
        "line-2": "#C6D5E6",
        accent: "#1B5CAB",
        "accent-ink": "#154A8C",
        "accent-soft": "#E6EFFB",
        urgent: "#C0342B",
        court: "#A96A12",
        moyen: "#45586B",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
