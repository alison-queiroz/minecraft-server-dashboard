import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable} from 'rxjs';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

export interface Advancement {
  id: string;
  label: string;
  description?: string;  // populated lazily on hover
  category: string;
}

export interface AdvancementsResult {
  completed: Advancement[];
  total: number;
  by_category: Record<string, string[]>;
}

@Injectable({ providedIn: 'root' })
export class AdvancementsService {
  private readonly http = inject(HttpClient);
  private readonly descCache = new Map<string, string>();

  getAdvancements(uuid: string): Observable<AdvancementsResult> {
    return this.http.get<AdvancementsResult>(`/api/advancements/${uuid}`).pipe(
      catchError(() => of({ completed: [], total: 0, by_category: {} }))
    );
  }

  /** Fetches a description for one advancement id. Cached after the first call. */
  getDescription(advId: string): Observable<string> {
    if (this.descCache.has(advId)) {
      return of(this.descCache.get(advId)!);
    }
    return this.http
      .get<{ description: string }>(`/api/advancements/description`, { params: { id: advId } })
      .pipe(
        map(r => {
          this.descCache.set(advId, r.description);
          return r.description;
        }),
        catchError(() => of(''))
      );
  }
}
