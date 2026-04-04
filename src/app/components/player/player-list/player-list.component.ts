import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { LucideChevronUp, LucideChevronDown } from '@lucide/angular';
import { Player } from '../../../services/player/player.model';
import { PlayerService } from '../../../services/player/player.service';
import { PlayerSearchComponent } from '../player-search/player-search.component';
import { PlayerCardRowComponent } from '../player-card-row/player-card-row.component';
import { IconComponent } from '../../shared/icon/icon.component';

type SortField = 'name' | 'level' | 'play_hours' | 'dimension' | 'last_seen' | 'advancement_count';
type SortDir = 'asc' | 'desc';

@Component({
  selector: 'app-player-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ScrollingModule, PlayerSearchComponent, PlayerCardRowComponent, IconComponent],
  templateUrl: './player-list.component.html',
  styleUrls: ['./player-list.component.scss'],
})
export class PlayerListComponent implements AfterViewInit, OnDestroy {
  protected readonly service = inject(PlayerService);
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  @ViewChild(CdkVirtualScrollViewport) private readonly viewport!: CdkVirtualScrollViewport;

  private resizeObserver!: ResizeObserver;

  protected readonly LucideChevronUp   = LucideChevronUp;
  protected readonly LucideChevronDown = LucideChevronDown;

  protected readonly sortField = signal<SortField>('level');
  protected readonly sortDir   = signal<SortDir>('desc');

  protected readonly displayedPlayers = computed(() => {
    const players = this.service.filteredPlayers();
    const field   = this.sortField();
    const dir     = this.sortDir();
    return [...players].sort((a, b) => {
      let cmp = 0;
      switch (field) {
        case 'name':              cmp = a.name.localeCompare(b.name); break;
        case 'level':             cmp = a.level - b.level; break;
        case 'dimension':         cmp = a.dimension.localeCompare(b.dimension); break;
        case 'last_seen':         cmp = a.last_seen.localeCompare(b.last_seen); break;
        case 'play_hours':        cmp = (a.play_hours ?? 0) - (b.play_hours ?? 0); break;
        case 'advancement_count': cmp = (a.advancement_count ?? 0) - (b.advancement_count ?? 0); break;
      }
      return dir === 'desc' ? -cmp : cmp;
    });
  });

  protected toggleSort(field: SortField): void {
    if (this.sortField() === field) {
      this.sortDir.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDir.set('desc');
    }
  }

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.viewport?.checkViewportSize();
    });
    this.resizeObserver.observe(this.hostRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  protected trackByUuid(_index: number, player: Player): string {
    return player.uuid;
  }
}

