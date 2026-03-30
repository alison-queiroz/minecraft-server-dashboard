import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface BackupFile {
  id: string;
  name: string;
  createdTime: string;
  size: string;
  webContentLink: string;
}

@Injectable({
  providedIn: 'root',
})
export class BackupService {
  constructor(private readonly http: HttpClient) {}

  private readonly backupEndpoint = '/api/backups';

  getBackups() {
    return this.http.get<BackupFile[]>(this.backupEndpoint);
  }
}
