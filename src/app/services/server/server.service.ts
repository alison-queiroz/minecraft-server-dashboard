import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

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
  private readonly statusUrl = 'https://api.mcsrvstat.us/3/';
  private readonly serverAddress = 'exvegan.duckdns.org';
  private readonly statusCheckInterval = 60 * 1000;

  readonly status = signal<'ONLINE' | 'OFFLINE' | 'LOADING'>('LOADING');
  readonly onlinePlayers = signal<number>(0);
  readonly maxPlayers = signal<number>(0);
  readonly version = signal<string | null>(null);

  constructor() {
    this.fetchStatus();
    setInterval(() => this.fetchStatus(), this.statusCheckInterval);
  }

  fetchStatus() {
    this.http.get<ServerStatusResponse>(`${this.statusUrl}${this.serverAddress}`).subscribe({
      next: (res) => {
        this.status.set(res.online ? 'ONLINE' : 'OFFLINE');
        this.onlinePlayers.set(res.players?.online ?? 0);
        this.maxPlayers.set(res.players?.max ?? 0);
        this.version.set(res.version ?? null);
      },
      error: () => {
        this.status.set('OFFLINE');
        this.onlinePlayers.set(0);
        this.maxPlayers.set(0);
      },
    });
  }
}
