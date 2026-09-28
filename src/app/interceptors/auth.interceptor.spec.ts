import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { WritableSignal } from '@angular/core';
import { signal } from '@angular/core';
import type { Mock } from 'vitest';

import { authInterceptor, SKIP_AUTH } from './auth.interceptor';
import { AuthService } from '../services/auth/auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let isLoading: WritableSignal<boolean>;
  let getIdToken: Mock;

  function setup(token: string | null, loading = false): void {
    isLoading = signal(loading);
    getIdToken = jest.fn().mockResolvedValue(token);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            isLoading,
            currentUser: signal(null),
            getIdToken,
          },
        },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  afterEach(() => httpMock.verify());

  it('passes non-API requests through without an Authorization header', () => {
    setup('some-token');

    http.get('https://example.com/public').subscribe();

    const req = httpMock.expectOne('https://example.com/public');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('attaches Authorization: Bearer header to /api/ requests when token is available', async () => {
    setup('my-id-token');

    let req: TestRequest | undefined;
    http.get('/api/status').subscribe(); // Subscribe to trigger the HTTP request

    // Give enough time for the observable chain to process
    // toObservable(isLoading) -> filter -> take -> switchMap(getIdToken) -> switchMap(next)
    await new Promise(resolve => setTimeout(resolve, 10));

    try {
      req = httpMock.expectOne('/api/status');
      expect(req.request.headers.get('Authorization')).toBe('Bearer my-id-token');
      req.flush({});
    } catch (e) {
      // If expectOne fails, just clean up
      httpMock.expectNone('/api/status');
      throw e;
    }
  });

  it('passes /api/ requests through without Authorization when token is null', async () => {
    setup(null);

    let req: TestRequest | undefined;
    http.get('/api/status').subscribe(); // Subscribe to trigger the HTTP request

    await new Promise(resolve => setTimeout(resolve, 10));

    try {
      req = httpMock.expectOne('/api/status');
      expect(req.request.headers.has('Authorization')).toBe(false);
      req.flush({});
    } catch (e) {
      httpMock.expectNone('/api/status');
      throw e;
    }
  });

  it('holds /api/ requests until Firebase has restored the session', async () => {
    setup('late-token', true);

    http.get('/api/players').subscribe();
    await new Promise(resolve => setTimeout(resolve, 10));
    httpMock.expectNone('/api/players');
    expect(getIdToken).not.toHaveBeenCalled();

    isLoading.set(false);
    TestBed.tick();
    await new Promise(resolve => setTimeout(resolve, 10));

    const req = httpMock.expectOne('/api/players');
    expect(req.request.headers.get('Authorization')).toBe('Bearer late-token');
    req.flush([]);
  });

  it('sends SKIP_AUTH requests immediately and anonymously, even while the session is restoring', () => {
    setup('my-id-token', true);

    http.get('/api/status', { context: new HttpContext().set(SKIP_AUTH, true) }).subscribe();

    // Synchronous: the request must not be queued behind the auth restore.
    const req = httpMock.expectOne('/api/status');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(getIdToken).not.toHaveBeenCalled();
    req.flush({});
  });
});
