const BEDROCK_UUID_PREFIX = '00000000-0000-0000-0009';

export class Player {
  name!: string;
  uuid!: string;
  level!: number;
  health!: number;
  dimension!: string;
  pos!: number[];
  last_seen!: string;
  skin_url!: string;
  is_raw_skin?: boolean;
  houseUrl?: string;

  constructor(data: Partial<Player>) {
    this.name = data.name!;
    this.uuid = data.uuid!;
    this.level = data.level!;
    this.health = data.health!;
    this.dimension = data.dimension!;
    this.pos = data.pos!;
    this.last_seen = data.last_seen!;
    this.skin_url = data.skin_url!;
    this.is_raw_skin = data.is_raw_skin;
    this.houseUrl = data.houseUrl;
  }

  isBedrock(): boolean {
    return this.uuid.startsWith(BEDROCK_UUID_PREFIX);
  }

  avatarUrl(size = 64): string {
    return `https://mc-heads.net/avatar/${this.name}/${size}`;
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
