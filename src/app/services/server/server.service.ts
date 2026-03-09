import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export const SERVER_STATUS = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  LOADING: 'LOADING',
} as const;

export type ServerStatus = (typeof SERVER_STATUS)[keyof typeof SERVER_STATUS];

interface ServerStatusResponse {
  online: boolean;
  version?: string;
  players?: { online: number; max: number };
  motd?: { clean: string[] };
  software?: string;
}

@Injectable({ providedIn: 'root' })
export class ServerService {
  private readonly http = inject(HttpClient);
  private readonly statusUrl = environment.statusApiUrl;
  private readonly serverAddress = environment.serverAddress;
  private readonly statusCheckInterval = environment.statusRefreshInterval;

  readonly status = signal<ServerStatus>(SERVER_STATUS.LOADING);
  readonly onlinePlayers = signal<number>(0);
  readonly maxPlayers = signal<number>(0);
  readonly version = signal<string | null>(null);

  constructor() {
    this.fetchStatus();
    setInterval(() => this.fetchStatus(), this.statusCheckInterval);
  }

  private fetchStatus() {
    this.http.get<ServerStatusResponse>(`${this.statusUrl}${this.serverAddress}`).subscribe({
      next: (res) => {
        this.status.set(res.online ? SERVER_STATUS.ONLINE : SERVER_STATUS.OFFLINE);
        this.onlinePlayers.set(res.players?.online ?? 0);
        this.maxPlayers.set(res.players?.max ?? 0);
        this.version.set(res.version ?? null);
      },
      error: () => {
        this.status.set(SERVER_STATUS.OFFLINE);
        this.onlinePlayers.set(0);
        this.maxPlayers.set(0);
      },
    });
  }
}
