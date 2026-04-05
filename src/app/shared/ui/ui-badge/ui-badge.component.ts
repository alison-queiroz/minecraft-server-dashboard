import { ChangeDetectionStrategy, Component, input } from '@angular/core';

type UiBadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
type UiBadgeSize = 'sm' | 'md';
type UiBadgeAppearance = 'soft' | 'solid';

@Component({
  selector: 'app-ui-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span class="ui-badge"><ng-content></ng-content></span>',
  styleUrls: ['./ui-badge.component.scss'],
  host: {
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
    '[attr.data-appearance]': 'appearance()',
  },
})
export class UiBadgeComponent {
  readonly variant = input<UiBadgeVariant>('neutral');
  readonly size = input<UiBadgeSize>('md');
  readonly appearance = input<UiBadgeAppearance>('soft');
}
