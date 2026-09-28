import { Injectable, signal, computed, inject } from '@angular/core';
import type { DestroyRef } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, defer, of } from 'rxjs';
import { catchError, finalize, share, switchMap, tap } from 'rxjs/operators';
import type * as FirestoreSdk from 'firebase/firestore';
import { Player } from './player.model';
import type { PlayerDto } from './player.model';
import { getApps, initializeApp } from 'firebase/app';
import { environment } from '../../../environments/environment';
import { LoadingService } from '../loading/loading.service';
import { pageVisible$ } from '../../utils/page-visibility.util';

/** Default player ordering (highest level first), shared by both ingest paths. */
const byLevelDesc = (a: Player, b: Player): number => b.level - a.level;

/** Signal equality for player lists: same length and the same instances in order. */
const sameInstances = (a: readonly Player[], b: readonly Player[]): boolean =>
  a.length === b.length && a.every((p, i) => p === b[i]);

/**
 * Structural sharing keyed by uuid: an incoming player whose data did not
 * change reuses the previous instance, so `track`, `computed` and `switchMap`
 * consumers downstream only react to players that actually changed.
 */
function reuseUnchanged(previous: readonly Player[], next: readonly Player[]): Player[] {
  const byUuid = new Map(previous.map(p => [p.uuid, p]));
  return next.map(p => {
    const prev = byUuid.get(p.uuid);
    return prev?.sameDataAs(p) ? prev : p;
  });
}

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly http = inject(HttpClient);
  private readonly loadingService = inject(LoadingService);
  private readonly document = inject(DOCUMENT);

  protected readonly rawPlayers = signal<Player[]>([], { equal: sameInstances });
  private readonly houseLinks = signal<Record<string, string>>({});
  /** Raw player -> its house-link decorated copy, so decoration keeps identity too. */
  private readonly withHouse = new WeakMap<Player, Player>();
  /** Ensures the one-time HTTP enrich (for pre-advancement_count docs) fires once. */
  private _enriched = false;

  readonly players = computed(
    () => {
      const links = this.houseLinks();
      return this.rawPlayers().map(p => this.decorateWithHouse(p, links[p.name]));
    },
    { equal: sameInstances },
  );

  /** True until the first player data (Firestore snapshot or HTTP fallback) arrives. */
  readonly loading = signal(true);

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

  /** Guards the initial-load handoff so the global loading counter is balanced. */
  private _initialLoadDone = false;

  /**
   * Firestore's real-time roster, shared by every live consumer: the listener
   * opens with the first subscriber, closes when the last one leaves
   * (ref-counted `share()`), and is detached while the tab is hidden.
   */
  private readonly liveRoster$ = pageVisible$(this.document).pipe(
    switchMap(visible => (visible ? this.firestorePlayerSnapshots() : EMPTY)),
    tap(snapshot => this.ingestSnapshot(snapshot)),
    share(),
  );

  constructor() {
    // Feed the initial player load into the global loading bar (Firestore's
    // stream bypasses the HTTP interceptor, so it wouldn't show otherwise).
    this.loadingService.start();
    this.fetchHouseLinks();
    this.loadInitialPlayers();
  }

  /**
   * Cheap default roster source (HTTP snapshot), used by every route — the home
   * only needs the count, so it must not pay for the Firestore SDK. Real-time is
   * opt-in per route via {@link enableLiveUpdates}. Overridable seam for tests.
   */
  protected loadInitialPlayers(): void {
    this.fetchPlayersFromApi();
  }

  /** Ends the initial load exactly once (drops the global bar + local flag). */
  private finishInitialLoad(): void {
    if (this._initialLoadDone) return;
    this._initialLoadDone = true;
    this.loading.set(false);
    this.loadingService.done();
  }

  /**
   * Upgrades the roster to Firestore's real-time stream for as long as the
   * caller lives, lazy-loading the heavy (~166 kB gzip) Firestore SDK on
   * demand. Call only from routes that show the live player list (e.g.
   * /players) so lighter routes (the home, which only needs the count) never
   * download the SDK. Safe to call from several consumers: they share one
   * listener, which closes once every caller's `destroyRef` has fired.
   */
  enableLiveUpdates(destroyRef: DestroyRef): void {
    this.liveRoster$.pipe(takeUntilDestroyed(destroyRef)).subscribe();
  }

  /** Lazy-loads the Firestore SDK (kept out of the initial bundle). */
  private loadFirestoreSdk(): Promise<typeof FirestoreSdk> {
    return import('firebase/firestore');
  }

  /**
   * One `players` collection listener per subscription; unsubscribing detaches
   * it. Unsubscribing before the SDK has loaded never attaches it at all.
   */
  private firestorePlayerSnapshots(): Observable<FirestoreSdk.QuerySnapshot> {
    return defer(() => this.loadFirestoreSdk()).pipe(
      switchMap(({ getFirestore, collection, onSnapshot }) => new Observable<FirestoreSdk.QuerySnapshot>(subscriber => {
        const app = getApps().at(0) ?? initializeApp(environment.firebaseConfig);
        return onSnapshot(
          collection(getFirestore(app), 'players'),
          snapshot => subscriber.next(snapshot),
          err => {
            console.warn('Firestore player listener error:', err);
            this.fetchPlayersFromApi();
            subscriber.complete();
          },
        );
      })),
      catchError((err: Error) => {
        console.warn('Could not initialize Firestore player listener:', err);
        this.fetchPlayersFromApi();
        return EMPTY;
      }),
    );
  }

  private ingestSnapshot(snapshot: FirestoreSdk.QuerySnapshot): void {
    if (snapshot.empty) {
      // Firestore has no data yet (quota exceeded or first run) — fall back to HTTP API
      this.fetchPlayersFromApi();
      return;
    }
    const players = snapshot.docs
      .map(d => new Player(d.data() as PlayerDto))
      .sort(byLevelDesc);
    this.publish(players);
    this.finishInitialLoad();
    // If Firestore docs predate advancement_count, enrich once from the API.
    if (!this._enriched && players.some(p => p.advancement_count === undefined)) {
      this._enriched = true;
      this.enrichFromApi();
    }
  }

  /** Publishes a fresh roster, keeping the previous instance of every unchanged player. */
  private publish(players: readonly Player[]): void {
    this.rawPlayers.update(previous => reuseUnchanged(previous, players));
  }

  private decorateWithHouse(player: Player, houseUrl: string | undefined): Player {
    if (!houseUrl || player.houseUrl === houseUrl) return player;
    const cached = this.withHouse.get(player);
    if (cached?.houseUrl === houseUrl) return cached;
    const decorated = new Player({ ...player, houseUrl });
    this.withHouse.set(player, decorated);
    return decorated;
  }

  private fetchPlayersFromApi(): void {
    this.http.get<PlayerDto[]>('/api/players').pipe(
      catchError(() => of([] as PlayerDto[])),
      tap(data => {
        if (data.length) {
          this.publish(data.map(p => new Player(p)).sort(byLevelDesc));
        }
      }),
      finalize(() => this.finishInitialLoad()),
    ).subscribe();
  }

  /** Calls /api/players and merges ALL live fields into the current player list.
   * Live data wins for volatile fields (position, dimension, health, level);
   * Firestore data is kept for non-volatile fields not returned by the API fallback. */
  private enrichFromApi(): void {
    this.http.get<PlayerDto[]>('/api/players').pipe(
      catchError(() => of([] as PlayerDto[])),
      tap(data => {
        if (!data.length) return;
        const byName = new Map(data.map(row => [row.name ?? '', row]));
        this.publish(this.rawPlayers().map(p => {
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
