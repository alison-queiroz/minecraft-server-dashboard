import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { NavComponent } from './nav.component';
import { ServerService } from '../../../services/server/server.service';
import { AuthService } from '../../../services/auth/auth.service';
import { ThemeService } from '../../../services/theme/theme.service';

const makeServerStub = () => ({
  status: signal('LOADING' as const),
  bedrockStatus: signal('LOADING' as const),
  onlinePlayers: signal(0),
  maxPlayers: signal(0),
  bedrockOnlinePlayers: signal(0),
  bedrockMaxPlayers: signal(0),
  version: signal(null),
  motd: signal([]),
  software: signal(null),
  hostname: signal(null),
  ip: signal(null),
  port: signal(null),
  protocol: signal(null),
  bedrockVersion: signal(null),
  bedrockPort: signal(null),
  bedrockProtocol: signal(null),
});

const makeAuthStub = () => ({
  currentUser: signal(null),
  isLoading: signal(false),
  signInWithGoogle: jest.fn().mockResolvedValue(undefined),
  signOut: jest.fn().mockResolvedValue(undefined),
  getIdToken: jest.fn().mockResolvedValue(null),
});

const makeThemeStub = () => ({
  theme: signal<'light' | 'dark'>('dark'),
  isDark: signal(true),
  toggleTheme: jest.fn(),
});

type SignalGetter<T> = () => T;

interface NavTestAccess {
  menuOpen: SignalGetter<boolean>;
}

function asNavTestAccess(component: NavComponent): NavTestAccess {
  return component as unknown as NavTestAccess;
}

describe('NavComponent', () => {
  let fixture: ComponentFixture<NavComponent>;
  let component: NavComponent;
  let authStub: ReturnType<typeof makeAuthStub>;
  let themeStub: ReturnType<typeof makeThemeStub>;

  beforeEach(async () => {
    authStub = makeAuthStub();
    themeStub = makeThemeStub();

    await TestBed.configureTestingModule({
      imports: [NavComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        provideRouter([]),
        { provide: ServerService, useValue: makeServerStub() },
        { provide: AuthService, useValue: authStub },
        { provide: ThemeService, useValue: themeStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NavComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('menuOpen starts false', () => {
    expect(asNavTestAccess(component).menuOpen()).toBe(false);
  });

  it('toggleMenu flips menuOpen true', () => {
    component.toggleMenu();
    expect(asNavTestAccess(component).menuOpen()).toBe(true);
  });

  it('toggleMenu flips menuOpen back to false', () => {
    component.toggleMenu();
    component.toggleMenu();
    expect(asNavTestAccess(component).menuOpen()).toBe(false);
  });

  it('closeMenu sets menuOpen to false', () => {
    component.toggleMenu();
    component.closeMenu();
    expect(asNavTestAccess(component).menuOpen()).toBe(false);
  });

  it('signOut closes menu and calls auth.signOut()', async () => {
    component.toggleMenu();
    await component.signOut();
    expect(asNavTestAccess(component).menuOpen()).toBe(false);
    expect(authStub.signOut).toHaveBeenCalled();
  });

  it('toggleTheme delegates to the theme service', () => {
    component.toggleTheme();
    expect(themeStub.toggleTheme).toHaveBeenCalled();
  });

  describe('disclosure accessibility', () => {
    const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const menuToggle = (): HTMLButtonElement => host().querySelector<HTMLButtonElement>('.menu-toggle')!;
    const moreToggle = (): HTMLButtonElement => host().querySelector<HTMLButtonElement>('.more-button')!;
    const pressEscape = (): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
    };

    it('menu toggle exposes aria-expanded and controls the rendered mobile menu', () => {
      expect(menuToggle().getAttribute('aria-expanded')).toBe('false');

      menuToggle().click();
      fixture.detectChanges();

      expect(menuToggle().getAttribute('aria-expanded')).toBe('true');
      const controlled = menuToggle().getAttribute('aria-controls');
      expect(host().querySelector(`#${controlled}`)?.classList).toContain('mobile-menu');
    });

    it('More toggle exposes aria-expanded and controls the rendered dropdown', () => {
      expect(moreToggle().getAttribute('aria-expanded')).toBe('false');

      moreToggle().click();
      fixture.detectChanges();

      expect(moreToggle().getAttribute('aria-expanded')).toBe('true');
      const controlled = moreToggle().getAttribute('aria-controls');
      expect(host().querySelector(`#${controlled}`)?.classList).toContain('dropdown-menu');
    });

    it('Escape closes the mobile menu and returns focus to its toggle', () => {
      menuToggle().click();
      fixture.detectChanges();
      host().querySelector<HTMLAnchorElement>('.mobile-link')!.focus();

      pressEscape();

      expect(asNavTestAccess(component).menuOpen()).toBe(false);
      expect(host().querySelector('.mobile-menu')).toBeNull();
      expect(document.activeElement).toBe(menuToggle());
    });

    it('Escape closes the More dropdown and returns focus to its toggle', () => {
      moreToggle().click();
      fixture.detectChanges();
      host().querySelector<HTMLAnchorElement>('.dropdown-link')!.focus();

      pressEscape();

      expect(host().querySelector('.dropdown-menu')).toBeNull();
      expect(moreToggle().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(moreToggle());
    });

    it('Escape leaves focus alone when nothing is open', () => {
      const themeToggle = host().querySelector<HTMLButtonElement>('.theme-toggle')!;
      themeToggle.focus();

      pressEscape();

      expect(document.activeElement).toBe(themeToggle);
    });
  });
});



