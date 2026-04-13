import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideMapPin } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-icon-map-pin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `<app-icon [icon]="LucideMapPin" [size]="size()"></app-icon>`,
  host: { style: 'display:inline-flex;line-height:0;vertical-align:middle;' },
})
export class IconMapPinComponent {
  protected readonly LucideMapPin = LucideMapPin;
  readonly size = input<number>(14);
}
