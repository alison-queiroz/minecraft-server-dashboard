import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, KeyValuePipe } from '@angular/common';
import { of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { LucideTrophy, LucideChevronDown } from '@lucide/angular';
import { AdvancementsService, AdvancementsResult, Advancement } from '../../../services/advancements/advancements.service';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-player-advancements',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, KeyValuePipe, IconComponent],
  templateUrl: './player-advancements.component.html',
  styleUrls: ['./player-advancements.component.scss'],
})
export class PlayerAdvancementsComponent implements OnChanges {
  @Input({ required: true }) uuid = '';
  @Input() isBedrock = false;
  @Input() set initialCount(v: number | undefined) { this._initialCount.set(v ?? 0); }
  @Input() set startOpen(v: boolean) { this._startOpen = v; }

  private _startOpen = false;

  private readonly advancementsService = inject(AdvancementsService);
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly LucideTrophy     = LucideTrophy;
  protected readonly LucideChevronDown = LucideChevronDown;

  private readonly _initialCount = signal(0);
  protected readonly collapsed = signal(true);
  protected readonly isLoading = signal(false);
  protected readonly result    = signal<AdvancementsResult>({ completed: [], total: 0, by_category: {} });
  /** Shows the loaded total when available, otherwise falls back to the Firestore-cached count. */
  protected readonly displayCount = computed(() =>
    this.result().total > 0 ? this.result().total : this._initialCount());

  /** Advancements grouped by category, preserving order from API */
  protected readonly byCategory = computed(() => {
    const groups = new Map<string, Advancement[]>();
    for (const adv of this.result().completed) {
      if (!groups.has(adv.category)) groups.set(adv.category, []);
      groups.get(adv.category)!.push(adv);
    }
    return groups;
  });

  /** Currently hovered chip tooltip state */
  protected readonly tooltip = signal<{ id: string; text: string; x: number; y: number } | null>(null);

  private loaded = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['uuid'] || changes['isBedrock']) {
      this.loaded = false;
      this.result.set({ completed: [], total: 0, by_category: {} });
      this.tooltip.set(null);
      if (this._startOpen && !this.isBedrock && this.uuid) {
        // startOpen was requested — expand and fetch immediately
        this.collapsed.set(false);
        this.fetch();
      } else {
        this.collapsed.set(true);
      }
    }
  }

  protected toggle(): void {
    const opening = this.collapsed();
    this.collapsed.set(!opening);
    if (opening && !this.loaded && !this.isBedrock && this.uuid) {
      this.fetch();
    }
  }

  protected onChipEnter(adv: Advancement, event: MouseEvent | FocusEvent): void {
    const rect = (event.target as HTMLElement).getBoundingClientRect();
    // Show label immediately while description loads
    this.tooltip.set({ id: adv.id, text: adv.description ?? adv.label, x: rect.left, y: rect.bottom + 6 });
    if (!adv.description) {
      this.advancementsService.getDescription(adv.id).pipe(
        tap(desc => {
          if (!desc) return;
          adv.description = desc;
          // Update tooltip if still showing this chip
          const cur = this.tooltip();
          if (cur?.id === adv.id) this.tooltip.set({ ...cur, text: desc });
          this.cdr.markForCheck();
        }),
      ).subscribe();
    }
  }

  protected onChipLeave(): void {
    this.tooltip.set(null);
  }

  private fetch(): void {
    this.isLoading.set(true);
    this.advancementsService.getAdvancements(this.uuid).pipe(
      tap(r => {
        this.result.set(r);
        this.isLoading.set(false);
        this.loaded = true;
      }),
      catchError(() => { this.isLoading.set(false); return of(null); }),
    ).subscribe();
  }
}

