import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { LINKED_STATUS_CACHE_KEY } from '../../constants/storage.constants';
import type { UserProfile, SavedLocation, LinkErrorCode } from './user-profile.models';
import { AccountLinkError, LINK_ERROR_MESSAGES } from './user-profile.models';
import { UserProfileService } from './user-profile.service';
import { LinkedAccessService } from './linked-access.service';
import { AuthService } from '../auth/auth.service';
import * as firestoreModule from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Firestore mock (only the caller's own profile doc is still read/written here)
// ---------------------------------------------------------------------------
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn().mockReturnValue({}),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  setDoc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/app', () => ({
  getApps: vi.fn().mockReturnValue([{}]),
  initializeApp: vi.fn(),
}));

let mockGetDoc: ReturnType<typeof vi.fn>;
let mockSetDoc: ReturnType<typeof vi.fn>;

beforeAll(() => {
  mockGetDoc = firestoreModule.getDoc;
  mockSetDoc = firestoreModule.setDoc;
});

const makeAuthStub = (uid: string | null = 'user-123') => ({
  currentUser: signal(uid ? { uid } : null),
});

const existsSnap = (data: object) => ({ exists: () => true, data: () => data });

const makeLocation = (overrides: Partial<SavedLocation> = {}): SavedLocation => ({
  id: 'loc-1',
  name: 'My Base',
  mapHash: '#world:0:64:0',
  description: 'Test location',
  isPublic: false,
  ...overrides,
});

const ACCOUNTS = { java: 'Steve', bedrock: null, admin: null };

interface Configured {
  service: UserProfileService;
  access: LinkedAccessService;
  http: HttpTestingController;
}

function configure(uid: string | null = 'user-123'): Configured {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      UserProfileService,
      { provide: AuthService, useValue: makeAuthStub(uid) },
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  return {
    service: TestBed.inject(UserProfileService),
    access: TestBed.inject(LinkedAccessService),
    http: TestBed.inject(HttpTestingController),
  };
}

const clearLinkedCache = (): void => {
  try {
    localStorage.removeItem(LINKED_STATUS_CACHE_KEY);
  } catch {
    /* ignore */
  }
};

describe('UserProfileService', () => {
  let service: UserProfileService;
  let access: LinkedAccessService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    mockGetDoc.mockReset();
    mockSetDoc.mockReset();
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    mockSetDoc.mockResolvedValue(undefined);
    clearLinkedCache();
    ({ service, access, http: httpMock } = configure());
  });

  afterEach(() => {
    httpMock.verify();
    clearLinkedCache();
  });

  it('starts with a default profile', () => {
    expect(service.savedLocations()).toEqual([]);
    expect(service.minecraftAccounts()).toEqual({ java: null, bedrock: null, admin: null });
    expect(service.minecraftUsername()).toBeNull();
  });

  describe('loadProfile()', () => {
    it('does nothing when not authenticated', async () => {
      ({ service, http: httpMock } = configure(null));
      await service.loadProfile();
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it('sets the default profile when the doc does not exist', async () => {
      await service.loadProfile();
      expect(service.savedLocations()).toEqual([]);
      expect(service.isLoaded()).toBe(true);
      expect(service.isLoading()).toBe(false);
    });

    it('loads the own profile doc from Firestore', async () => {
      const profile: UserProfile = { minecraftAccounts: ACCOUNTS, savedLocations: [makeLocation()] };
      mockGetDoc.mockResolvedValueOnce(existsSnap(profile));
      await service.loadProfile();
      expect(service.minecraftUsername()).toBe('Steve');
      expect(service.savedLocations()).toHaveLength(1);
    });

    it('migrates the legacy minecraftUsername field', async () => {
      mockGetDoc.mockResolvedValueOnce(existsSnap({ minecraftUsername: 'OldSteve' }));
      await service.loadProfile();
      expect(service.minecraftUsername()).toBe('OldSteve');
    });

    it('does not read Firestore again for the same user', async () => {
      await service.loadProfile();
      mockGetDoc.mockClear();
      await service.loadProfile();
      expect(mockGetDoc).not.toHaveBeenCalled();
    });
  });

  describe('linkAccount()', () => {
    it('POSTs the credentials and adopts the server account map (no Firestore write)', async () => {
      const promise = service.linkAccount('java', 'Steve', 'pw');
      const req = httpMock.expectOne('/api/profile/accounts');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ type: 'java', username: 'Steve', password: 'pw' });
      req.flush({ minecraftAccounts: ACCOUNTS });
      await promise;
      expect(service.minecraftAccounts()).toEqual(ACCOUNTS);
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('marks the user as linked for the route guard', async () => {
      const promise = service.linkAccount('admin', 'Steve', 'pw');
      httpMock.expectOne('/api/profile/accounts').flush({ minecraftAccounts: { java: null, bedrock: null, admin: 'Steve' } });
      await promise;
      expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBe('1');
      await expect(access.fetchLinkedStatus()).resolves.toBe(true);
      httpMock.expectNone('/api/profile');
    });

    it.each<[LinkErrorCode, number]>([
      ['invalid_credentials', 403],
      ['not_operator', 403],
      ['rate_limited', 429],
      ['unavailable', 503],
      ['invalid_request', 400],
    ])('rejects with AccountLinkError(%s) from the server code', async (code: LinkErrorCode, status: number) => {
      const promise = service.linkAccount('java', 'Steve', 'pw');
      httpMock.expectOne('/api/profile/accounts').flush({ error: 'x', code }, { status, statusText: 'Error' });
      const err = await promise.catch((e: Error) => e);
      expect(err).toBeInstanceOf(AccountLinkError);
      expect((err as AccountLinkError).code).toBe(code);
      expect(err.message).toBe(LINK_ERROR_MESSAGES[code]);
      expect(service.minecraftAccounts().java).toBeNull();
    });

    it('maps unknown codes and network errors to "failed"', async () => {
      const first = service.linkAccount('java', 'Steve', 'pw');
      httpMock.expectOne('/api/profile/accounts').flush({ code: 'weird' }, { status: 500, statusText: 'Error' });
      await expect(first).rejects.toMatchObject({ code: 'failed' });

      const second = service.linkAccount('java', 'Steve', 'pw');
      httpMock.expectOne('/api/profile/accounts').error(new ProgressEvent('error'));
      await expect(second).rejects.toMatchObject({ code: 'failed' });
    });
  });

  describe('unlinkAccount()', () => {
    it('DELETEs the account type and adopts the server account map', async () => {
      service.profile.set({ minecraftAccounts: ACCOUNTS, savedLocations: [] });
      const promise = service.unlinkAccount('java');
      const req = httpMock.expectOne('/api/profile/accounts/java');
      expect(req.request.method).toBe('DELETE');
      req.flush({ minecraftAccounts: { java: null, bedrock: null, admin: null } });
      await promise;
      expect(service.minecraftUsername()).toBeNull();
    });

    it('clears the linked-status cache when nothing stays linked', async () => {
      localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');
      const promise = service.unlinkAccount('java');
      httpMock.expectOne('/api/profile/accounts/java').flush({ minecraftAccounts: { java: null, bedrock: null, admin: null } });
      await promise;
      expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBeNull();
    });

    it('rejects with an AccountLinkError on failure', async () => {
      const promise = service.unlinkAccount('bedrock');
      httpMock.expectOne('/api/profile/accounts/bedrock')
        .flush({ code: 'unavailable' }, { status: 503, statusText: 'Unavailable' });
      await expect(promise).rejects.toMatchObject({ code: 'unavailable' });
    });
  });
});

// ---------------------------------------------------------------------------
// reset() — per-user state must not survive a change of signed-in account.
// It is the single entry point, so it must also reset LinkedAccessService.
// ---------------------------------------------------------------------------
describe('UserProfileService.reset()', () => {
  let service: UserProfileService;
  let access: LinkedAccessService;
  let httpMock: HttpTestingController;
  let auth: ReturnType<typeof makeAuthStub>;

  beforeEach(() => {
    mockGetDoc.mockReset();
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    auth = makeAuthStub('user-a');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        UserProfileService,
        { provide: AuthService, useValue: auth },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(UserProfileService);
    access = TestBed.inject(LinkedAccessService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    try {
      localStorage.removeItem(LINKED_STATUS_CACHE_KEY);
    } catch {
      /* ignore */
    }
  });

  it('forgets a sticky positive access check so the next user is re-checked', async () => {
    const first = access.fetchLinkedStatus();
    httpMock.expectOne('/api/profile').flush({ hasLinkedAccount: true });
    await expect(first).resolves.toBe(true);
    localStorage.removeItem(LINKED_STATUS_CACHE_KEY);

    service.reset();

    const second = access.fetchLinkedStatus();
    httpMock.expectOne('/api/profile').flush({ hasLinkedAccount: false });
    await expect(second).resolves.toBe(false);
  });

  it('drops the loaded profile so the next user gets their own', async () => {
    mockGetDoc.mockResolvedValueOnce(existsSnap({
      minecraftAccounts: { java: 'Alice', bedrock: null, admin: null },
      savedLocations: [makeLocation()],
    }));
    await service.loadProfile();
    expect(service.minecraftUsername()).toBe('Alice');

    service.reset();

    expect(service.minecraftAccounts()).toEqual({ java: null, bedrock: null, admin: null });
    expect(service.savedLocations()).toEqual([]);
    expect(service.isLoaded()).toBe(false);
    expect(service.isLoading()).toBe(false);

    auth.currentUser.set({ uid: 'user-b' });
    await service.loadProfile();
    expect(mockGetDoc).toHaveBeenLastCalledWith({ path: 'users/user-b' });
  });

  it('drops an access check that resolves after reset()', async () => {
    const stale = access.fetchLinkedStatus();
    service.reset();
    httpMock.expectOne('/api/profile').flush({ hasLinkedAccount: true });
    await expect(stale).resolves.toBe(false);

    const fresh = access.fetchLinkedStatus();
    httpMock.expectOne('/api/profile').flush({ hasLinkedAccount: false });
    await expect(fresh).resolves.toBe(false);
    expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBeNull();
  });

  it('drops a profile load that resolves after reset()', async () => {
    let resolveSnap: (snap: unknown) => void = () => undefined;
    mockGetDoc.mockReturnValueOnce(new Promise((r) => { resolveSnap = r; }));
    const staleLoad = service.loadProfile();
    await vi.waitFor(() => {
      expect(mockGetDoc).toHaveBeenCalledTimes(1);
    });

    service.reset();
    resolveSnap(existsSnap({ minecraftAccounts: { java: 'Alice', bedrock: null, admin: null }, savedLocations: [] }));
    await staleLoad;

    expect(service.minecraftUsername()).toBeNull();
    expect(service.isLoaded()).toBe(false);
  });

  it('lets the same user reload after a reset', async () => {
    await service.loadProfile();
    mockGetDoc.mockClear();

    service.reset();
    await service.loadProfile();

    expect(mockGetDoc).toHaveBeenCalledTimes(1);
  });
});
