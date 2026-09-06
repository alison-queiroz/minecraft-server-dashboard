import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { PlayerListComponent } from './player-list.component';
import { PlayerService } from '../../../services/player/player.service';
import { Player } from '../../../services/player/player.model';

// Exercises the pure sorting logic (displayedPlayers/toggleSort) without
// rendering the virtual-scroll viewport (no detectChanges → no ngAfterViewInit).
interface SortInternals {
  displayedPlayers(): Player[];
  toggleSort(field: string): void;
  sortField(): string;
  sortDir(): string;
}

function makePlayer(over: Partial<Player>): Player {
  return new Player({
    name: 'x', uuid: 'x', level: 0, health: 20, dimension: 'Overworld',
    pos: [0, 0, 0], last_seen: '2026-01-01 00:00', skin_url: '',
    play_hours: 0, advancement_count: 0, ...over,
  });
}

describe('PlayerListComponent sorting', () => {
  let cmp: SortInternals;
  const filtered = signal<Player[]>([]);

  beforeEach(() => {
    filtered.set([
      makePlayer({ name: 'Charlie', uuid: 'c', level: 5, play_hours: 3, advancement_count: 10 }),
      makePlayer({ name: 'alice', uuid: 'a', level: 20, play_hours: 1, advancement_count: 50 }),
      makePlayer({ name: 'Bob', uuid: 'b', level: 12, play_hours: 9, advancement_count: 5 }),
    ]);
    TestBed.configureTestingModule({
      imports: [PlayerListComponent],
      providers: [
        {
          provide: PlayerService,
          useValue: {
            filteredPlayers: filtered,
            searchTerm: signal(''),
            fetchAvatarIfNeeded: () => undefined,
            getAvatarUrl: (u: string) => u,
          },
        },
      ],
    });
    cmp = TestBed.createComponent(PlayerListComponent).componentInstance as unknown as SortInternals;
  });

  it('defaults to level descending', () => {
    expect(cmp.displayedPlayers().map(p => p.level)).toEqual([20, 12, 5]);
  });

  it('toggling the active field flips the direction to ascending', () => {
    cmp.toggleSort('level'); // already the active field → flips desc→asc
    expect(cmp.sortDir()).toBe('asc');
    expect(cmp.displayedPlayers().map(p => p.level)).toEqual([5, 12, 20]);
  });

  it('selecting a new field sorts by it, descending', () => {
    cmp.toggleSort('play_hours');
    expect(cmp.sortField()).toBe('play_hours');
    expect(cmp.displayedPlayers().map(p => p.play_hours)).toEqual([9, 3, 1]);
  });

  it('sorts by advancement_count descending', () => {
    cmp.toggleSort('advancement_count');
    expect(cmp.displayedPlayers().map(p => p.advancement_count)).toEqual([50, 10, 5]);
  });
});
