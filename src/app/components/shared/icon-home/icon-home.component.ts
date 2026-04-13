import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideHouse } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-icon-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `<app-icon [icon]="LucideHouse" [size]="size()"></app-icon>`,
  host: { style: 'display:inline-flex;line-height:0;vertical-align:middle;' },
})
export class IconHomeComponent {
  protected readonly LucideHouse = LucideHouse;
  readonly size = input<number>(14);
}
