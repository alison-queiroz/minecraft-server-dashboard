import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';

type ThemeMode = 'light' | 'dark';

/**
 * Also hard-coded in the pre-paint `#theme-init` script in src/index.html;
 * theme.service.spec.ts keeps the two in sync.
 */
export const THEME_STORAGE_KEY = 'minecraft-dashboard-theme';

/** Browser/PWA chrome colour per theme: the stone-100 / zinc-950 page backgrounds. */
export const THEME_COLORS: Readonly<Record<ThemeMode, string>> = {
  light: '#f5f5f4',
  dark: '#09090b',
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<ThemeMode>(this.readInitialTheme());
  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    effect(() => {
      const theme = this.theme();
      const root = this.document.documentElement;

      root.classList.toggle('dark', theme === 'dark');
      root.style.colorScheme = theme;
      this.document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
        meta.content = THEME_COLORS[theme];
      });
      this.writeTheme(theme);
    });
  }

  toggleTheme(): void {
    this.theme.update((value) => value === 'dark' ? 'light' : 'dark');
  }

  setTheme(theme: ThemeMode): void {
    this.theme.set(theme);
  }

  private readInitialTheme(): ThemeMode {
    try {
      const savedTheme = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
      if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
      }
    } catch {
      // Ignore unavailable storage and fall back to system preference.
    }

    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private writeTheme(theme: ThemeMode): void {
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore unavailable storage in test environments.
    }
  }
}
