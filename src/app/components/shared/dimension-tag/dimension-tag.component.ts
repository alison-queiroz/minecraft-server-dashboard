import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

interface WorldInfo {
  label: string;
  color: 'emerald' | 'orange' | 'purple' | 'zinc';
}

const WORLD_MAP: Record<string, WorldInfo> = {
  // EssentialsX world IDs
  world:         { label: 'Overworld', color: 'emerald' },
  world_nether:  { label: 'Nether',    color: 'orange'  },
  world_the_end: { label: 'The End',   color: 'purple'  },
  // Human-readable (from Minecraft server API / player.dimension)
  overworld:     { label: 'Overworld', color: 'emerald' },
  nether:        { label: 'Nether',    color: 'orange'  },
  'the end':     { label: 'The End',   color: 'purple'  },
};

@Component({
  selector: 'app-dimension-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ label }}`,
  styleUrls: ['./dimension-tag.component.scss'],
  host: {
    '[class.text-emerald-500]': `color === 'emerald'`,
    '[class.text-orange-500]':  `color === 'orange'`,
    '[class.text-purple-500]':  `color === 'purple'`,
    '[class.text-zinc-500]':    `color === 'zinc'`,
  },
})
export class DimensionTagComponent {
  @Input({ required: true }) world!: string;

  get label(): string {
    return WORLD_MAP[this.world?.toLowerCase()]?.label ?? this.world;
  }

  get color(): WorldInfo['color'] {
    return WORLD_MAP[this.world?.toLowerCase()]?.color ?? 'zinc';
  }
}
