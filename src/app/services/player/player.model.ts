export const BEDROCK_UUID_PREFIX = '00000000-0000-0000-0009';

/** True for a Floodgate/Bedrock player UUID (single source of this rule). */
export function isBedrockUuid(uuid: string): boolean {
  return uuid.startsWith(BEDROCK_UUID_PREFIX);
}

export interface EssentialsHome {
  name: string;
  world: string;
  x: number;
  y: number;
  z: number;
}

/** A missing key, `null` and `undefined` all mean "no value" on the wire. */
type Maybe<T> = T | null | undefined;

const text = (value: Maybe<string>): string => value ?? '';
const count = (value: Maybe<number>): number => value ?? 0;
const optional = <T>(value: Maybe<T>): T | undefined => value ?? undefined;

/**
 * Wire shape of a player from a Firestore `players` doc or `/api/players`.
 * Every field may be absent or null: older docs predate newer fields and the
 * live API omits whatever it doesn't know.
 */
export interface PlayerDto {
  name?: Maybe<string>;
  uuid?: Maybe<string>;
  level?: Maybe<number>;
  health?: Maybe<number>;
  dimension?: Maybe<string>;
  pos?: Maybe<readonly number[]>;
  last_seen?: Maybe<string>;
  skin_url?: Maybe<string>;
  is_raw_skin?: Maybe<boolean>;
  play_hours?: Maybe<number>;
  advancement_count?: Maybe<number>;
  is_op?: Maybe<boolean>;
  homes?: Maybe<readonly EssentialsHome[]>;
}

/** Constructor input: the wire DTO plus the client-side house-map link. */
export interface PlayerInit extends PlayerDto {
  houseUrl?: Maybe<string>;
}

export class Player {
  readonly name: string;
  readonly uuid: string;
  readonly level: number;
  readonly health: number;
  readonly dimension: string;
  readonly pos: readonly number[];
  readonly last_seen: string;
  readonly skin_url: string;
  readonly is_raw_skin: boolean | undefined;
  readonly houseUrl: string | undefined;
  readonly play_hours: number | undefined;
  readonly advancement_count: number | undefined;
  readonly is_op: boolean | undefined;
  readonly homes: readonly EssentialsHome[] | undefined;

  /**
   * The single DTO -> model mapping. Fields the UI always reads (search,
   * sorting, labels) get safe defaults so string/number methods never hit
   * `undefined`; genuinely optional stats stay `undefined` when absent.
   */
  constructor(data: PlayerInit) {
    this.name = text(data.name);
    this.uuid = text(data.uuid);
    this.level = count(data.level);
    this.health = count(data.health);
    this.dimension = text(data.dimension);
    this.pos = data.pos ?? [];
    this.last_seen = text(data.last_seen);
    this.skin_url = text(data.skin_url);
    this.is_raw_skin = optional(data.is_raw_skin);
    this.houseUrl = optional(data.houseUrl);
    this.play_hours = optional(data.play_hours);
    this.advancement_count = optional(data.advancement_count);
    this.is_op = optional(data.is_op);
    this.homes = optional(data.homes);
  }

  /**
   * True when both carry identical field values. Every instance is built by
   * this constructor (same key order, methods on the prototype), so comparing
   * the serialized own fields is exact and automatically covers new fields.
   */
  sameDataAs(other: Player): boolean {
    return JSON.stringify(this) === JSON.stringify(other);
  }

  isBedrock(): boolean {
    return isBedrockUuid(this.uuid);
  }

  isOp(): boolean {
    return this.is_op === true;
  }

  avatarUrl(size = 64): string {
    if (this.skin_url.includes('mc-heads.net/skin/')) {
      return this.skin_url.replace('/skin/', '/avatar/') + '/' + size;
    }
    if (this.skin_url.includes('mc-heads.net/avatar/')) {
      return this.skin_url.replace(/\/\d+$/, '') + '/' + size;
    }
    return this.skin_url;
  }

  isRawAvatar(): boolean {
    return this.skin_url ? !this.skin_url.includes('mc-heads.net') : false;
  }

  healthPercent(): number {
    return (this.health / 20) * 100;
  }

  matchesSearch(term: string): boolean {
    const t = term.toLowerCase();
    return (
      this.name.toLowerCase().includes(t) ||
      this.uuid.toLowerCase().includes(t) ||
      this.dimension.toLowerCase().includes(t)
    );
  }
}
