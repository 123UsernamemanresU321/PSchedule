import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        "surface-2": "hsl(var(--surface-2))",
        border: "hsl(var(--border))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
        },
        subject: {
          physics: "hsl(var(--subject-physics))",
          maths: "hsl(var(--subject-maths))",
          chemistry: "hsl(var(--subject-chemistry))",
          olympiad: "hsl(var(--subject-olympiad))",
          programming: "hsl(var(--subject-programming))",
          english: "hsl(var(--subject-english))",
          french: "hsl(var(--subject-french))",
          geography: "hsl(var(--subject-geography))",
        },
      },
      borderRadius: {
        xs: "10px",
        sm: "14px",
        md: "18px",
        lg: "24px",
        xl: "32px",
      },
      boxShadow: {
        panel: "0 24px 56px rgba(2, 6, 23, 0.42)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
      },
      fontFamily: {
        sans: ["var(--font-body)"],
        display: ["var(--font-display)"],
      },
      backgroundImage: {
        "panel-glow":
          "radial-gradient(circle at top, rgba(38, 71, 255, 0.12), rgba(12, 18, 38, 0) 55%)",
      },
    },
  },
  plugins: [],
};

export default config;
