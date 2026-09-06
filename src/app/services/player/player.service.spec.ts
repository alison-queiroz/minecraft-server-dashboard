import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Injectable } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { PlayerService } from './player.service';
import { Player } from './player.model';

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

@Injectable()
class PlayerServiceHarness extends PlayerService {
  protected override subscribeToFirestorePlayers(): void { return; }

  pushPlayers(players: Partial<Player>[] = MOCK_PLAYERS): void {
    const sorted = players
      .map((p: Partial<Player>) => new Player(p))
      .sort((a: Player, b: Player) => b.level - a.level);
    this.rawPlayers.set(sorted);
  }

  callFetchPlayersFromApi(): void {
    (this as unknown as { fetchPlayersFromApi(): void }).fetchPlayersFromApi();
  }

  callEnrichFromApi(): void {
    (this as unknown as { enrichFromApi(): void }).enrichFromApi();
  }
}

describe('PlayerService', () => {
  let service: PlayerServiceHarness;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PlayerService, useClass: PlayerServiceHarness },
      ],
    });
    service = TestBed.inject(PlayerService) as PlayerServiceHarness;
    httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne('assets/player-houses-mapping.json').flush(MOCK_HOUSE_MAPPING);
  });

  afterEach(() => httpMock.verify());

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
      const levels = service.players().map((p: Player) => p.level);
      expect(levels).toEqual([...levels].sort((a: number, b: number) => b - a));
    });

    it('should resolve house URLs from mapping', () => {
      service.pushPlayers();
      const steve = service.players().find((p: Player) => p.name === 'Steve');
      expect(steve?.houseUrl).toBe('https://maps.example.com/steve-house');
    });

    it('should leave houseUrl undefined for players not in mapping', () => {
      service.pushPlayers();
      const alex = service.players().find((p: Player) => p.name === 'Alex');
      expect(alex?.houseUrl).toBeUndefined();
    });

    // The Firestore listener error branch is covered against the real onSnapshot
    // callback in player.service.firestore.spec.ts. The previous test here only
    // asserted the harness's own console.warn (it tested the mock, not the code).
  });

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

    it('should not repeat the HTTP request on subsequent calls', async () => {
      service.fetchAvatarIfNeeded(avatarUrl);
      httpMock.expectOne(avatarUrl).flush(new Blob(['img'], { type: 'image/png' }));

      // Wait one microtask for the tap operator to update the cache
      await new Promise(resolve => setTimeout(resolve, 0));

      service.fetchAvatarIfNeeded(avatarUrl);
      httpMock.expectNone(avatarUrl);
    });

    it('should silently ignore HTTP errors', () => {
      service.fetchAvatarIfNeeded(avatarUrl);
      httpMock.expectOne(avatarUrl).error(new ProgressEvent('error'));
      expect(service.getAvatarUrl(avatarUrl)).toBe(avatarUrl);
    });
  });

  describe('fetchPlayersFromApi', () => {
    it('sets players when the API returns a non-empty list', () => {
      service.callFetchPlayersFromApi();
      const req = httpMock.expectOne('/api/players');
      req.flush(MOCK_PLAYERS);
      expect(service.players().length).toBe(MOCK_PLAYERS.length);
    });

    it('does not change rawPlayers when API returns an empty list', () => {
      service.pushPlayers();
      service.callFetchPlayersFromApi();
      const req = httpMock.expectOne('/api/players');
      req.flush([]);
      expect(service.players().length).toBe(MOCK_PLAYERS.length);
    });

    it('silently handles HTTP errors', () => {
      service.callFetchPlayersFromApi();
      httpMock.expectOne('/api/players').error(new ProgressEvent('error'));
      expect(service.players()).toBeDefined();
    });
  });

  describe('enrichFromApi', () => {
    beforeEach(() => service.pushPlayers());

    it('merges live API data into existing Firestore players', () => {
      service.callEnrichFromApi();
      const enrichedData = MOCK_PLAYERS.map((p: Partial<Player>) => ({ ...p, level: 99 }));
      httpMock.expectOne('/api/players').flush(enrichedData);
      const steve = service.players().find((p: Player) => p.name === 'Steve');
      expect(steve?.level).toBe(99);
    });

    it('keeps existing player data when player is not in API response', () => {
      service.callEnrichFromApi();
      httpMock.expectOne('/api/players').flush([{ name: 'Alex', level: 99 }]);
      const steve = service.players().find((p: Player) => p.name === 'Steve');
      expect(steve?.level).toBe(10);
    });

    it('does nothing when API returns empty list', () => {
      service.callEnrichFromApi();
      httpMock.expectOne('/api/players').flush([]);
      expect(service.players().length).toBe(MOCK_PLAYERS.length);
    });
    it('falls back to existing player fields when API response has null/undefined values', () => {
      service.callEnrichFromApi();
      // Partial response: level/health/dimension are null — should keep existing player values via ??
      httpMock.expectOne('/api/players').flush([{
        name: 'Steve', level: null, health: null, dimension: null,
        pos: null, last_seen: null, play_hours: null, advancement_count: null, homes: null,
      }]);
      const steve = service.players().find((p: Player) => p.name === 'Steve');
      expect(steve?.level).toBe(10);
      expect(steve?.health).toBe(20);
    });

    it('handles HTTP errors silently', () => {
      service.callEnrichFromApi();
      httpMock.expectOne('/api/players').error(new ProgressEvent('error'));
      expect(service.players().length).toBe(MOCK_PLAYERS.length);
    });
  });

  describe('house links error path', () => {
    it('logs a warning when house links JSON cannot be fetched', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: PlayerService, useClass: PlayerServiceHarness },
        ],
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      TestBed.inject(PlayerService) as PlayerServiceHarness;
      const freshHttp = TestBed.inject(HttpTestingController);

      freshHttp.expectOne('assets/player-houses-mapping.json')
        .error(new ProgressEvent('error'));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not reach house links')
      );
      freshHttp.verify();
    });
  });
});




