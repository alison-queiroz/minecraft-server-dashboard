import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import type { AccountHomes } from './user-profile.models';
import { EMPTY_PUBLIC_PROFILE, ProfileHomesService } from './profile-homes.service';
import * as firestoreModule from 'firebase/firestore';

// Mocked only to prove the public profile never touches client Firestore.
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn().mockReturnValue({}),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
}));

let mockGetDoc: ReturnType<typeof vi.fn>;

beforeAll(() => {
  mockGetDoc = firestoreModule.getDoc;
});

describe('ProfileHomesService', () => {
  let service: ProfileHomesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    mockGetDoc.mockReset();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ProfileHomesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProfileHomesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('homes API', () => {
    it('loadOwnHomes returns the grouped accounts from /api/profile/homes', async () => {
      const accounts: AccountHomes[] = [{
        type: 'java', name: 'Steve', uuid: 'u-1',
        homes: [{ name: 'home', world: 'world', x: 1, y: 2, z: 3, isPublic: true }],
      }];
      const promise = service.loadOwnHomes();
      httpMock.expectOne('/api/profile/homes').flush({ accounts });
      await expect(promise).resolves.toEqual(accounts);
    });

    it('setHomesVisibility PUTs the batched changes', async () => {
      const changes = [{ uuid: 'u-1', name: 'home', isPublic: true }];
      const promise = service.setHomesVisibility(changes);
      const req = httpMock.expectOne('/api/profile/homes/visibility');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ homes: changes });
      req.flush({ ok: true });
      await promise;
    });

    it('createHome POSTs to the player homes endpoint', async () => {
      const home = { name: 'base', world: 'world', x: 1, y: 2, z: 3 };
      const promise = service.createHome('u-1', home);
      const req = httpMock.expectOne('/api/players/u-1/homes');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(home);
      req.flush({ ok: true });
      await promise;
    });

    it('deleteHome DELETEs the URL-encoded home name', async () => {
      const promise = service.deleteHome('u-1', 'my home/1');
      const req = httpMock.expectOne('/api/players/u-1/homes/my%20home%2F1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ ok: true });
      await promise;
    });

    it('propagates homes API errors', async () => {
      const promise = service.loadOwnHomes();
      httpMock.expectOne('/api/profile/homes').flush({}, { status: 503, statusText: 'Unavailable' });
      await expect(promise).rejects.toBeTruthy();
    });
  });

  describe('getPublicProfile()', () => {
    it('reads the server-filtered public profile for a player uuid', async () => {
      const profile = {
        locations: [{ id: 'l1', name: 'Spawn', mapHash: '#world:0:64:0', description: '' }],
        homes: [{ name: 'base', world: 'world', x: 1, y: 2, z: 3 }],
      };
      const promise = firstValueFrom(service.getPublicProfile('u-1'));
      httpMock.expectOne('/api/players/u-1/public-profile').flush(profile);
      await expect(promise).resolves.toEqual(profile);
      expect(mockGetDoc).not.toHaveBeenCalled();
    });

    it('falls back to an empty profile on error', async () => {
      const promise = firstValueFrom(service.getPublicProfile('u-1'));
      httpMock.expectOne('/api/players/u-1/public-profile').flush({}, { status: 503, statusText: 'Unavailable' });
      await expect(promise).resolves.toEqual(EMPTY_PUBLIC_PROFILE);
    });
  });
});
