import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LINKED_STATUS_CACHE_KEY } from '../../constants/storage.constants';
import { LinkedAccessService } from './linked-access.service';

const clearLinkedCache = (): void => {
  try {
    localStorage.removeItem(LINKED_STATUS_CACHE_KEY);
  } catch {
    /* ignore */
  }
};

// ---------------------------------------------------------------------------
// fetchLinkedStatus() — route guard's access check (HTTP + optimistic cache)
// ---------------------------------------------------------------------------
describe('LinkedAccessService.fetchLinkedStatus()', () => {
  let service: LinkedAccessService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    clearLinkedCache();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [LinkedAccessService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LinkedAccessService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    clearLinkedCache();
  });

  it('calls /api/profile and caches a positive result', async () => {
    const promise = service.fetchLinkedStatus();
    httpMock.expectOne('/api/profile').flush({ hasLinkedAccount: true });
    await expect(promise).resolves.toBe(true);
    expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBe('1');
  });

  it('does not cache a negative result', async () => {
    const promise = service.fetchLinkedStatus();
    httpMock.expectOne('/api/profile').flush({ hasLinkedAccount: false });
    await expect(promise).resolves.toBe(false);
    expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBeNull();
  });

  it('returns true optimistically from cache while revalidating in the background', async () => {
    localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');
    await expect(service.fetchLinkedStatus()).resolves.toBe(true);
    httpMock.expectOne('/api/profile').flush({ hasLinkedAccount: true });
  });

  it('clears the cache when the background recheck reports no linked account', async () => {
    localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');
    await service.fetchLinkedStatus();
    httpMock.expectOne('/api/profile').flush({ hasLinkedAccount: false });
    await vi.waitFor(() => {
      expect(localStorage.getItem(LINKED_STATUS_CACHE_KEY)).toBeNull();
    });
  });

  it('fails closed (returns false) on an API error', async () => {
    const promise = service.fetchLinkedStatus();
    httpMock.expectOne('/api/profile').error(new ProgressEvent('error'));
    await expect(promise).resolves.toBe(false);
  });
});
