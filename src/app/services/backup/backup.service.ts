import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import type { Observable } from 'rxjs';

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

  /**
   * Lists a Drive folder (root when `folderId` is null). Errors are propagated
   * so callers can tell a failed request apart from a genuinely empty folder.
   */
  getBackups(folderId: string | null): Observable<BackupFile[]> {
    const params = folderId
      ? new HttpParams().set('folderId', folderId)
      : new HttpParams();

    return this.http.get<BackupFile[]>(this.backupEndpoint, { params });
  }
}
