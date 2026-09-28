import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import type { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AnalyticsService } from './analytics.service';
import { SKIP_LOADING } from '../../interceptors/loading.interceptor';

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
    const promise = firstValueFrom(service.getSeries('week'));

    const req = httpMock.expectOne('/api/analytics?period=week');
    expect(req.request.method).toBe('GET');
    req.flush(expected);

    expect(await promise).toEqual(expected);
  });

  it('errors on a server error so the caller can surface an error state', async () => {
    const promise = firstValueFrom(service.getSeries('day'));
    httpMock
      .expectOne('/api/analytics?period=day')
      .flush('boom', { status: 500, statusText: 'Server Error' });

    await expect(promise).rejects.toMatchObject({ status: 500 } satisfies Partial<HttpErrorResponse>);
  });

  it('counts foreground loads in the global loading bar', () => {
    service.getSeries('week').subscribe();

    const req = httpMock.expectOne('/api/analytics?period=week');
    expect(req.request.context.get(SKIP_LOADING)).toBe(false);
    req.flush({ points: [], summary: { peak: 0, avg: 0 } });
  });

  it('marks background refreshes SKIP_LOADING so the loading bar does not flash', () => {
    service.getSeries('day', { background: true }).subscribe();

    const req = httpMock.expectOne('/api/analytics?period=day');
    expect(req.request.context.get(SKIP_LOADING)).toBe(true);
    req.flush({ points: [], summary: { peak: 0, avg: 0 } });
  });

  it('cancels the request when the caller unsubscribes', () => {
    const sub = service.getSeries('month').subscribe();
    const req = httpMock.expectOne('/api/analytics?period=month');

    sub.unsubscribe();

    expect(req.cancelled).toBe(true);
  });
});
