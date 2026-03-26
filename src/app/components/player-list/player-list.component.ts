import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { Player } from '../../services/player/player.model';
import { PlayerService } from '../../services/player/player.service';
import { PlayerSearchComponent } from '../player-search/player-search.component';
import { PlayerCardRowComponent } from '../player-card-row/player-card-row.component';

@Component({
  selector: 'app-player-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ScrollingModule, PlayerSearchComponent, PlayerCardRowComponent],
  templateUrl: './player-list.component.html',
  styleUrls: ['./player-list.component.scss'],
})
export class PlayerListComponent implements AfterViewInit, OnDestroy {
  protected readonly service = inject(PlayerService);
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  @ViewChild(CdkVirtualScrollViewport) private readonly viewport!: CdkVirtualScrollViewport;

  private resizeObserver!: ResizeObserver;

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
