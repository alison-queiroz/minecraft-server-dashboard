import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const STORAGE_KEY = 'minecraft-dashboard-theme';

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
});
