import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { UserProfileService } from '../user-profile/user-profile.service';
import { LINKED_STATUS_CACHE_KEY } from '../../constants/storage.constants';

@Component({ standalone: true, template: '' })
class BlankComponent {}

// ── Firebase mocks ───────────────────────────────────────────────────────────
const mockSignInWithPopup = vi.fn().mockResolvedValue({ user: { uid: 'u1' } });
const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockGetRedirectResult = vi.fn().mockResolvedValue(null);
const mockInitializeAuth = vi.fn((_app: unknown, _deps: unknown) => ({ currentUser: null }));
let authStateCb: ((user: unknown) => void) | null = null;

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => [{}]),
}));

vi.mock('firebase/auth', () => ({
  initializeAuth: (app: unknown, deps: unknown): unknown => mockInitializeAuth(app, deps),
  indexedDBLocalPersistence: 'indexedDB',
  browserLocalPersistence: 'local',
  browserSessionPersistence: 'session',
  browserPopupRedirectResolver: 'popupRedirectResolver',
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: (...args: unknown[]): Promise<unknown> => mockSignInWithPopup(...args) as Promise<unknown>,
  signOut: (...args: unknown[]): Promise<unknown> => mockSignOut(...args) as Promise<unknown>,
  getRedirectResult: (...args: unknown[]): Promise<unknown> => mockGetRedirectResult(...args) as Promise<unknown>,
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authStateCb = cb;
    return () => undefined;
  },
}));

const profileStub = { reset: vi.fn() };

function makeService(): { service: AuthService; router: Router } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'login', component: BlankComponent }]),
      AuthService,
      { provide: UserProfileService, useValue: profileStub },
    ],
  });
  return { service: TestBed.inject(AuthService), router: TestBed.inject(Router) };
}

describe('AuthService', () => {
  let service: AuthService;
  let router: Router;

  beforeEach(() => {
    mockSignInWithPopup.mockClear();
    mockSignOut.mockClear();
    profileStub.reset.mockClear();
    localStorage.removeItem(LINKED_STATUS_CACHE_KEY);
    authStateCb = null;
    ({ service, router } = makeService());
  });

  afterEach(() => localStorage.removeItem(LINKED_STATUS_CACHE_KEY));

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

  it('initializes Auth with getAuth()\'s persistence order but no popup/redirect resolver', () => {
    const [, deps] = mockInitializeAuth.mock.calls.at(-1)!;
    // indexedDB first: existing sessions stored by getAuth() must still restore.
    expect(deps).toEqual({ persistence: ['indexedDB', 'local', 'session'] });
    // A resolver at init makes mobile/Safari load gapi + the auth iframe before
    // restoring the session, blocking the guard and every authed /api/ call.
    expect(deps).not.toHaveProperty('popupRedirectResolver');
  });

  it('passes identical deps on every bootstrap so Firebase reuses the existing Auth', () => {
    makeService();
    const [first, second] = mockInitializeAuth.mock.calls.slice(-2);
    expect(second[1]).toBe(first[1]);
  });

  it('signInWithGoogle hands the popup resolver to signInWithPopup', async () => {
    await service.signInWithGoogle();
    expect(mockSignInWithPopup).toHaveBeenCalledTimes(1);
    expect(mockSignInWithPopup.mock.calls[0][2]).toBe('popupRedirectResolver');
  });

  it('warmUpSignIn initialises the popup resolver once, without signing in', () => {
    mockGetRedirectResult.mockClear();
    service.warmUpSignIn();
    service.warmUpSignIn();
    expect(mockGetRedirectResult).toHaveBeenCalledTimes(1);
    expect(mockGetRedirectResult.mock.calls[0][1]).toBe('popupRedirectResolver');
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
  });

  it('warmUpSignIn swallows a failed warm-up (sign-in will simply retry it)', async () => {
    mockGetRedirectResult.mockRejectedValueOnce(new Error('network'));
    expect(() => service.warmUpSignIn()).not.toThrow();
    await Promise.resolve();
  });

  it('signOut calls Firebase signOut and navigates to /login', async () => {
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await service.signOut();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(navSpy).toHaveBeenCalledWith(['/login']);
  });

  it('signOut drops the linked-account cache and the in-memory profile state', async () => {
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    authStateCb!({ uid: 'user-a' });
    localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');

    await service.signOut();

    expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBeNull();
    expect(profileStub.reset).toHaveBeenCalledTimes(1);
  });

  describe('when Firebase reports a change of identity', () => {
    it('keeps the optimistic linked cache when the restore brings back a signed-in user', () => {
      localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');
      authStateCb!({ uid: 'user-a' });
      expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBe('1');
      expect(profileStub.reset).not.toHaveBeenCalled();
    });

    it('clears leftover state when the restore finds nobody signed in', () => {
      localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');
      authStateCb!(null);
      expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBeNull();
      expect(profileStub.reset).toHaveBeenCalledTimes(1);
    });

    it('resets per-user state when a different user is reported', () => {
      authStateCb!({ uid: 'user-a' });
      localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');
      authStateCb!({ uid: 'user-b' });
      expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBeNull();
      expect(profileStub.reset).toHaveBeenCalledTimes(1);
    });

    it('resets per-user state when the user is signed out elsewhere', () => {
      authStateCb!({ uid: 'user-a' });
      authStateCb!(null);
      expect(profileStub.reset).toHaveBeenCalledTimes(1);
    });

    it('does not reset when the same user is reported again', () => {
      authStateCb!({ uid: 'user-a' });
      localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');
      authStateCb!({ uid: 'user-a' });
      expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBe('1');
      expect(profileStub.reset).not.toHaveBeenCalled();
    });

    it('resets before publishing the new user', () => {
      authStateCb!({ uid: 'user-a' });
      profileStub.reset.mockImplementationOnce(() => {
        expect(service.currentUser()).toEqual({ uid: 'user-a' });
      });
      authStateCb!({ uid: 'user-b' });
      expect(profileStub.reset).toHaveBeenCalledTimes(1);
      expect(service.currentUser()).toEqual({ uid: 'user-b' });
    });
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
      // No auth listener runs in this mode, so signOut itself must reset.
      expect(profileStub.reset).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as { __E2E_AUTH_USER__?: unknown }).__E2E_AUTH_USER__;
    }
  });
});
