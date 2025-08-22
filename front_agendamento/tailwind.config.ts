// tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {   
        brand: "#DE7E30",      // (opcional) alias: bg-brand-600, text-brand-600 etc.
      },
    },
  },
  plugins: [],
};

export default config;
