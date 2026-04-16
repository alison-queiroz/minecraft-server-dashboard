import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type {
  UserProfile,
  SavedLocation,
  SavedHome,
} from './user-profile.service';
import { firstValueFrom } from 'rxjs';
import { UserProfileService } from './user-profile.service';
import { AuthService } from '../auth/auth.service';
import * as firestoreModule from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Firestore mock
// ---------------------------------------------------------------------------
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn().mockReturnValue({}),
  doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  setDoc: vi.fn().mockResolvedValue(undefined),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  onSnapshot: vi.fn().mockReturnValue(() => undefined),
}));

vi.mock('firebase/app', () => ({
  getApps: vi.fn().mockReturnValue([{}]),
  initializeApp: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Typed references to the mocked module functions
// ---------------------------------------------------------------------------
let mockGetDoc: ReturnType<typeof vi.fn>;
let mockSetDoc: ReturnType<typeof vi.fn>;
let mockUpdateDoc: ReturnType<typeof vi.fn>;
let mockDeleteDoc: ReturnType<typeof vi.fn>;
let mockOnSnapshot: ReturnType<typeof vi.fn>;

beforeAll(() => {
  mockGetDoc = firestoreModule.getDoc as unknown as ReturnType<typeof vi.fn>;
  mockSetDoc = firestoreModule.setDoc as unknown as ReturnType<typeof vi.fn>;
  mockUpdateDoc = firestoreModule.updateDoc as unknown as ReturnType<typeof vi.fn>;
  mockDeleteDoc = firestoreModule.deleteDoc as unknown as ReturnType<typeof vi.fn>;
  mockOnSnapshot = firestoreModule.onSnapshot as unknown as ReturnType<typeof vi.fn>;
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
const makeAuthStub = (uid: string | null = 'user-123') => ({
  currentUser: signal(uid ? { uid } as { uid: string } : null),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const notExistsSnap = () => ({ exists: () => false, data: () => ({}) });
const existsSnap = (data: object) => ({ exists: () => true, data: () => data });

const makeLocation = (overrides: Partial<SavedLocation> = {}): SavedLocation => ({
  id: 'loc-1',
  name: 'My Base',
  mapHash: '#world:0:64:0',
  description: 'Test location',
  isPublic: false,
  ...overrides,
});

const makeHome = (overrides: Partial<SavedHome> = {}): SavedHome => ({
  id: 'home-1',
  name: 'home',
  x: 10,
  y: 64,
  z: -5,
  world: 'world',
  isPublic: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('UserProfileService', () => {
  let service: UserProfileService;

  beforeEach(() => {
    // mockReset clears both call history AND the mockResolvedValueOnce queue
    mockGetDoc.mockReset();
    mockSetDoc.mockReset();
    mockUpdateDoc.mockReset();
    mockDeleteDoc.mockReset();
    mockOnSnapshot.mockReset();

    // Restore sensible defaults after reset
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    mockSetDoc.mockResolvedValue(undefined);
    mockUpdateDoc.mockResolvedValue(undefined);
    mockDeleteDoc.mockResolvedValue(undefined);
    mockOnSnapshot.mockReturnValue(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        UserProfileService,
        { provide: AuthService, useValue: makeAuthStub() },
      ],
    });
    service = TestBed.inject(UserProfileService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts with a default profile', () => {
    expect(service.savedLocations()).toEqual([]);
    expect(service.savedHomes()).toEqual([]);
    expect(service.minecraftAccounts()).toEqual({ java: null, bedrock: null, admin: null });
    expect(service.minecraftUsername()).toBeNull();
  });

  describe('loadProfile()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.loadProfile();
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it('sets default profile when doc does not exist', async () => {
      await service.loadProfile();
      expect(service.savedLocations()).toEqual([]);
    });

    it('loads profile from Firestore when doc exists', async () => {
      const profile: Partial<UserProfile> = {
        minecraftAccounts: { java: 'Steve', bedrock: null, admin: null },
        savedLocations: [makeLocation()],
        savedHomes: [makeHome()],
      };
      mockGetDoc.mockResolvedValueOnce(existsSnap(profile));
      await service.loadProfile();
      expect(service.minecraftUsername()).toBe('Steve');
      expect(service.savedLocations()).toHaveLength(1);
    });

    it('migrates legacy minecraftUsername field', async () => {
      mockGetDoc.mockResolvedValueOnce(existsSnap({ minecraftUsername: 'OldSteve' }));
      await service.loadProfile();
      expect(service.minecraftUsername()).toBe('OldSteve');
    });

    it('sets isLoading to false after load', async () => {
      await service.loadProfile();
      expect(service.isLoading()).toBe(false);
    });

    it('sets isLoaded to true after a successful load', async () => {
      expect(service.isLoaded()).toBe(false);
      await service.loadProfile();
      expect(service.isLoaded()).toBe(true);
    });

    it('does not call Firestore again when loadProfile() is called twice for the same user', async () => {
      await service.loadProfile();
      mockGetDoc.mockClear();
      await service.loadProfile();
      expect(mockGetDoc).not.toHaveBeenCalled();
    });
  });

  describe('linkAccount()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.linkAccount('java', 'Steve');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('creates a new doc when user doc does not exist', async () => {
      // getDoc: user doc not exists; username reverse-lookup: not exists
      mockGetDoc
        .mockResolvedValueOnce(notExistsSnap())   // user doc
        .mockResolvedValueOnce(notExistsSnap());   // username reverse-lookup for removePrevious
      await service.linkAccount('java', 'Steve');
      expect(mockSetDoc).toHaveBeenCalled();
      expect(service.minecraftUsername()).toBe('Steve');
    });

    it('updates existing doc when user doc exists', async () => {
      mockGetDoc
        .mockResolvedValueOnce(existsSnap({ minecraftAccounts: { java: null, bedrock: null, admin: null } }))
        .mockResolvedValueOnce(notExistsSnap());  // username lookup
      await service.linkAccount('java', 'Steve');
      expect(mockUpdateDoc).toHaveBeenCalled();
      expect(service.minecraftUsername()).toBe('Steve');
    });

    it('removes the previous username reverse-lookup when switching accounts', async () => {
      mockGetDoc
        .mockResolvedValueOnce(existsSnap({ minecraftAccounts: { java: 'OldSteve', bedrock: null, admin: null } }))  // user doc
        .mockResolvedValueOnce(existsSnap({ uid: 'user-123' }));  // previous username lookup

      await service.linkAccount('java', 'NewSteve');
      expect(mockDeleteDoc).toHaveBeenCalled();
    });

    it('does not remove reverse-lookup when linking the same username', async () => {
      mockGetDoc
        .mockResolvedValueOnce(existsSnap({ minecraftAccounts: { java: 'Steve', bedrock: null, admin: null } }));
      mockDeleteDoc.mockClear();
      await service.linkAccount('java', 'Steve');
      expect(mockDeleteDoc).not.toHaveBeenCalled();
    });
  });

  describe('unlinkAccount()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.unlinkAccount('java');
      expect(mockSetDoc).not.toHaveBeenCalled();
    });

    it('sets account to null and calls updateDoc when user doc exists', async () => {
      mockGetDoc
        .mockResolvedValueOnce(existsSnap({ minecraftAccounts: { java: 'Steve', bedrock: null, admin: null } }))
        .mockResolvedValueOnce(notExistsSnap());  // username lookup
      await service.unlinkAccount('java');
      expect(mockUpdateDoc).toHaveBeenCalled();
      expect(service.minecraftUsername()).toBeNull();
    });

    it('creates a new doc when user doc does not exist', async () => {
      await service.unlinkAccount('java');
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('deletes reverse-lookup when username belongs to this user', async () => {
      mockGetDoc
        .mockResolvedValueOnce(existsSnap({ minecraftAccounts: { java: 'Steve', bedrock: null, admin: null } }))
        .mockResolvedValueOnce(existsSnap({ uid: 'user-123' }));  // belongs to this user
      await service.unlinkAccount('java');
      expect(mockDeleteDoc).toHaveBeenCalled();
    });

    it('does not delete reverse-lookup when username belongs to another user', async () => {
      mockGetDoc
        .mockResolvedValueOnce(existsSnap({ minecraftAccounts: { java: 'Steve', bedrock: null, admin: null } }))
        .mockResolvedValueOnce(existsSnap({ uid: 'other-user' }));  // belongs to different user
      await service.unlinkAccount('java');
      expect(mockDeleteDoc).not.toHaveBeenCalled();
    });

    it('ignores errors from reverse-lookup deletion', async () => {
      mockGetDoc
        .mockResolvedValueOnce(existsSnap({ minecraftAccounts: { java: 'Steve', bedrock: null, admin: null } }))
        .mockRejectedValueOnce(new Error('permission denied'));  // username lookup fails
      await expect(service.unlinkAccount('java')).resolves.toBeUndefined();
    });
  });

  describe('Location CRUD', () => {
    describe('addLocation()', () => {
      it('does nothing when not authenticated', async () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.addLocation({ name: 'X', mapHash: '#w', description: '', isPublic: false });
      expect(service.savedLocations()).toHaveLength(0);
    });

    it('adds the location to the profile signal', async () => {
      await service.addLocation({ name: 'X', mapHash: '#w', description: '', isPublic: false });
      expect(service.savedLocations()).toHaveLength(1);
      expect(service.savedLocations()[0].name).toBe('X');
    });

    it('persists via setDoc when user doc does not exist', async () => {
      await service.addLocation({ name: 'X', mapHash: '#w', description: '', isPublic: false });
      expect(mockSetDoc).toHaveBeenCalled();
    });

    it('persists via updateDoc when user doc exists', async () => {
      mockGetDoc.mockResolvedValue(existsSnap({}));
      await service.addLocation({ name: 'X', mapHash: '#w', description: '', isPublic: false });
      expect(mockUpdateDoc).toHaveBeenCalled();
    });
  });

  describe('updateLocation()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.updateLocation('loc-1', { name: 'Updated' });
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('updates the matching location', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [makeLocation({ id: 'loc-1' })],
        savedHomes: [],
      });
      await service.updateLocation('loc-1', { name: 'Updated' });
      expect(service.savedLocations()[0].name).toBe('Updated');
    });
  });

  describe('deleteLocation()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.deleteLocation('loc-1');
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('removes the location from the signal', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [makeLocation({ id: 'loc-1' })],
        savedHomes: [],
      });
      await service.deleteLocation('loc-1');
      expect(service.savedLocations()).toHaveLength(0);
    });
  });

  describe('addHome()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.addHome({ name: 'h', x: 0, y: 64, z: 0, world: 'world', isPublic: false });
      expect(service.savedHomes()).toHaveLength(0);
    });

    it('adds the home to the signal', async () => {
      await service.addHome({ name: 'h', x: 0, y: 64, z: 0, world: 'world', isPublic: false });
      expect(service.savedHomes()).toHaveLength(1);
    });
  });

  describe('updateHome()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.updateHome('home-1', { isPublic: true });
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('updates the home in the signal', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [makeHome({ id: 'home-1' })],
      });
      await service.updateHome('home-1', { isPublic: true });
      expect(service.savedHomes()[0].isPublic).toBe(true);
    });
  });

  describe('deleteHome()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.deleteHome('home-1');
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('removes the home from the signal', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [makeHome({ id: 'home-1' })],
      });
      await service.deleteHome('home-1');
      expect(service.savedHomes()).toHaveLength(0);
    });
  });

  describe('deleteHomeByName()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.deleteHomeByName('home');
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('removes home matching the given name', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [makeHome({ id: 'home', name: 'home' })],
      });
      await service.deleteHomeByName('home');
      expect(service.savedHomes()).toHaveLength(0);
    });
  });

  describe('updateAllHomesVisibility()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.updateAllHomesVisibility(true);
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('marks all homes public', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [makeHome({ id: 'h1', name: 'h1' }), makeHome({ id: 'h2', name: 'h2' })],
      });
      await service.updateAllHomesVisibility(true);
      expect(service.savedHomes().every(h => h.isPublic)).toBe(true);
    });
  });

  describe('syncHomesFromServer()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.syncHomesFromServer([{ name: 'h', x: 0, y: 0, z: 0, world: 'world' }]);
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('does nothing when serverHomes is empty', async () => {
      await service.syncHomesFromServer([]);
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('adds new homes not yet in Firestore', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [],
      });
      await service.syncHomesFromServer([{ name: 'newHome', x: 1, y: 64, z: 2, world: 'world' }]);
      expect(service.savedHomes()).toHaveLength(1);
      expect(service.savedHomes()[0].name).toBe('newHome');
    });

    it('updates coordinates of existing homes', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [makeHome({ id: 'home', name: 'home', x: 0, y: 0, z: 0 })],
      });
      await service.syncHomesFromServer([{ name: 'home', x: 99, y: 70, z: -30, world: 'world' }]);
      expect(service.savedHomes()[0].x).toBe(99);
    });

    it('does not persist when no homes have changed', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [makeHome({ id: 'home', name: 'home', x: 10, y: 64, z: -5, world: 'world' })],
      });
      mockUpdateDoc.mockClear();
      await service.syncHomesFromServer([{ name: 'home', x: 10, y: 64, z: -5, world: 'world' }]);
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });
  });

  describe('upsertHomesFromLocal()', () => {
    it('does nothing when not authenticated', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          UserProfileService,
          { provide: AuthService, useValue: makeAuthStub(null) },
        ],
      });
      service = TestBed.inject(UserProfileService);
      await service.upsertHomesFromLocal([{ name: 'h', x: 0, y: 0, z: 0, world: 'w', isPublic: false }]);
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('does nothing when homes array is empty', async () => {
      await service.upsertHomesFromLocal([]);
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });

    it('adds new homes not yet tracked locally', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [],
      });
      await service.upsertHomesFromLocal([{ name: 'fresh', x: 1, y: 64, z: 2, world: 'world', isPublic: true }]);
      expect(service.savedHomes()).toHaveLength(1);
      expect(service.savedHomes()[0].isPublic).toBe(true);
    });

    it('updates existing home coords and visibility', async () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [makeHome({ id: 'home-1', name: 'home', x: 0, y: 0, z: 0, isPublic: false })],
      });
      await service.upsertHomesFromLocal([{ name: 'home', x: 50, y: 70, z: 50, world: 'world', isPublic: true }]);
      expect(service.savedHomes()[0].x).toBe(50);
      expect(service.savedHomes()[0].isPublic).toBe(true);
    });
  });

  describe('_persistHomes via updateHome when doc exists', () => {
    it('calls updateDoc (not setDoc) when the user doc already exists', async () => {
      mockGetDoc.mockResolvedValue(existsSnap({}));
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [makeHome({ id: 'home-1' })],
      });
      await service.updateHome('home-1', { isPublic: true });
      expect(mockUpdateDoc).toHaveBeenCalled();
      expect(mockSetDoc).not.toHaveBeenCalled();
    });
  });

  describe('savedHomes fallback', () => {
    it('savedHomes() returns [] when profile has no savedHomes field', () => {
      service.profile.set({
        minecraftAccounts: { java: null, bedrock: null, admin: null },
        savedLocations: [],
      } as UserProfile);
      expect(service.savedHomes()).toEqual([]);
    });
  });

  }); // end describe('Location CRUD')

  describe('linkAccount() previous username belongs to another user', () => {
    it('does NOT delete reverse-lookup when previous username belongs to a different user', async () => {
      mockGetDoc
        .mockResolvedValueOnce(existsSnap({ minecraftAccounts: { java: 'OldSteve', bedrock: null, admin: null } }))
        .mockResolvedValueOnce(existsSnap({ uid: 'other-user-999' }));
      mockDeleteDoc.mockClear();
      await service.linkAccount('java', 'NewSteve');
      expect(mockDeleteDoc).not.toHaveBeenCalled();
    });
  });

  describe('getPublicHomesStream()', () => {
    it('emits empty array when username doc does not exist', async () => {
      const homes = await firstValueFrom(service.getPublicHomesStream('Unknown'));
      expect(homes).toEqual([]);
    });

    it('emits public homes from Firestore snapshot', async () => {
      const profile: UserProfile = {
        minecraftAccounts: { java: 'Steve', bedrock: null, admin: null },
        savedLocations: [],
        savedHomes: [
          makeHome({ id: 'pub', name: 'pub', isPublic: true }),
          makeHome({ id: 'priv', name: 'priv', isPublic: false }),
        ],
      };

      mockGetDoc.mockResolvedValueOnce(existsSnap({ uid: 'user-123' }));
      mockOnSnapshot.mockImplementationOnce((_ref: unknown, onNext: (snap: unknown) => void) => {
        onNext(existsSnap(profile));
        return () => undefined;
      });

      const homes = await firstValueFrom(service.getPublicHomesStream('Steve'));
      expect(homes).toHaveLength(1);
      expect(homes[0].name).toBe('pub');
    });

    it('emits empty array when user doc does not exist in snapshot', async () => {
      mockGetDoc.mockResolvedValueOnce(existsSnap({ uid: 'user-123' }));
      mockOnSnapshot.mockImplementationOnce((_ref: unknown, onNext: (snap: unknown) => void) => {
        onNext(notExistsSnap());
        return () => undefined;
      });

      const homes = await firstValueFrom(service.getPublicHomesStream('Steve'));
      expect(homes).toEqual([]);
    });

    it('emits empty array on snapshot error', async () => {
      mockGetDoc.mockResolvedValueOnce(existsSnap({ uid: 'user-123' }));
      mockOnSnapshot.mockImplementationOnce(
        (_ref: unknown, _onNext: unknown, onError: () => void) => {
          onError();
          return () => undefined;
        }
      );

      const homes = await firstValueFrom(service.getPublicHomesStream('Steve'));
      expect(homes).toEqual([]);
    });

    it('emits empty array when getDoc rejects', async () => {
      mockGetDoc.mockRejectedValueOnce(new Error('network error'));
      const homes = await firstValueFrom(service.getPublicHomesStream('Steve'));
      expect(homes).toEqual([]);
    });

    it('cancels the Firestore listener on unsubscribe', () => {
      const sub = service.getPublicHomesStream('Steve').subscribe();
      expect(() => sub.unsubscribe()).not.toThrow();
    });
  });

  // ── getPublicLocationsStream ──────────────────────────────────────────────

  describe('getPublicLocationsStream()', () => {
    it('emits empty array when username doc does not exist', async () => {
      const locs = await firstValueFrom(service.getPublicLocationsStream('Unknown'));
      expect(locs).toEqual([]);
    });

    it('emits public locations from snapshot', async () => {
      const profile: UserProfile = {
        minecraftAccounts: { java: 'Steve', bedrock: null, admin: null },
        savedLocations: [
          makeLocation({ id: 'pub', isPublic: true }),
          makeLocation({ id: 'priv', isPublic: false }),
        ],
        savedHomes: [],
      };

      mockGetDoc.mockResolvedValueOnce(existsSnap({ uid: 'user-123' }));
      mockOnSnapshot.mockImplementationOnce((_ref: unknown, onNext: (snap: unknown) => void) => {
        onNext(existsSnap(profile));
        return () => undefined;
      });

      const locs = await firstValueFrom(service.getPublicLocationsStream('Steve'));
      expect(locs).toHaveLength(1);
    });

    it('emits empty array when user snapshot doc does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(existsSnap({ uid: 'user-123' }));
      mockOnSnapshot.mockImplementationOnce((_ref: unknown, onNext: (snap: unknown) => void) => {
        onNext(notExistsSnap());
        return () => undefined;
      });

      const locs = await firstValueFrom(service.getPublicLocationsStream('Steve'));
      expect(locs).toEqual([]);
    });

    it('emits empty array on snapshot error', async () => {
      mockGetDoc.mockResolvedValueOnce(existsSnap({ uid: 'user-123' }));
      mockOnSnapshot.mockImplementationOnce(
        (_ref: unknown, _onNext: unknown, onError: () => void) => {
          onError();
          return () => undefined;
        }
      );
      const locs = await firstValueFrom(service.getPublicLocationsStream('Steve'));
      expect(locs).toEqual([]);
    });

    it('emits empty array when getDoc rejects', async () => {
      mockGetDoc.mockRejectedValueOnce(new Error('network error'));
      const locs = await firstValueFrom(service.getPublicLocationsStream('Steve'));
      expect(locs).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
