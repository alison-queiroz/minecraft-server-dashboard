import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface BackupFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly createdTime: string;
  readonly size?: string;
  readonly webContentLink?: string;
}

@Injectable({
  providedIn: 'root',
})
export class BackupService {
  private readonly http = inject(HttpClient);
  private readonly backupEndpoint = '/api/backups';

  getBackups(folderId: string | null): Observable<BackupFile[]> {
    const params = folderId
      ? new HttpParams().set('folderId', folderId)
      : new HttpParams();

    return this.http.get<BackupFile[]>(this.backupEndpoint, { params }).pipe(
      catchError((err) => {
        console.error('Failed to fetch backups from server', err);
        return of([]);
      }),
    );
  }
}
