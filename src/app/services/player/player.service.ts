import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Player } from './player.model';
import { getApps, initializeApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly http = inject(HttpClient);

  protected readonly rawPlayers = signal<Player[]>([]);
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
    this.subscribeToFirestorePlayers();
  }

  protected subscribeToFirestorePlayers(): void {
    try {
      const app = getApps().length ? getApps()[0] : initializeApp(environment.firebaseConfig);
      const db = getFirestore(app);
      onSnapshot(
        collection(db, 'players'),
        (snapshot) => {
          if (snapshot.empty) return;
          const players = snapshot.docs
            .map(d => new Player(d.data() as Partial<Player>))
            .sort((a, b) => b.level - a.level);
          this.rawPlayers.set(players);
        },
        (err) => console.warn('Firestore player listener error:', err)
      );
    } catch (err) {
      console.warn('Could not initialize Firestore player listener:', err);
    }
  }

  /**
   * Fetches a single avatar URL and caches the resulting blob URL.
   * Called lazily by PlayerCardRowComponent when the card enters the viewport.
   * Subsequent calls for the same URL are no-ops (cache hit).
   */
  fetchAvatarIfNeeded(url: string): void {
    if (this._avatarCache().has(url)) return;
    this.http.get(url, { responseType: 'blob' }).pipe(
      catchError(() => of(null))
    ).subscribe(blob => {
      if (blob) {
        this._avatarCache.update(m => new Map([...m, [url, URL.createObjectURL(blob)]]));
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
