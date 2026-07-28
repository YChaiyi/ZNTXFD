import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "#0A0A0C",
          card: "#121217",
          hover: "#191920",
        },
        foreground: {
          DEFAULT: "#F1F1F4",
          muted: "#8B8B95",
          disabled: "#5C5C64",
        },
        accent: {
          DEFAULT: "#FF6A00",
          light: "#FFA53D",
        },
        success: "#02C076",
        purple: "#8364FF",
        pink: "#FF6482",
        danger: "#F6465D",
        border: "#2A2A31",
      },
      backdropBlur: {
        glass: "16px",
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        glow: "glow 4s ease-in-out infinite",
        gradientShift: "gradientShift 8s ease infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        glow: {
          "0%, 100%": { opacity: "0.55", transform: "scale(1)" },
          "50%": { opacity: "0.9", transform: "scale(1.04)" },
        },
        gradientShift: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
