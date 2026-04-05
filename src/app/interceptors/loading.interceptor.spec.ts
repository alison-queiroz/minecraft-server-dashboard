import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LoadingService } from '../services/loading/loading.service';
import { loadingInterceptor, SKIP_LOADING } from './loading.interceptor';

describe('loadingInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let loading: LoadingService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([loadingInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    loading = TestBed.inject(LoadingService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('sets loading while a tracked request is in flight', () => {
    http.get('/api/analytics').subscribe();

    expect(loading.isLoading()).toBe(true);

    const req = httpMock.expectOne('/api/analytics');
    req.flush({ ok: true });

    expect(loading.isLoading()).toBe(false);
  });

  it('clears loading after an error response', () => {
    http.get('/api/analytics').subscribe({ error: () => undefined });

    expect(loading.isLoading()).toBe(true);

    const req = httpMock.expectOne('/api/analytics');
    req.flush('boom', { status: 500, statusText: 'Server Error' });

    expect(loading.isLoading()).toBe(false);
  });

  it('ignores requests explicitly marked with SKIP_LOADING', () => {
    http.get('/api/status', {
      context: new HttpContext().set(SKIP_LOADING, true),
    }).subscribe();

    expect(loading.isLoading()).toBe(false);

    const req = httpMock.expectOne('/api/status');
    req.flush({ ok: true });

    expect(loading.isLoading()).toBe(false);
  });
});



