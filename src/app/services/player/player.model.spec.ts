import { Player } from './player.model';
import type { PlayerDto } from './player.model';

const BASE: PlayerDto = {
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
      expect(player.isBedrock()).toBe(false);
    });

    it('should return true for a UUID starting with the Bedrock prefix', () => {
      const bedrock = new Player({ ...BASE, uuid: '00000000-0000-0000-0009-000000000003' });
      expect(bedrock.isBedrock()).toBe(true);
    });
  });

  describe('avatarUrl()', () => {
    it('should return an mc-heads avatar URL with the given size', () => {
      expect(player.avatarUrl(64)).toBe('https://mc-heads.net/avatar/Steve/64');
    });

    it('should default to size 64', () => {
      expect(player.avatarUrl()).toBe('https://mc-heads.net/avatar/Steve/64');
    });

    it('should resize existing mc-heads avatar URLs to the requested size', () => {
      const avatar = new Player({ ...BASE, skin_url: 'https://mc-heads.net/avatar/GM_De_Sunga/64' });
      expect(avatar.avatarUrl(40)).toBe('https://mc-heads.net/avatar/GM_De_Sunga/40');
    });

    it('should return raw skin_url unchanged when not an mc-heads skin URL', () => {
      const raw = new Player({ ...BASE, skin_url: 'https://example.com/skin.png' });
      expect(raw.avatarUrl()).toBe('https://example.com/skin.png');
    });
  });

  describe('isRawAvatar()', () => {
    it('should return false for mc-heads URL', () => {
      expect(player.isRawAvatar()).toBe(false);
    });

    it('should return true for a non mc-heads URL', () => {
      const raw = new Player({ ...BASE, skin_url: 'https://example.com/skin.png' });
      expect(raw.isRawAvatar()).toBe(true);
    });

    it('should return false when skin_url is falsy', () => {
      const noSkin = new Player({ ...BASE, skin_url: undefined });
      expect(noSkin.isRawAvatar()).toBe(false);
    });
  });

  describe('healthPercent()', () => {
    it('should calculate health as a percentage of 20', () => {
      expect(player.healthPercent()).toBe(70);
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

  describe('isOp()', () => {
    it('returns false when is_op is not set', () => {
      expect(player.isOp()).toBe(false);
    });

    it('returns true when is_op is true', () => {
      const op = new Player({ ...BASE, is_op: true });
      expect(op.isOp()).toBe(true);
    });

    it('returns false when is_op is false', () => {
      const notOp = new Player({ ...BASE, is_op: false });
      expect(notOp.isOp()).toBe(false);
    });
  });

  describe('matchesSearch()', () => {
    it('should match by lowercase name', () => {
      expect(player.matchesSearch('steve')).toBe(true);
    });

    it('should match partial name', () => {
      expect(player.matchesSearch('tev')).toBe(true);
    });

    it('should match dimension', () => {
      expect(player.matchesSearch('overworld')).toBe(true);
    });

    it('should match UUID fragment', () => {
      expect(player.matchesSearch('aaaaaaaa')).toBe(true);
    });

    it('should return false when nothing matches', () => {
      expect(player.matchesSearch('zzz')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(player.matchesSearch('STEVE')).toBe(true);
    });
  });

  describe('sameDataAs()', () => {
    it('is true for separately built players with identical data', () => {
      expect(new Player({ ...BASE }).sameDataAs(new Player(structuredClone(BASE)))).toBe(true);
    });

    it('is false when a scalar, a nested array or an optional field differs', () => {
      expect(player.sameDataAs(new Player({ ...BASE, health: 13 }))).toBe(false);
      expect(player.sameDataAs(new Player({ ...BASE, pos: [100, 64, 201] }))).toBe(false);
      expect(player.sameDataAs(new Player({ ...BASE, houseUrl: 'https://maps/x' }))).toBe(false);
    });
  });

  describe('DTO mapping with missing fields', () => {
    it('gives every always-read field a safe default when the DTO is empty', () => {
      const empty = new Player({});
      expect(empty).toMatchObject({
        name: '', uuid: '', level: 0, health: 0, dimension: '', pos: [], last_seen: '', skin_url: '',
      });
      expect(empty.play_hours).toBeUndefined();
      expect(empty.advancement_count).toBeUndefined();
      expect(empty.homes).toBeUndefined();
      expect(empty.houseUrl).toBeUndefined();
    });

    it('treats null exactly like a missing field', () => {
      const nulls = new Player({
        name: 'Steve', uuid: null, level: null, health: null, dimension: null, pos: null,
        last_seen: null, skin_url: null, is_raw_skin: null, play_hours: null,
        advancement_count: null, is_op: null, homes: null,
      });
      expect(nulls).toMatchObject({ uuid: '', level: 0, dimension: '', pos: [], last_seen: '' });
      expect(nulls.is_raw_skin).toBeUndefined();
      expect(nulls.play_hours).toBeUndefined();
    });

    it('matchesSearch does not throw for a live-API row without dimension/uuid', () => {
      const liveRow = new Player({ name: 'Steve' });
      expect(liveRow.matchesSearch('nether')).toBe(false);
      expect(liveRow.matchesSearch('ste')).toBe(true);
    });

    it('supports localeCompare-based sorting when string fields are missing', () => {
      const players = [new Player({ name: 'b', last_seen: '2026-01-02' }), new Player({})];
      expect(() => players.sort((a, b) => a.last_seen.localeCompare(b.last_seen))).not.toThrow();
      expect(() => players.sort((a, b) => a.dimension.localeCompare(b.dimension))).not.toThrow();
      expect(players.map(p => p.name)).toEqual(['', 'b']);
    });

    it('avatarUrl/isRawAvatar tolerate a missing skin_url', () => {
      const noSkin = new Player({ name: 'Steve' });
      expect(noSkin.avatarUrl(40)).toBe('');
      expect(noSkin.isRawAvatar()).toBe(false);
    });
  });
});




