import { Player } from './player.model';

const BASE: Partial<Player> = {
  name: 'Steve',
  uuid: 'aaaaaaaa-0000-0000-0000-000000000001',
  level: 10,
  health: 14,
  dimension: 'Overworld',
  pos: [100, 64, 200],
  last_seen: '2024-01-01',
  skin_url: 'https://mc-heads.net/skin/Steve',
  is_raw_skin: false,
};

describe('Player model', () => {
  let player: Player;

  beforeEach(() => {
    player = new Player({ ...BASE });
  });

  describe('isBedrock()', () => {
    it('should return false for a Java player UUID', () => {
      expect(player.isBedrock()).toBeFalse();
    });

    it('should return true for a UUID starting with the Bedrock prefix', () => {
      const bedrock = new Player({ ...BASE, uuid: '00000000-0000-0000-0009-000000000003' });
      expect(bedrock.isBedrock()).toBeTrue();
    });
  });

  describe('avatarUrl()', () => {
    it('should return an mc-heads avatar URL with the given size', () => {
      expect(player.avatarUrl(64)).toBe('https://mc-heads.net/avatar/Steve/64');
    });

    it('should default to size 64', () => {
      expect(player.avatarUrl()).toBe('https://mc-heads.net/avatar/Steve/64');
    });

    it('should return raw skin_url unchanged when not an mc-heads skin URL', () => {
      const raw = new Player({ ...BASE, skin_url: 'https://example.com/skin.png' });
      expect(raw.avatarUrl()).toBe('https://example.com/skin.png');
    });
  });

  describe('isRawAvatar()', () => {
    it('should return false for mc-heads URL', () => {
      expect(player.isRawAvatar()).toBeFalse();
    });

    it('should return true for a non mc-heads URL', () => {
      const raw = new Player({ ...BASE, skin_url: 'https://example.com/skin.png' });
      expect(raw.isRawAvatar()).toBeTrue();
    });

    it('should return false when skin_url is falsy', () => {
      const noSkin = new Player({ ...BASE, skin_url: undefined as any });
      expect(noSkin.isRawAvatar()).toBeFalse();
    });
  });

  describe('healthPercent()', () => {
    it('should calculate health as a percentage of 20', () => {
      expect(player.healthPercent()).toBe(70); // 14/20 * 100
    });

    it('should return 100 at full health', () => {
      const full = new Player({ ...BASE, health: 20 });
      expect(full.healthPercent()).toBe(100);
    });

    it('should return 0 at no health', () => {
      const dead = new Player({ ...BASE, health: 0 });
      expect(dead.healthPercent()).toBe(0);
    });
  });

  describe('matchesSearch()', () => {
    it('should match by lowercase name', () => {
      expect(player.matchesSearch('steve')).toBeTrue();
    });

    it('should match partial name', () => {
      expect(player.matchesSearch('tev')).toBeTrue();
    });

    it('should match dimension', () => {
      expect(player.matchesSearch('overworld')).toBeTrue();
    });

    it('should match UUID fragment', () => {
      expect(player.matchesSearch('aaaaaaaa')).toBeTrue();
    });

    it('should return false when nothing matches', () => {
      expect(player.matchesSearch('zzz')).toBeFalse();
    });

    it('should be case-insensitive', () => {
      expect(player.matchesSearch('STEVE')).toBeTrue();
    });
  });
});
