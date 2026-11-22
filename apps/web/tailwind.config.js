/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
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
          DEFAULT: 'var(--surface)',
          panel: 'var(--surface-panel)',
          border: 'var(--surface-border)',
          muted: 'var(--surface-muted)',
          ink: 'var(--surface-ink)',
          accent: 'var(--surface-accent)',
          'accent-soft': 'var(--surface-accent-soft)',
          danger: 'var(--surface-danger)',
          warn: 'var(--surface-warn)',
          ok: 'var(--surface-ok)',
          field: 'var(--surface-field)',
          hover: 'var(--surface-hover)',
          on: 'var(--on-fill)',
        },
      },
    },
  },
  plugins: [],
};
