import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { LucideChevronDown, type LucideIcon } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';

/**
 * Disclosure header: full-width button with an optional leading icon, uppercase
 * label, optional count pill and a chevron that rotates when expanded. Owns only
 * the (previously duplicated) header; the caller renders its own body gated on
 * the two-way `expanded` model.
 */
@Component({
  selector: 'app-collapsible-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button
      type="button"
      [class]="headerClass()"
      [attr.aria-expanded]="expanded()"
      [attr.data-testid]="testId()"
      (click)="expanded.set(!expanded())"
    >
      <span class="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
        @if (icon(); as ic) {
          <app-icon [icon]="ic" [size]="13" />
        }
        {{ label() }}
        @if (count() !== null) {
          <span [class]="countClass()">{{ count() }}</span>
        }
      </span>
      <app-icon
        [icon]="LucideChevronDown"
        [size]="chevronSize()"
        class="text-zinc-400 transition-transform duration-200 dark:text-zinc-600"
        [class.rotate-180]="expanded()"
      />
    </button>
  `,
})
export class CollapsibleSectionComponent {
  readonly label = input.required<string>();
  readonly icon = input<LucideIcon | null>(null);
  readonly count = input<number | null>(null);
  readonly accent = input<'emerald' | 'amber'>('emerald');
  readonly chevronSize = input<number | string>(14);
  readonly expanded = model(false);
  /** Optional stable hook for e2e/unit tests, rendered as data-testid. */
  readonly testId = input<string | null>(null);

  protected readonly LucideChevronDown = LucideChevronDown;

  private static readonly BASE =
    'flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-2 text-left transition-colors cursor-pointer dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800';

  protected readonly headerClass = computed(() =>
    this.accent() === 'amber'
      ? `${CollapsibleSectionComponent.BASE} hover:border-amber-500/30 hover:bg-amber-50`
      : `${CollapsibleSectionComponent.BASE} hover:border-emerald-500/30 hover:bg-stone-50`,
  );

  protected readonly countClass = computed(() =>
    this.accent() === 'amber'
      ? 'inline-flex items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400'
      : 'inline-flex items-center justify-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400',
  );
}
