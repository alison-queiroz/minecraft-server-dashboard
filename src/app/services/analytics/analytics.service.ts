import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface Snapshot {
  ts: number;
  count: number;
  online: string[];
}

export type Period = 'day' | 'week' | 'month' | 'year';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  getSnapshots(period: Period): Promise<Snapshot[]> {
    return firstValueFrom(
      this.http.get<Snapshot[]>(`/api/analytics?period=${period}`).pipe(
        catchError(() => of([] as Snapshot[]))
      )
    );
  }
}
