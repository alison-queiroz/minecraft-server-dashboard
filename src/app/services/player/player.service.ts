import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Player } from './player.model';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly http = inject(HttpClient);

  private readonly rawPlayers = signal<Player[]>([]);
  private readonly houseLinks = signal<Record<string, string>>({});

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

  constructor() {
    this.fetchHouseLinks();
  }

  fetchPlayerData() {
    this.http.get<Player[]>('/api/players').subscribe({
      next: (data: Player[]) => {
        this.rawPlayers.set(data.map(p => new Player(p)));
      },
      error: () => console.warn('Could not reach players data.'),
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
