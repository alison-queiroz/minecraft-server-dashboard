import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
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

describe('PlayerService', () => {
  let service: PlayerService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
    service = TestBed.inject(PlayerService);
    httpMock = TestBed.inject(HttpTestingController);

    // Flush the house links request triggered in the constructor
    httpMock.expectOne('assets/player-houses-mapping.json').flush(MOCK_HOUSE_MAPPING);
  });

  afterEach(() => {
    // Absorb avatar prefetch requests fired by prefetchAvatars() after player data loads
    httpMock.match(req => req.url.includes('mc-heads.net'));
    httpMock.verify();
  });

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

  describe('fetchPlayerData', () => {
    beforeEach(() => {
      service.fetchPlayerData();
      httpMock.expectOne('/api/players').flush(MOCK_PLAYERS);
    });

    it('should populate players after fetch', () => {
      expect(service.players().length).toBe(3);
    });

    it('should map players to Player instances', () => {
      expect(service.players()[0]).toBeInstanceOf(Player);
    });

    it('should resolve house URLs from mapping', () => {
      const steve = service.players().find(p => p.name === 'Steve');
      expect(steve?.houseUrl).toBe('https://maps.example.com/steve-house');
    });

    it('should leave houseUrl undefined for players not in mapping', () => {
      const alex = service.players().find(p => p.name === 'Alex');
      expect(alex?.houseUrl).toBeUndefined();
    });
  });

  describe('filteredPlayers', () => {
    beforeEach(() => {
      service.fetchPlayerData();
      httpMock.expectOne('/api/players').flush(MOCK_PLAYERS);
    });

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

    it('should return empty list when no players match', () => {
      service.searchTerm.set('zzz_no_match');
      expect(service.filteredPlayers().length).toBe(0);
    });
  });

  describe('selectedPlayer', () => {
    beforeEach(() => {
      service.fetchPlayerData();
      httpMock.expectOne('/api/players').flush(MOCK_PLAYERS);
    });

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

  describe('error handling', () => {
    it('should log a warning and keep empty list when /api/players fails', () => {
      spyOn(console, 'warn');
      service.fetchPlayerData();
      httpMock.expectOne('/api/players').error(new ProgressEvent('error'));
      expect(service.players()).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith('Could not reach players data.');
    });
  });
});
