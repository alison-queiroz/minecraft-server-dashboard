import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Standardized error message. Renders nothing when `message` is falsy, so
 * callers can drop their own `@if` wrapper. `text` is the small inline form-field
 * error; `banner` is the bordered box used for load/submit failures.
 */
@Component({
  selector: 'app-inline-error',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message()) {
      @if (variant() === 'banner') {
        <p
          role="alert"
          class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          {{ message() }}
        </p>
      } @else {
        <p role="alert" class="text-xs text-red-400">{{ message() }}</p>
      }
    }
  `,
})
export class InlineErrorComponent {
  readonly message = input<string | null>(null);
  readonly variant = input<'text' | 'banner'>('text');
}
