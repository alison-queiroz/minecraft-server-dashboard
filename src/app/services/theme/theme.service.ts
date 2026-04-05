import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, signal } from '@angular/core';

type ThemeMode = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly storageKey = 'minecraft-dashboard-theme';

  readonly theme = signal<ThemeMode>(this.readInitialTheme());
  readonly isDark = computed(() => this.theme() === 'dark');

  constructor() {
    effect(() => {
      const theme = this.theme();
      const root = this.document.documentElement;

      root.classList.toggle('dark', theme === 'dark');
      root.style.colorScheme = theme;
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
      const savedTheme = globalThis.localStorage?.getItem(this.storageKey);
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
      globalThis.localStorage?.setItem(this.storageKey, theme);
    } catch {
      // Ignore unavailable storage in test environments.
    }
  }
}
