/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#000000",
        foreground: "#ffffff",
        primary: "#3b82f6",
        muted: "#18181b",
        "muted-foreground": "#a1a1aa",
        border: "#27272a",
        accent: "#ef4444",
        success: "#10b981",
      },
    },
  },
  plugins: [],
};
