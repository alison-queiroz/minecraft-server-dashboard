import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Player } from './player.model';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly http = inject(HttpClient);

  private readonly rawPlayers = signal<Player[]>([]);
  private readonly houseLinks = signal<Record<string, string>>({});
  private readonly _avatarCache = signal<ReadonlyMap<string, string>>(new Map());

  readonly players = computed(() => {
    const links = this.houseLinks();
    return this.rawPlayers().map(p => new Player({ ...p, houseUrl: links[p.name] || undefined }));
  });

  readonly searchTerm = signal<string>('');
  readonly selectedPlayerName = signal<string | null>(null);
  readonly selectedPlayer = computed(() =>
    this.players().find(p => p.name === this.selectedPlayerName()) ?? null
  );

  readonly filteredPlayers = computed(() => {
    const term = this.searchTerm().toLowerCase().trim();
    const all = this.players();

    if (!term) return all;

    return all.filter(p => p.matchesSearch(term));
  });

  /** Returns a cached blob URL for mc-heads.net avatars, or the original URL as fallback. */
  getAvatarUrl(url: string): string {
    return this._avatarCache().get(url) ?? url;
  }

  constructor() {
    this.fetchHouseLinks();
  }

  fetchPlayerData() {
    this.http.get<Player[]>('/api/players').subscribe({
      next: (data: Player[]) => {
        const players = data.map(p => new Player(p));
        this.rawPlayers.set(players);
        this.prefetchAvatars(players);
      },
      error: () => console.warn('Could not reach players data.'),
    });
  }

  private prefetchAvatars(players: Player[]): void {
    const currentCache = this._avatarCache();
    const urls = players
      .filter(p => !p.isRawAvatar())
      .map(p => p.avatarUrl(64))
      .filter(url => !currentCache.has(url));

    if (!urls.length) return;

    const fetches = urls.map(url =>
      this.http.get(url, { responseType: 'blob' }).pipe(
        map(blob => [url, URL.createObjectURL(blob)] as [string, string]),
        catchError(() => of(null))
      )
    );

    forkJoin(fetches).subscribe(results => {
      const pairs = results.filter((r): r is [string, string] => r !== null);
      if (pairs.length) {
        this._avatarCache.update(m => new Map([...m, ...pairs]));
      }
    });
  }

  private fetchHouseLinks() {
    this.http.get<{ baseUrl: string; players: Record<string, string> }>('assets/player-houses-mapping.json').subscribe({
      next: ({ baseUrl, players }) => {
        const resolved = Object.fromEntries(
          Object.entries(players).map(([name, path]) => [name, baseUrl + path])
        );
        this.houseLinks.set(resolved);
      },
      error: () => console.warn('Could not reach house links JSON file.'),
    });
  }
}
