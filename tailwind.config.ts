import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    "bg-red-500/20",
    "text-red-400",
    "border-red-500/30",
    "bg-yellow-400/20",
    "text-yellow-300",
    "border-yellow-400/30",
    "bg-green-400/20",
    "text-green-400",
    "border-green-400/30",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
};
export default config;
