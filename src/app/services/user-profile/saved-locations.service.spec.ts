import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import type { SavedLocation } from './user-profile.models';
import { SavedLocationsService } from './saved-locations.service';
import { UserProfileService } from './user-profile.service';
import { AuthService } from '../auth/auth.service';
import * as firestoreModule from 'firebase/firestore';

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

let mockSetDoc: ReturnType<typeof vi.fn>;

beforeAll(() => {
  mockSetDoc = firestoreModule.setDoc;
});

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
  service: SavedLocationsService;
  profile: UserProfileService;
  http: HttpTestingController;
}

function configure(uid: string | null = 'user-123'): Configured {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { currentUser: signal(uid ? { uid } : null) } },
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  return {
    service: TestBed.inject(SavedLocationsService),
    profile: TestBed.inject(UserProfileService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('SavedLocationsService (own profile doc)', () => {
  let service: SavedLocationsService;
  let profile: UserProfileService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    mockSetDoc.mockReset();
    mockSetDoc.mockResolvedValue(undefined);
    ({ service, profile, http: httpMock } = configure());
  });

  afterEach(() => httpMock.verify());

  it('does nothing when not authenticated', async () => {
    ({ service, profile, http: httpMock } = configure(null));
    await service.addLocation({ name: 'X', mapHash: '#w', description: '', isPublic: false });
    await service.updateLocation('loc-1', { name: 'Y' });
    await service.deleteLocation('loc-1');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('addLocation persists only savedLocations with a single merge write', async () => {
    await service.addLocation({ name: 'X', mapHash: '#w', description: '', isPublic: true });
    expect(service.savedLocations()[0]?.name).toBe('X');
    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: 'users/user-123' },
      { savedLocations: [expect.objectContaining({ name: 'X', isPublic: true })] },
      { merge: true },
    );
  });

  it('updateLocation changes only the matching entry', async () => {
    profile.profile.set({ minecraftAccounts: ACCOUNTS, savedLocations: [makeLocation(), makeLocation({ id: 'loc-2' })] });
    await service.updateLocation('loc-1', { name: 'Updated' });
    expect(service.savedLocations().map(l => l.name)).toEqual(['Updated', 'My Base']);
  });

  it('deleteLocation removes the entry', async () => {
    profile.profile.set({ minecraftAccounts: ACCOUNTS, savedLocations: [makeLocation()] });
    await service.deleteLocation('loc-1');
    expect(service.savedLocations()).toHaveLength(0);
  });

  it('writes to the profile signal, so UserProfileService.reset() clears the list too', async () => {
    await service.addLocation({ name: 'X', mapHash: '#w', description: '', isPublic: false });
    expect(profile.savedLocations()).toHaveLength(1);

    profile.reset();

    expect(service.savedLocations()).toEqual([]);
  });
});
