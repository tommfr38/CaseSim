/** @type {import('tailwindcss').Config} */
export default {
  content: ["./public/index.html", "./public/app.js"],
  theme: {
    extend: {
      colors: {
        // CS2 rarity colours
        rarity: {
          milspec: "#4b69ff",
          restricted: "#8847ff",
          classified: "#d32ce6",
          covert: "#eb4b4b",
          gold: "#f4c20d",
        },
        ink: {
          900: "#0a0e16",
          800: "#0f1420",
          700: "#141b2b",
          600: "#1b2437",
          500: "#243049",
        },
      },
      fontFamily: {
        display: ['"Rajdhani"', "system-ui", "sans-serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 30px -4px var(--tw-shadow-color)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.8)" },
          "60%": { opacity: "1", transform: "scale(1.05)" },
          "100%": { transform: "scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        shake: {
          "10%, 90%": { transform: "translateX(-1px)" },
          "20%, 80%": { transform: "translateX(2px)" },
          "30%, 50%, 70%": { transform: "translateX(-4px)" },
          "40%, 60%": { transform: "translateX(4px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out both",
        "pop-in": "pop-in 0.5s cubic-bezier(0.2,0.8,0.2,1) both",
        shimmer: "shimmer 2.5s infinite",
        shake: "shake 0.5s cubic-bezier(.36,.07,.19,.97) both",
      },
    },
  },
  plugins: [],
};
