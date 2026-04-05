import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

type UiIconButtonVariant = 'neutral' | 'accent' | 'danger' | 'bright';
type UiIconButtonSize = 'sm' | 'md';

@Component({
  selector: 'app-ui-icon-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-icon-button.component.html',
  styleUrls: ['./ui-icon-button.component.scss'],
  host: {
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
  },
})
export class UiIconButtonComponent {
  readonly ariaLabel = input.required<string>();
  readonly variant = input<UiIconButtonVariant>('neutral');
  readonly size = input<UiIconButtonSize>('md');
  readonly disabled = input(false);

  readonly activated = output<void>();

  protected handleClick(): void {
    if (!this.disabled()) {
      this.activated.emit();
    }
  }
}
