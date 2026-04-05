import { ChangeDetectionStrategy, Component, input } from '@angular/core';

type UiListItemVariant = 'neutral' | 'accent';

@Component({
  selector: 'app-ui-list-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-list-item.component.html',
  styleUrls: ['./ui-list-item.component.scss'],
  host: {
    '[attr.data-variant]': 'variant()',
  },
})
export class UiListItemComponent {
  readonly compact = input(false);
  readonly interactive = input(false);
  readonly variant = input<UiListItemVariant>('neutral');
  readonly showLeading = input(false);
  readonly showSubtitle = input(false);
  readonly showTrailing = input(false);
}
