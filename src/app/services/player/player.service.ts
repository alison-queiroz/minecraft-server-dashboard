import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Player } from './player.model';
import type { EssentialsHome } from './player.model';
import { getApps, initializeApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

interface ApiPlayerLiveData {
  name: string;
  level?: number;
  health?: number;
  dimension?: string;
  pos?: number[];
  last_seen?: string;
  play_hours?: number;
  advancement_count?: number;
  homes?: EssentialsHome[];
}

/** Default player ordering (highest level first), shared by both ingest paths. */
const byLevelDesc = (a: Player, b: Player): number => b.level - a.level;

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly http = inject(HttpClient);

  protected readonly rawPlayers = signal<Player[]>([]);
  private readonly houseLinks = signal<Record<string, string>>({});
  private readonly _avatarCache = signal<ReadonlyMap<string, string>>(new Map());
  /** Ensures the one-time HTTP enrich (for pre-advancement_count docs) fires once. */
  private _enriched = false;

  readonly players = computed(() => {
    const links = this.houseLinks();
    return this.rawPlayers().map((p) => {
      const houseUrl = links[p.name];
      return new Player({
        ...p,
        ...(houseUrl ? { houseUrl } : {}),
      });
    });
  });

  readonly searchTerm = signal<string>('');
  readonly selectedPlayerName = signal<string | null>(null);
  readonly selectedPlayer = computed(() =>
    this.players().find(p => p.name === this.selectedPlayerName()) ?? null
  );

  readonly filteredPlayers = computed(() => {
    // matchesSearch() normalizes case itself, so only trim here.
    const term = this.searchTerm().trim();
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
    this.subscribeToFirestorePlayers();
  }

  protected subscribeToFirestorePlayers(): void {
    try {
      const app = getApps().at(0) ?? initializeApp(environment.firebaseConfig);
      const db = getFirestore(app);
      onSnapshot(
        collection(db, 'players'),
        (snapshot) => {
          if (snapshot.empty) {
            // Firestore has no data yet (quota exceeded or first run) — fall back to HTTP API
            this.fetchPlayersFromApi();
            return;
          }
          const players = snapshot.docs
            .map(d => new Player(d.data() as Partial<Player>))
            .sort(byLevelDesc);
          // onSnapshot only fires on real document changes, so publish the list
          // directly. The previous hand-rolled index-based diff omitted volatile
          // fields (health, pos) and could leave the UI showing stale values.
          this.rawPlayers.set(players);
          // If Firestore docs predate advancement_count, enrich once from the API.
          if (!this._enriched && players.some(p => p.advancement_count === undefined)) {
            this._enriched = true;
            this.enrichFromApi();
          }
        },
        (err) => {
          console.warn('Firestore player listener error:', err);
          this.fetchPlayersFromApi();
        }
      );
    } catch (err) {
      console.warn('Could not initialize Firestore player listener:', err);
      this.fetchPlayersFromApi();
    }
  }

  private fetchPlayersFromApi(): void {
    this.http.get<Partial<Player>[]>('/api/players').pipe(
      catchError(() => of([] as Partial<Player>[])),
      tap(data => {
        if (data.length) {
          this.rawPlayers.set(data.map(p => new Player(p)).sort(byLevelDesc));
        }
      }),
    ).subscribe();
  }

  /** Calls /api/players and merges ALL live fields into the current player list.
   * Live data wins for volatile fields (position, dimension, health, level);
   * Firestore data is kept for non-volatile fields not returned by the API fallback. */
  private enrichFromApi(): void {
    this.http.get<ApiPlayerLiveData[]>('/api/players').pipe(
      catchError(() => of([] as ApiPlayerLiveData[])),
      tap(data => {
        if (!data.length) return;
        const byName = new Map(data.map(p => [p.name, p]));
        this.rawPlayers.update(players => players.map(p => {
          const api = byName.get(p.name);
          if (!api) return p;
          return new Player({
            ...p,
            level:             api.level ?? p.level,
            health:            api.health ?? p.health,
            dimension:         api.dimension ?? p.dimension,
            pos:               api.pos ?? p.pos,
            last_seen:         api.last_seen ?? p.last_seen,
            play_hours:        api.play_hours ?? p.play_hours,
            advancement_count: api.advancement_count ?? p.advancement_count,
            homes:             api.homes ?? p.homes,
          });
        }));
      }),
    ).subscribe();
  }

  /**
   * Fetches a single avatar URL and caches the resulting blob URL.
   * Called lazily by PlayerCardRowComponent when the card enters the viewport.
   * Subsequent calls for the same URL are no-ops (cache hit).
   */
  fetchAvatarIfNeeded(url: string): void {
    if (this._avatarCache().has(url)) return;
    this.http.get(url, { responseType: 'blob' }).pipe(
      catchError(() => of(null)),
      tap(blob => {
        if (blob) {
          this._avatarCache.update(m => new Map([...m, [url, URL.createObjectURL(blob)]]));
        }
      }),
    ).subscribe();
  }

  private fetchHouseLinks() {
    this.http.get<{ baseUrl: string; players: Record<string, string> }>('assets/player-houses-mapping.json').pipe(
      tap(({ baseUrl, players }) => {
        const resolved = Object.fromEntries(
          Object.entries(players).map(([name, path]) => [name, baseUrl + path])
        );
        this.houseLinks.set(resolved);
      }),
      catchError(() => { console.warn('Could not reach house links JSON file.'); return of(null); }),
    ).subscribe();
  }
}
