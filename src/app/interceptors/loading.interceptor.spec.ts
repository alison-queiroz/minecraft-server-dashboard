import { TestBed, fakeAsync } from '@angular/core/testing';
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

  it('sets loading while a tracked request is in flight', fakeAsync(() => {
    http.get('/api/analytics').subscribe();

    expect(loading.isLoading()).toBeTrue();

    const req = httpMock.expectOne('/api/analytics');
    req.flush({ ok: true });

    expect(loading.isLoading()).toBeFalse();
  }));

  it('clears loading after an error response', fakeAsync(() => {
    http.get('/api/analytics').subscribe({ error: () => undefined });

    expect(loading.isLoading()).toBeTrue();

    const req = httpMock.expectOne('/api/analytics');
    req.flush('boom', { status: 500, statusText: 'Server Error' });

    expect(loading.isLoading()).toBeFalse();
  }));

  it('ignores requests explicitly marked with SKIP_LOADING', fakeAsync(() => {
    http.get('/api/status', {
      context: new HttpContext().set(SKIP_LOADING, true),
    }).subscribe();

    expect(loading.isLoading()).toBeFalse();

    const req = httpMock.expectOne('/api/status');
    req.flush({ ok: true });

    expect(loading.isLoading()).toBeFalse();
  }));
});
