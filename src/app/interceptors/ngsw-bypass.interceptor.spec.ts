import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ngswBypassInterceptor } from './ngsw-bypass.interceptor';

describe('ngswBypassInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([ngswBypassInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('adds the ngsw-bypass header to /api/ requests', () => {
    http.get('/api/status').subscribe();
    const req = httpMock.expectOne('/api/status');
    expect(req.request.headers.get('ngsw-bypass')).toBe('true');
    req.flush({});
  });

  it('leaves non-/api/ requests untouched', () => {
    http.get('/assets/player-houses-mapping.json').subscribe();
    const req = httpMock.expectOne('/assets/player-houses-mapping.json');
    expect(req.request.headers.has('ngsw-bypass')).toBe(false);
    req.flush({});
  });
});
