/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        void:    "#05070F",
        panel:   "rgba(10,15,30,0.4)",
        forest:  "#064E3B",
        emerald: "#10B981",
        mint:    "#34D399",
        "mint-light": "#A7F3D0",
        muted:   "#6B7280",
      },
      fontFamily: {
        grotesk:  ["Space Grotesk", "monospace"],
        jakarta:  ["Plus Jakarta Sans", "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4,0,0.6,1) infinite",
        "spin-slow":  "spin 12s linear infinite",
      },
      backdropBlur: {
        xl: "20px",
      },
    },
  },
  plugins: [],
};
