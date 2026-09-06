import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AnalyticsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AnalyticsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs the aggregated series for the requested period', async () => {
    const expected = { points: [{ t: 0, avg: 2, peak: 3 }], summary: { peak: 3, avg: 2 } };
    const promise = service.getSeries('week');

    const req = httpMock.expectOne('/api/analytics?period=week');
    expect(req.request.method).toBe('GET');
    req.flush(expected);

    expect(await promise).toEqual(expected);
  });

  it('rejects on a server error so the caller can surface an error state', async () => {
    const promise = service.getSeries('day');
    httpMock
      .expectOne('/api/analytics?period=day')
      .flush('boom', { status: 500, statusText: 'Server Error' });

    await expect(promise).rejects.toBeTruthy();
  });
});
