/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"]
      },
      colors: {
        ink: {
          950: "#09090b",
          900: "#101012",
          850: "#161618",
          800: "#1c1c1f",
          700: "#27272a",
          600: "#3f3f46",
          500: "#52525b",
          400: "#71717a",
          300: "#a1a1aa",
          200: "#d4d4d8",
          100: "#e4e4e7",
          50: "#f4f4f5"
        }
      },
      keyframes: {
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" }
        },
        fadeIn: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        }
      },
      animation: {
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        "fade-in": "fadeIn 200ms ease-out"
      }
    }
  },
  plugins: []
};
