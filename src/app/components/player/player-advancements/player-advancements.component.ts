import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { LucideTrophy, LucideChevronDown } from '@lucide/angular';
import { AdvancementsService, AdvancementsResult } from '../../../services/advancements/advancements.service';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-player-advancements',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IconComponent],
  templateUrl: './player-advancements.component.html',
  styleUrls: ['./player-advancements.component.scss'],
})
export class PlayerAdvancementsComponent implements OnChanges {
  @Input({ required: true }) uuid = '';
  @Input() isBedrock = false;
  @Input() set initialCount(v: number | undefined) { this._initialCount.set(v ?? 0); }

  private readonly advancementsService = inject(AdvancementsService);

  protected readonly LucideTrophy     = LucideTrophy;
  protected readonly LucideChevronDown = LucideChevronDown;
  protected readonly objectKeys = Object.keys;

  private readonly _initialCount = signal(0);
  protected readonly collapsed = signal(true);
  protected readonly isLoading = signal(false);
  protected readonly result    = signal<AdvancementsResult>({ completed: [], total: 0, by_category: {} });
  /** Shows the loaded total when available, otherwise falls back to the Firestore-cached count. */
  protected readonly displayCount = computed(() =>
    this.result().total > 0 ? this.result().total : this._initialCount());

  private loaded = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['uuid'] || changes['isBedrock']) {
      this.loaded = false;
      this.collapsed.set(true);
      this.result.set({ completed: [], total: 0, by_category: {} });
    }
  }

  protected toggle(): void {
    const opening = this.collapsed();
    this.collapsed.set(!opening);
    if (opening && !this.loaded && !this.isBedrock && this.uuid) {
      this.fetch();
    }
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
