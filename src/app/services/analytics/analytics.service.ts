import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

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

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches the server-side aggregated series for a period. The backend does
   * all bucketing/peak/avg, so the browser only receives a few dozen points.
   * Rejects on transport/server error so the caller can surface an error state.
   */
  getSeries(period: Period): Promise<AnalyticsSeries> {
    return firstValueFrom(
      this.http.get<AnalyticsSeries>(`/api/analytics?period=${period}`)
    );
  }
}
