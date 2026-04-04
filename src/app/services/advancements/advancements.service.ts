import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface Advancement {
  id: string;
  label: string;
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

  getAdvancements(uuid: string): Observable<AdvancementsResult> {
    return this.http.get<AdvancementsResult>(`/api/advancements/${uuid}`).pipe(
      catchError(() => of({ completed: [], total: 0, by_category: {} }))
    );
  }
}
