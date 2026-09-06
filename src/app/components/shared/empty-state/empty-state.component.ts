import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Centered "nothing here" placeholder. Pass a plain `message`, or project rich
 * content (e.g. a `<code>/sethome</code>` hint) when message is omitted.
 * `inline` sits in flow; `overlay` fills a relatively-positioned parent
 * (e.g. a chart wrapper).
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="cssClass()" [attr.data-testid]="testId()">
      @if (message()) {
        {{ message() }}
      } @else {
        <ng-content />
      }
    </div>
  `,
})
export class EmptyStateComponent {
  readonly message = input<string | null>(null);
  readonly variant = input<'inline' | 'overlay'>('inline');
  readonly size = input<'sm' | 'md'>('md');
  /** Optional stable hook for e2e/unit tests, rendered as data-testid. */
  readonly testId = input<string | null>(null);

  protected readonly cssClass = computed(() => {
    if (this.variant() === 'overlay') {
      return 'pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-zinc-500 dark:text-zinc-400';
    }
    const size = this.size() === 'sm' ? 'py-2 text-xs' : 'py-4 text-sm';
    return `${size} text-center text-zinc-500 dark:text-zinc-500`;
  });
}
