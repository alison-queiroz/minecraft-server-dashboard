import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { vi } from 'vitest';
import { AppComponent } from './app.component';
import { LoadingService } from './services/loading/loading.service';
import { ThemeService } from './services/theme/theme.service';

@Component({ standalone: true, template: '' })
class BlankComponent {}

const makeThemeStub = () => ({
  theme: signal<'light' | 'dark'>('dark'),
  isDark: signal(true),
  toggleTheme: jest.fn(),
});

describe('AppComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ThemeService, useValue: makeThemeStub() },
        provideRouter([
          { path: '', component: BlankComponent },
          { path: 'server', component: BlankComponent },
          { path: 'players', component: BlankComponent },
          { path: 'profile', component: BlankComponent },
          { path: 'map', component: BlankComponent },
          { path: 'backups', component: BlankComponent },
          { path: 'analytics', component: BlankComponent },
        ]),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.match(() => true);
    httpMock.verify();
  });

  it('should create the app', () => {
    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render nav, router outlet, and footer', () => {
    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-nav')).toBeTruthy();
    expect(el.querySelector('router-outlet')).toBeTruthy();
    expect(el.querySelector('app-footer')).toBeTruthy();
  });

  it('binds the current theme on the app shell', () => {
    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const shell = (fixture.nativeElement as HTMLElement).querySelector('[data-theme]');
    expect(shell?.getAttribute('data-theme')).toBe('dark');
  });

  it('updates drag and animation state from directive output handlers', () => {
    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    const comp = fixture.componentInstance as unknown as {
      onDragXChange(value: number): void;
      onDraggingChange(value: boolean): void;
      onNavigateDirection(direction: 'left' | 'right'): void;
      dragX: () => number;
      isDragging: () => boolean;
      enterFrom: () => 'left' | 'right' | null;
    };

    comp.onDragXChange(42);
    comp.onDraggingChange(true);
    comp.onNavigateDirection('right');

    expect(comp.dragX()).toBe(0);
    expect(comp.isDragging()).toBe(true);
    expect(comp.enterFrom()).toBe('right');
  });

  it('renders the global loading bar while HTTP requests are in flight', () => {
    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    const loading = TestBed.inject(LoadingService);

    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading-bar')).toBeNull();

    loading.start();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading-bar')).toBeTruthy();

    loading.done();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.loading-bar')).toBeNull();
  });

  it('clears enterFrom after NavigationEnd fires when timeout elapses', async () => {
    vi.useFakeTimers();
    const fixture: ComponentFixture<AppComponent> = TestBed.createComponent(AppComponent);
    const comp = fixture.componentInstance as unknown as {
      onNavigateDirection(d: 'left' | 'right'): void;
      enterFrom: { (): 'left' | 'right' | null };
    };
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    httpMock.match(() => true);

    comp.onNavigateDirection('right');
    expect(comp.enterFrom()).toBe('right');

    await router.navigate(['/server']);
    vi.advanceTimersByTime(350);
    fixture.detectChanges();
    expect(comp.enterFrom()).toBeNull();

    vi.useRealTimers();
    httpMock.match(() => true);
  });
});




