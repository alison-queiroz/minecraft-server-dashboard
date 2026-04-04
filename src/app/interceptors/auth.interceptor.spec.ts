import { TestBed, fakeAsync, flush } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth/auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  function setup(token: string | null) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            isLoading: signal(false),
            currentUser: signal(null),
            getIdToken: jasmine.createSpy('getIdToken').and.resolveTo(token),
          },
        },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  afterEach(() => httpMock.verify());

  it('passes non-API requests through without an Authorization header', fakeAsync(() => {
    setup('some-token');

    http.get('https://example.com/public').subscribe();
    // Non-/api/ requests skip the interceptor pipeline entirely — no flush needed.

    const req = httpMock.expectOne('https://example.com/public');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  }));

  it('attaches Authorization: Bearer header to /api/ requests when token is available', fakeAsync(() => {
    setup('my-id-token');

    http.get('/api/status').subscribe();
    // flush() drains the toObservable effect (microtask) + getIdToken() Promise (microtask).
    flush();

    const req = httpMock.expectOne('/api/status');
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-id-token');
    req.flush({});
  }));

  it('passes /api/ requests through without Authorization when token is null', fakeAsync(() => {
    setup(null);

    http.get('/api/status').subscribe();
    flush();

    const req = httpMock.expectOne('/api/status');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  }));
});
