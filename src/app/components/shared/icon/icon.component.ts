import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideDynamicIcon, type LucideIcon } from '@lucide/angular';

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    [lucideIcon]="icon()"
    [size]="size()"
    [strokeWidth]="strokeWidth()"
  ></svg>`,
  imports: [LucideDynamicIcon],
  host: { style: 'display:inline-flex;line-height:0;vertical-align:middle;' },
})
export class IconComponent {
  readonly icon = input.required<LucideIcon>();
  readonly size = input<number | string>(16);
  readonly strokeWidth = input<number | string>(2);
}
