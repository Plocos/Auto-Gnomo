import { useState } from 'react';

const KEY = 'theme';

export type Theme = 'light' | 'dark';

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* sin almacenamiento, se usa el sistema */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export function useTheme(): { theme: Theme; dark: boolean; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* la clase sigue aplicada en esta sesión */
    }
    applyTheme(next);
    setTheme(next);
  };

  return { theme, dark: theme === 'dark', toggle };
}
