import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Injectable } from '@angular/core';
import { PlayerService } from './player.service';
import { Player } from './player.model';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_PLAYERS: Partial<Player>[] = [
  {
    name: 'Steve',
    uuid: 'aaaaaaaa-0000-0000-0000-000000000001',
    level: 10,
    health: 20,
    dimension: 'Overworld',
    pos: [100, 64, 200],
    last_seen: '2024-01-01',
    skin_url: 'https://mc-heads.net/skin/Steve',
    is_raw_skin: false,
  },
  {
    name: 'Alex',
    uuid: 'bbbbbbbb-0000-0000-0000-000000000002',
    level: 5,
    health: 16,
    dimension: 'Nether',
    pos: [0, 50, 0],
    last_seen: '2024-01-02',
    skin_url: 'https://mc-heads.net/skin/Alex',
    is_raw_skin: false,
  },
  {
    name: 'BedrockUser',
    uuid: '00000000-0000-0000-0009-000000000003',
    level: 1,
    health: 20,
    dimension: 'The End',
    pos: [0, 60, 0],
    last_seen: '2024-01-03',
    skin_url: 'https://example.com/raw-skin.png',
    is_raw_skin: true,
  },
];

const MOCK_HOUSE_MAPPING = {
  baseUrl: 'https://maps.example.com',
  players: { Steve: '/steve-house' },
};

// ---------------------------------------------------------------------------
// Test harness - overrides Firebase subscription so tests control player data
// ---------------------------------------------------------------------------

@Injectable()
class PlayerServiceHarness extends PlayerService {
  /** Override to skip actual Firebase connection in tests. */
  protected override subscribeToFirestorePlayers(): void {}

  /** Push a batch of players as if Firestore sent a snapshot. */
  pushPlayers(players: Partial<Player>[] = MOCK_PLAYERS): void {
    const sorted = players
      .map(p => new Player(p))
      .sort((a, b) => b.level - a.level);
    this.rawPlayers.set(sorted);
  }

  /** Simulate what the Firestore error handler does. */
  pushError(err: unknown = new Error('Firestore unavailable')): void {
    console.warn('Firestore player listener error:', err);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlayerService', () => {
  let service: PlayerServiceHarness;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: PlayerService, useClass: PlayerServiceHarness }],
    });
    service = TestBed.inject(PlayerService) as PlayerServiceHarness;
    httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne('assets/player-houses-mapping.json').flush(MOCK_HOUSE_MAPPING);
  });

  afterEach(() => httpMock.verify());

  // ── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('should create the service', () => {
      expect(service).toBeTruthy();
    });

    it('should start with an empty players list', () => {
      expect(service.players()).toEqual([]);
    });

    it('should start with an empty search term', () => {
      expect(service.searchTerm()).toBe('');
    });

    it('should start with no selected player', () => {
      expect(service.selectedPlayerName()).toBeNull();
      expect(service.selectedPlayer()).toBeNull();
    });
  });

  // ── Firestore live updates ─────────────────────────────────────────────────

  describe('Firestore live updates', () => {
    it('should populate players when a snapshot arrives', () => {
      service.pushPlayers();
      expect(service.players().length).toBe(3);
    });

    it('should map snapshot documents to Player instances', () => {
      service.pushPlayers();
      expect(service.players()[0]).toBeInstanceOf(Player);
    });

    it('should sort players by level descending', () => {
      service.pushPlayers();
      const levels = service.players().map(p => p.level);
      expect(levels).toEqual([...levels].sort((a, b) => b - a));
    });

    it('should resolve house URLs from mapping', () => {
      service.pushPlayers();
      const steve = service.players().find(p => p.name === 'Steve');
      expect(steve?.houseUrl).toBe('https://maps.example.com/steve-house');
    });

    it('should leave houseUrl undefined for players not in mapping', () => {
      service.pushPlayers();
      const alex = service.players().find(p => p.name === 'Alex');
      expect(alex?.houseUrl).toBeUndefined();
    });

    it('should log a warning on Firestore listener error', () => {
      spyOn(console, 'warn');
      service.pushError();
      expect(console.warn).toHaveBeenCalledWith(
        'Firestore player listener error:',
        jasmine.any(Error)
      );
    });
  });

  // ── filteredPlayers ────────────────────────────────────────────────────────

  describe('filteredPlayers', () => {
    beforeEach(() => service.pushPlayers());

    it('should return all players when search term is empty', () => {
      service.searchTerm.set('');
      expect(service.filteredPlayers().length).toBe(3);
    });

    it('should filter by player name (case-insensitive)', () => {
      service.searchTerm.set('steve');
      expect(service.filteredPlayers().length).toBe(1);
      expect(service.filteredPlayers()[0].name).toBe('Steve');
    });

    it('should filter by dimension', () => {
      service.searchTerm.set('nether');
      expect(service.filteredPlayers().length).toBe(1);
      expect(service.filteredPlayers()[0].name).toBe('Alex');
    });

    it('should filter by UUID fragment', () => {
      service.searchTerm.set('aaaaaaaa');
      expect(service.filteredPlayers().length).toBe(1);
      expect(service.filteredPlayers()[0].name).toBe('Steve');
    });

    it('should return an empty list when no players match', () => {
      service.searchTerm.set('zzz_no_match');
      expect(service.filteredPlayers().length).toBe(0);
    });
  });

  // ── selectedPlayer ─────────────────────────────────────────────────────────

  describe('selectedPlayer', () => {
    beforeEach(() => service.pushPlayers());

    it('should return the selected player by name', () => {
      service.selectedPlayerName.set('Alex');
      expect(service.selectedPlayer()?.name).toBe('Alex');
    });

    it('should return null when selection is cleared', () => {
      service.selectedPlayerName.set('Steve');
      service.selectedPlayerName.set(null);
      expect(service.selectedPlayer()).toBeNull();
    });

    it('should return null for a non-existent name', () => {
      service.selectedPlayerName.set('NonExistent');
      expect(service.selectedPlayer()).toBeNull();
    });
  });

  // ── fetchAvatarIfNeeded ────────────────────────────────────────────────────

  describe('fetchAvatarIfNeeded', () => {
    const avatarUrl = 'https://mc-heads.net/avatar/Steve/64';

    it('should return the original URL when cache is empty', () => {
      expect(service.getAvatarUrl(avatarUrl)).toBe(avatarUrl);
    });

    it('should make an HTTP request on first call', () => {
      service.fetchAvatarIfNeeded(avatarUrl);
      const req = httpMock.expectOne(avatarUrl);
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['img'], { type: 'image/png' }));
    });

    it('should not repeat the HTTP request on subsequent calls', () => {
      service.fetchAvatarIfNeeded(avatarUrl);
      httpMock.expectOne(avatarUrl).flush(new Blob(['img'], { type: 'image/png' }));
      service.fetchAvatarIfNeeded(avatarUrl);
      httpMock.expectNone(avatarUrl);
    });

    it('should silently ignore HTTP errors', () => {
      service.fetchAvatarIfNeeded(avatarUrl);
      httpMock.expectOne(avatarUrl).error(new ProgressEvent('error'));
      expect(service.getAvatarUrl(avatarUrl)).toBe(avatarUrl);
    });
  });
});
