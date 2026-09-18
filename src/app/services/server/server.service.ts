import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { SKIP_LOADING } from '../../interceptors/loading.interceptor';

const SILENT = { context: new HttpContext().set(SKIP_LOADING, true) };

export const SERVER_STATUS = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  LOADING: 'LOADING',
} as const;

export type ServerStatus = (typeof SERVER_STATUS)[keyof typeof SERVER_STATUS];

interface ServerStatusResponse {
  online: boolean;
  version?: string;
  players?: { online: number; max: number; bedrock?: number };
  motd?: { clean: string[] };
  software?: string;
  icon?: string;
  hostname?: string;
  ip?: string;
  port?: number;
  protocol?: { version: number; name: string };
}

@Injectable({ providedIn: 'root' })
export class ServerService {
  private readonly http = inject(HttpClient);
  private readonly statusUrl = environment.statusApiUrl;
  private readonly bedrockStatusUrl = environment.bedrockStatusApiUrl;
  private readonly serverIP = environment.serverIP;

  // Java
  readonly status = signal<ServerStatus>(SERVER_STATUS.LOADING);
  readonly onlinePlayers = signal<number>(0);
  readonly maxPlayers = signal<number>(0);
  readonly version = signal<string | null>(null);
  readonly motd = signal<string[]>([]);
  readonly software = signal<string | null>(null);
  readonly hostname = signal<string | null>(null);
  readonly ip = signal<string | null>(null);
  readonly port = signal<number | null>(null);
  readonly protocol = signal<{ version: number; name: string } | null>(null);

  // Bedrock
  readonly bedrockStatus = signal<ServerStatus>(SERVER_STATUS.LOADING);
  /** Online players connected via Bedrock (from the server-log transport split);
   *  null when the backend can't determine it. */
  readonly bedrockOnlinePlayers = signal<number | null>(null);
  readonly bedrockVersion = signal<string | null>(null);
  readonly bedrockPort = signal<number | null>(null);

  constructor() {
    // Fetched once on load — the counts refresh when the user reloads the page
    // (no interval polling, no websocket).
    this.fetchStatus();
    this.fetchBedrockStatus();
  }

  private fetchStatus() {
    this.http.get<ServerStatusResponse>(this.statusUrl, SILENT).pipe(
      tap(res => this.applyJavaStatus(res)),
      catchError(() => {
        this.setJavaOffline();
        return of(null);
      }),
    ).subscribe();
  }

  private fetchBedrockStatus() {
    this.http.get<ServerStatusResponse>(this.bedrockStatusUrl, SILENT).pipe(
      tap(res => {
        // We can only report whether the Bedrock/Geyser listener is up, not a
        // Bedrock-specific player count: Geyser's ping mirrors the Java total
        // (a Java-only player still reads 1) and the Java SLP sample is null, so
        // neither source can separate Java-native from Bedrock players.
        this.bedrockStatus.set(res.online ? SERVER_STATUS.ONLINE : SERVER_STATUS.OFFLINE);
        this.bedrockVersion.set(res.version ?? null);
        this.bedrockPort.set(res.port ?? null);
      }),
      catchError(() => {
        this.bedrockStatus.set(SERVER_STATUS.OFFLINE);
        return of(null);
      }),
    ).subscribe();
  }

  private applyJavaStatus(res: ServerStatusResponse): void {
    this.applyJavaOnlineState(res);
    this.applyJavaPlayerState(res);
    this.applyJavaMetadataState(res);
  }

  private setJavaOffline(): void {
    this.status.set(SERVER_STATUS.OFFLINE);
    this.onlinePlayers.set(0);
    this.maxPlayers.set(0);
    this.bedrockOnlinePlayers.set(null);
  }

  private applyJavaOnlineState(res: ServerStatusResponse): void {
    this.status.set(res.online ? SERVER_STATUS.ONLINE : SERVER_STATUS.OFFLINE);
  }

  private applyJavaPlayerState(res: ServerStatusResponse): void {
    this.onlinePlayers.set(res.players?.online ?? 0);
    this.maxPlayers.set(res.players?.max ?? 0);
    this.bedrockOnlinePlayers.set(res.players?.bedrock ?? null);
  }

  private applyJavaMetadataState(res: ServerStatusResponse): void {
    this.version.set(res.version ?? null);
    this.motd.set(res.motd?.clean ?? []);
    this.software.set(res.software ?? null);
    this.hostname.set(res.hostname ?? null);
    this.ip.set(res.ip ?? null);
    this.port.set(res.port ?? null);
    this.protocol.set(res.protocol ?? null);
  }

}
