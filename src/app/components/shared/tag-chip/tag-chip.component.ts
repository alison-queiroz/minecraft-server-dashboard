import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-tag-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-color]': 'color',
  },
  template: `<ng-content />`,
  styleUrls: ['./tag-chip.component.scss'],
})
export class TagChipComponent {
  /** green = emerald accent  |  zinc = neutral light  |  dim = muted mono */
  @Input() color: 'green' | 'zinc' | 'dim' = 'zinc';
}
