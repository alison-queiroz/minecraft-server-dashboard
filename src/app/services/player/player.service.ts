import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Player } from './player.model';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private http = inject(HttpClient);

  private rawPlayers = signal<Player[]>([]);
  private houseLinks = signal<Record<string, string>>({});

  players = computed(() => {
    const links = this.houseLinks();
    return this.rawPlayers().map(p => new Player({ ...p, houseUrl: links[p.name] || undefined }));
  });

  searchTerm = signal<string>('');
  selectedPlayerName = signal<string | null>(null);
  selectedPlayer = computed(() =>
    this.players().find(p => p.name === this.selectedPlayerName()) ?? null
  );

  filteredPlayers = computed(() => {
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

  fetchHouseLinks() {
    this.http.get<Record<string, string>>('assets/player-houses-mapping.json').subscribe({
      next: (data) => this.houseLinks.set(data),
      error: () => console.warn('Could not reach house links JSON file.'),
    });
  }
}
