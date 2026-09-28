import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { THEME_COLORS, THEME_STORAGE_KEY as STORAGE_KEY, ThemeService } from './theme.service';

function flush(): void {
  TestBed.inject(ApplicationRef).tick();
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.configureTestingModule({ providers: [ThemeService] });
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    jest.restoreAllMocks();
  });

  it('should be created', () => {
    const service = TestBed.inject(ThemeService);
    flush();
    expect(service).toBeTruthy();
  });

  it('setTheme updates the theme signal and triggers the effect', () => {
    const service = TestBed.inject(ThemeService);
    flush();

    service.setTheme('light');
    flush();
    expect(service.theme()).toBe('light');

    service.setTheme('dark');
    flush();
    expect(service.theme()).toBe('dark');
  });

  it('toggleTheme flips between dark and light', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('light');
    flush();

    service.toggleTheme();
    flush();
    expect(service.theme()).toBe('dark');

    service.toggleTheme();
    flush();
    expect(service.theme()).toBe('light');
  });

  it('isDark returns true when theme is dark', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark');
    flush();
    expect(service.isDark()).toBe(true);
  });

  it('isDark returns false when theme is light', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('light');
    flush();
    expect(service.isDark()).toBe(false);
  });

  it('reads saved light theme from localStorage on init', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    const service = TestBed.inject(ThemeService);
    flush();
    expect(service.theme()).toBe('light');
  });

  it('reads saved dark theme from localStorage on init', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    const service = TestBed.inject(ThemeService);
    flush();
    expect(service.theme()).toBe('dark');
  });

  it('falls back gracefully when localStorage.getItem throws (covers catch block)', () => {
    jest.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('localStorage not available');
    });
    const service = TestBed.inject(ThemeService);
    flush();
    expect(service).toBeTruthy();
    expect(['light', 'dark']).toContain(service.theme());
  });

  it('effect writes theme to localStorage (covers writeTheme)', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark');
    flush();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('falls back to dark when matchMedia prefers-color-scheme is dark (no localStorage)', () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({
        matches: true,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        media: '(prefers-color-scheme: dark)',
        onchange: null,
      }),
    });
      const service = TestBed.inject(ThemeService);
    flush();
    expect(service.theme()).toBe('dark');
  });

  it('falls back to light when matchMedia prefers-color-scheme is light (no localStorage)', () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      writable: true,
      value: () => ({
        matches: false,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        media: '(prefers-color-scheme: dark)',
        onchange: null,
      }),
    });
      const service = TestBed.inject(ThemeService);
    flush();
    expect(service.theme()).toBe('light');
  });

  it('writeTheme silently ignores localStorage.setItem errors (covers writeTheme catch)', () => {
    const service = TestBed.inject(ThemeService);
    jest.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => {
      service.setTheme('light');
      flush();
    }).not.toThrow();
  });
});

interface AppliedTheme {
  dark: boolean;
  colorScheme: string;
  themeColors: string[];
}

function stubPrefersDark(matches: boolean): void {
  const matchMedia = (media: string): Partial<MediaQueryList> => ({ matches, media });
  // The inline script runs in the jsdom window, which is not the test globalThis.
  for (const target of [globalThis, document.defaultView ?? globalThis]) {
    Object.defineProperty(target, 'matchMedia', { configurable: true, writable: true, value: matchMedia });
  }
}

function resetDocumentTheme(): void {
  const root = document.documentElement;
  root.classList.remove('dark');
  root.style.colorScheme = '';
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute('content', ''));
}

function readAppliedTheme(): AppliedTheme {
  const root = document.documentElement;
  return {
    dark: root.classList.contains('dark'),
    colorScheme: root.style.colorScheme,
    themeColors: Array.from(
      document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
      (meta) => meta.content,
    ),
  };
}

/** Executes the pre-paint `#theme-init` script exactly as shipped in src/index.html. */
function runIndexHtmlThemeScript(): void {
  const indexHtml = readFileSync(resolve(process.cwd(), 'src/index.html'), 'utf8');
  const source = /<script id="theme-init">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? '';
  expect(source).toContain(STORAGE_KEY);
  const script = document.createElement('script');
  script.textContent = source;
  document.head.appendChild(script);
  script.remove();
}

describe('ThemeService document side effects', () => {
  const metas: HTMLMetaElement[] = [];

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    for (const media of ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.media = media;
      document.head.appendChild(meta);
      metas.push(meta);
    }
    TestBed.configureTestingModule({ providers: [ThemeService] });
  });

  afterEach(() => {
    metas.splice(0).forEach((meta) => meta.remove());
    localStorage.removeItem(STORAGE_KEY);
    resetDocumentTheme();
  });

  it('syncs every theme-color meta with the active theme', () => {
    const service = TestBed.inject(ThemeService);
    service.setTheme('dark');
    flush();
    expect(readAppliedTheme().themeColors).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);

    service.setTheme('light');
    flush();
    expect(readAppliedTheme().themeColors).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  });

  it.each([
    { saved: 'light', prefersDark: true },
    { saved: 'dark', prefersDark: false },
    { saved: null, prefersDark: true },
    { saved: null, prefersDark: false },
    { saved: 'sepia', prefersDark: true },
  ])('index.html pre-paint script matches the service (saved=$saved, prefersDark=$prefersDark)', ({ saved, prefersDark }) => {
    if (saved) localStorage.setItem(STORAGE_KEY, saved);
    stubPrefersDark(prefersDark);

    runIndexHtmlThemeScript();
    const fromInlineScript = readAppliedTheme();

    resetDocumentTheme();
    TestBed.inject(ThemeService);
    flush();

    expect(fromInlineScript).toEqual(readAppliedTheme());
    expect(fromInlineScript.dark).toBe(saved === 'dark' || (saved !== 'light' && prefersDark));
  });
});
