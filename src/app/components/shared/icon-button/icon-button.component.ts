import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { LucideIcon } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';

export type IconButtonVariant = 'accent' | 'bright' | 'danger' | 'plain';

/**
 * Icon-only ghost button, backed by the global `.ui-icon-button` utility so the
 * rounded/hover/dark styling lives in exactly one place (styles.scss). Replaces
 * the byte-identical per-component `.location-action` / `.home-action` /
 * `.account-remove` implementations.
 */
@Component({
  selector: 'app-icon-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button
      type="button"
      class="ui-icon-button"
      [class.ui-icon-button--accent]="variant() === 'accent'"
      [class.ui-icon-button--bright]="variant() === 'bright'"
      [class.ui-icon-button--danger]="variant() === 'danger'"
      [disabled]="disabled()"
      [attr.title]="title()"
      [attr.aria-label]="ariaLabel() ?? title()"
      [attr.data-testid]="testId()"
      (click)="pressed.emit($event)"
    >
      <app-icon [icon]="icon()" [size]="size()" [strokeWidth]="strokeWidth()" />
    </button>
  `,
})
export class IconButtonComponent {
  readonly icon = input.required<LucideIcon>();
  readonly size = input<number | string>(14);
  readonly strokeWidth = input<number | string>(2);
  readonly variant = input<IconButtonVariant>('plain');
  readonly disabled = input(false);
  readonly title = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  /** Optional stable hook for e2e/unit tests, rendered as data-testid. */
  readonly testId = input<string | null>(null);

  readonly pressed = output<MouseEvent>();
}
