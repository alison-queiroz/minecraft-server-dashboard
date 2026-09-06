import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { vi } from 'vitest';
import { AuthService } from './auth.service';

@Component({ standalone: true, template: '' })
class BlankComponent {}

// ── Firebase mocks ───────────────────────────────────────────────────────────
const mockSignInWithPopup = vi.fn().mockResolvedValue({ user: { uid: 'u1' } });
const mockSignOut = vi.fn().mockResolvedValue(undefined);
let authStateCb: ((user: unknown) => void) | null = null;

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => [{}]),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null })),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: (...args: unknown[]): Promise<unknown> => mockSignInWithPopup(...args) as Promise<unknown>,
  signOut: (...args: unknown[]): Promise<unknown> => mockSignOut(...args) as Promise<unknown>,
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authStateCb = cb;
    return () => undefined;
  },
}));

function makeService(): { service: AuthService; router: Router } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'login', component: BlankComponent }]), AuthService],
  });
  return { service: TestBed.inject(AuthService), router: TestBed.inject(Router) };
}

describe('AuthService', () => {
  let service: AuthService;
  let router: Router;

  beforeEach(() => {
    mockSignInWithPopup.mockClear();
    mockSignOut.mockClear();
    authStateCb = null;
    ({ service, router } = makeService());
  });

  it('starts with no user and loading=true until Firebase restores the session', () => {
    expect(service.currentUser()).toBeNull();
    expect(service.isLoading()).toBe(true);
  });

  it('publishes the user and clears loading when onAuthStateChanged fires', () => {
    expect(authStateCb).toBeTypeOf('function');
    const user = { uid: 'abc' };
    authStateCb!(user);
    expect(service.currentUser()).toBe(user);
    expect(service.isLoading()).toBe(false);
  });

  it('signInWithGoogle calls Firebase signInWithPopup', async () => {
    await service.signInWithGoogle();
    expect(mockSignInWithPopup).toHaveBeenCalledTimes(1);
  });

  it('signOut calls Firebase signOut and navigates to /login', async () => {
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await service.signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(navSpy).toHaveBeenCalledWith(['/login']);
  });

  it('getIdToken returns null when no current user is signed in', async () => {
    expect(await service.getIdToken()).toBeNull();
  });

  it('sets currentUser to null when __E2E_UNAUTHENTICATED__ flag is set', () => {
    (globalThis as Record<string, unknown>)['__E2E_UNAUTHENTICATED__'] = true;
    try {
      const { service: svc } = makeService();
      expect(svc.currentUser()).toBeNull();
      expect(svc.isLoading()).toBe(false);
    } finally {
      delete (globalThis as Record<string, unknown>)['__E2E_UNAUTHENTICATED__'];
    }
  });

  it('signOut via the e2eAuthEnabled path clears the user and navigates', async () => {
    (globalThis as { __E2E_AUTH_USER__?: unknown }).__E2E_AUTH_USER__ = { uid: 'test' };
    try {
      const { service: svc, router: r } = makeService();
      const navSpy = vi.spyOn(r, 'navigate').mockResolvedValue(true);
      await svc.signOut();
      expect(svc.currentUser()).toBeNull();
      expect(navSpy).toHaveBeenCalledWith(['/login']);
      // The e2e shortcut must NOT call the real Firebase signOut.
      expect(mockSignOut).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { __E2E_AUTH_USER__?: unknown }).__E2E_AUTH_USER__;
    }
  });
});
