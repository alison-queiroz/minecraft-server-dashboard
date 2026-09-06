import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  Input,
  computed,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { of } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { LucideTrophy, LucideChevronDown } from '@lucide/angular';
import type { AdvancementsResult, Advancement } from '../../../services/advancements/advancements.service';
import { AdvancementsService } from '../../../services/advancements/advancements.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { LoadingService } from '../../../services/loading/loading.service';
import { TooltipDirective } from '../../../directives/tooltip.directive';

@Component({
  selector: 'app-player-advancements',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent, TooltipDirective, EmptyStateComponent],
  templateUrl: './player-advancements.component.html',
  styleUrls: ['./player-advancements.component.scss'],
})
export class PlayerAdvancementsComponent {
  @Input({ required: true })
  set uuid(value: string) {
    this.uuidInput.set(value);
  }

  @Input()
  set isBedrock(value: boolean) {
    this.isBedrockInput.set(value);
  }

  @Input()
  set initialCount(value: number | undefined) {
    this.initialCountInput.set(value ?? 0);
  }

  @Input()
  set startOpen(value: boolean) {
    this.startOpenInput.set(value);
  }

  private readonly advancementsService = inject(AdvancementsService);
  protected readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly LucideTrophy     = LucideTrophy;
  protected readonly LucideChevronDown = LucideChevronDown;

  private readonly uuidInput = signal('');
  private readonly isBedrockInput = signal(false);
  private readonly initialCountInput = signal(0);
  private readonly startOpenInput = signal(false);
  protected readonly collapsed = signal(true);
  protected readonly result    = signal<AdvancementsResult>({ completed: [], total: 0, by_category: {} });
  /** Shows the loaded total when available, otherwise falls back to the Firestore-cached count. */
  protected readonly displayCount = computed(() =>
    this.result().total > 0 ? this.result().total : this.initialCountInput());

  /**
   * Advancements grouped by category, preserving the order the API returned.
   * Returns an ordered array (not a Map) so the template can iterate it
   * directly — the KeyValuePipe would re-sort the categories alphabetically and
   * silently discard the intended insertion order.
   */
  protected readonly byCategory = computed<{ key: string; value: Advancement[] }[]>(() => {
    const groups = new Map<string, Advancement[]>();
    for (const adv of this.result().completed) {
      if (!groups.has(adv.category)) groups.set(adv.category, []);
      groups.get(adv.category)!.push(adv);
    }
    return [...groups.entries()].map(([key, value]) => ({ key, value }));
  });

  private readonly loadingDescriptionIds = new Set<string>();
  private loaded = false;

  constructor() {
    effect(() => {
      const uuid = this.uuidInput();
      const isBedrock = this.isBedrockInput();

      this.loaded = false;
      this.result.set({ completed: [], total: 0, by_category: {} });

      const startOpen = untracked(() => this.startOpenInput());
      if (startOpen && !isBedrock && uuid) {
        // startOpen was requested — expand and fetch immediately
        this.collapsed.set(false);
        this.fetch();
      } else {
        this.collapsed.set(true);
      }
    });
  }

  protected toggle(): void {
    const opening = this.collapsed();
    this.collapsed.set(!opening);
    if (opening && !this.loaded && !this.isBedrockInput() && this.uuidInput()) {
      this.fetch();
    }
  }

  /**
   * Lazily fetches the advancement description on first hover/focus.
    * The description is written back into the signal state so the visible
    * tooltip and aria label refresh as soon as loading completes.
   */
  protected prefetchDescription(adv: Advancement): void {
    if (adv.description || this.loadingDescriptionIds.has(adv.id)) return;

    this.loadingDescriptionIds.add(adv.id);
    this.advancementsService.getDescription(adv.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      tap(desc => {
        if (!desc) {
          return;
        }

        this.result.update(result => ({
          ...result,
          completed: result.completed.map(item =>
            item.id === adv.id ? { ...item, description: desc } : item),
        }));
      }),
      finalize(() => {
        this.loadingDescriptionIds.delete(adv.id);
      }),
    ).subscribe();
  }

  private fetch(): void {
    const requestedUuid = this.uuidInput();
    this.advancementsService.getAdvancements(requestedUuid).pipe(
      takeUntilDestroyed(this.destroyRef),
      tap(r => {
        // Ignore a response that arrived after the input switched players.
        if (this.uuidInput() !== requestedUuid) return;
        this.result.set(r);
        this.loaded = true;
      }),
      catchError(() => of(null)),
    ).subscribe();
  }
}
