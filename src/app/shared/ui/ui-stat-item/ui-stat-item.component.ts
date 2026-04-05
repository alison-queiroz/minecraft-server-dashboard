import { ChangeDetectionStrategy, Component, input } from '@angular/core';

type UiStatAlignment = 'left' | 'right';

@Component({
  selector: 'app-ui-stat-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-stat-item.component.html',
  styleUrls: ['./ui-stat-item.component.scss'],
})
export class UiStatItemComponent {
  readonly label = input.required<string>();
  readonly value = input<string | number>('—');
  readonly mono = input(false);
  readonly align = input<UiStatAlignment>('left');
}
