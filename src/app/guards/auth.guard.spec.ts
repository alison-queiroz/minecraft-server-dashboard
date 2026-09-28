import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import type { User } from 'firebase/auth';
import type { Mock } from 'vitest';

import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth/auth.service';
import { LinkedAccessService } from '../services/user-profile/linked-access.service';
import { LINKED_STATUS_CACHE_KEY } from '../constants/storage.constants';

// Firebase is mocked for the real-service regression suite at the bottom; the
// stub-based suite never constructs the real AuthService.
let authStateCb: ((user: User | null) => void) | null = null;

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => [{}]),
}));

vi.mock('firebase/auth', () => ({
  initializeAuth: vi.fn(() => ({ currentUser: null })),
  indexedDBLocalPersistence: {},
  browserLocalPersistence: {},
  browserSessionPersistence: {},
  browserPopupRedirectResolver: {},
  onAuthStateChanged: (_auth: unknown, cb: (user: User | null) => void) => {
    authStateCb = cb;
    return () => undefined;
  },
  signOut: vi.fn().mockResolvedValue(undefined),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn(),
}));

@Component({ standalone: true, template: '' })
class BlankComponent {}

function runGuard(): Promise<boolean> {
  return firstValueFrom(
    TestBed.runInInjectionContext(
      () => authGuard({} as never, {} as never),
    ) as Observable<boolean>,
  );
}

const makeAccessStub = (hasLinkedAccount = true) => ({
  fetchLinkedStatus: jest.fn().mockResolvedValue(hasLinkedAccount),
});

describe('authGuard', () => {
  let isLoading = signal(false);
  let currentUser = signal<User | null>(null);
  let mockRouter: { navigate: Mock };
  let accessStub: ReturnType<typeof makeAccessStub>;

  beforeEach(() => {
    isLoading = signal(false);
    currentUser = signal<User | null>(null);
    mockRouter = { navigate: jest.fn() };
    accessStub = makeAccessStub(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isLoading, currentUser } },
        { provide: Router, useValue: mockRouter },
        { provide: LinkedAccessService, useValue: accessStub },
      ],
    });
  });

  it('returns true when the user is authenticated and has a linked Java account', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    expect(await runGuard()).toBe(true);
  });

  it('navigates to /login and returns false for an unauthenticated user', async () => {
    currentUser.set(null);
    const result = await runGuard();
    expect(result).toBe(false);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('does not navigate to /login when the user is authenticated and has a linked Java account', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    await runGuard();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('redirects to /login when Firebase-authed but no account is linked', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    accessStub.fetchLinkedStatus.mockResolvedValue(false);
    const result = await runGuard();
    expect(result).toBe(false);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('checks linked-account status (over HTTP, not client Firestore) before allowing', async () => {
    currentUser.set({ uid: 'user-abc' } as User);
    await runGuard();
    expect(accessStub.fetchLinkedStatus).toHaveBeenCalled();
  });
});

// Regression: access state must not survive a change of account on one tab.
describe('authGuard with the real AuthService and profile services', () => {
  let auth: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.removeItem(LINKED_STATUS_CACHE_KEY);
    authStateCb = null;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', component: BlankComponent }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    auth = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem(LINKED_STATUS_CACHE_KEY);
  });

  async function guardWithProfile(hasLinkedAccount: boolean): Promise<boolean> {
    const result = runGuard();
    const req = await vi.waitFor(() => httpMock.expectOne('/api/profile'));
    req.flush({ hasLinkedAccount });
    return result;
  }

  it('denies unlinked user B after linked user A signs out on the same tab', async () => {
    authStateCb!({ uid: 'user-a' } as User);
    expect(await guardWithProfile(true)).toBe(true);

    await auth.signOut();
    authStateCb!(null);
    authStateCb!({ uid: 'user-b' } as User);

    expect(await guardWithProfile(false)).toBe(false);
  });

  it('denies unlinked user B when Firebase switches accounts without a local sign-out', async () => {
    authStateCb!({ uid: 'user-a' } as User);
    expect(await guardWithProfile(true)).toBe(true);

    // e.g. A signed out and B signed in from another tab.
    authStateCb!({ uid: 'user-b' } as User);

    expect(await guardWithProfile(false)).toBe(false);
  });

  it('still lets the same user through without a recheck', async () => {
    authStateCb!({ uid: 'user-a' } as User);
    expect(await guardWithProfile(true)).toBe(true);

    expect(await runGuard()).toBe(true);
  });
});




