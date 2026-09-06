import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { LucideIcon } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';

/**
 * Standard page header: optional leading icon + title + optional subtitle, with
 * a right-aligned `[actions]` projection slot (back link, edit/cancel buttons).
 * `display` = big uppercase title; `default` = smaller semibold title.
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="flex items-start justify-between gap-3" [attr.data-testid]="testId()">
      <div class="flex flex-col gap-1">
        <h1 [class]="titleClass()">
          @if (icon(); as ic) {
            <app-icon [icon]="ic" [size]="iconSize()" [strokeWidth]="2" />
          }
          {{ title() }}
        </h1>
        @if (subtitle()) {
          <p class="text-sm text-zinc-500 dark:text-zinc-400">{{ subtitle() }}</p>
        }
      </div>
      <ng-content select="[actions]" />
    </div>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly icon = input<LucideIcon | null>(null);
  readonly variant = input<'display' | 'default'>('display');
  /** Optional stable hook for e2e/unit tests, rendered as data-testid. */
  readonly testId = input<string | null>(null);

  protected readonly iconSize = computed(() => (this.variant() === 'display' ? 22 : 18));
  protected readonly titleClass = computed(() =>
    this.variant() === 'display'
      ? 'flex items-center gap-3 text-2xl font-black uppercase tracking-tighter text-zinc-900 dark:text-zinc-100'
      : 'flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100',
  );
}
