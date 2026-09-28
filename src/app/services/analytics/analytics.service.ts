import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { SKIP_LOADING } from '../../interceptors/loading.interceptor';

export type Period = 'day' | 'week' | 'month' | 'year';

/** A pre-aggregated point from the backend: bucket start (unix seconds) + stats. */
export interface AnalyticsPoint {
  /** Bucket start time, unix seconds. */
  t: number;
  /** Average online count within the bucket. */
  avg: number;
  /** Peak online count within the bucket. */
  peak: number;
}

export interface AnalyticsSeries {
  points: AnalyticsPoint[];
  summary: { peak: number; avg: number };
}

export interface SeriesRequestOptions {
  /** Silent auto-refresh: keeps the request out of the global loading bar. */
  background?: boolean;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches the server-side aggregated series for a period. The backend does
   * all bucketing/peak/avg, so the browser only receives a few dozen points.
   * Errors on transport/server failure so the caller can surface an error
   * state; unsubscribing cancels the request (lets callers switchMap).
   */
  getSeries(period: Period, options: SeriesRequestOptions = {}): Observable<AnalyticsSeries> {
    return this.http.get<AnalyticsSeries>(`/api/analytics?period=${period}`, {
      context: new HttpContext().set(SKIP_LOADING, options.background ?? false),
    });
  }
}
