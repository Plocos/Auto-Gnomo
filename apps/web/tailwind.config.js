/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans', 'Segoe UI', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        table: ['12.5px', { lineHeight: '1.35' }],
        ui: ['13px', { lineHeight: '1.4' }],
      },
      colors: {
        surface: {
          DEFAULT: '#f3f1ec',
          panel: '#faf9f6',
          border: '#d4d0c8',
          muted: '#6b6560',
          ink: '#1c1917',
          accent: '#0f5c4c',
          danger: '#9b1c1c',
          warn: '#9a6700',
          ok: '#1a7f37',
        },
      },
    },
  },
  plugins: [],
};
