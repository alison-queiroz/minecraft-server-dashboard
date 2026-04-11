import type {
  OnDestroy,
  OnInit} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  inject,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { Player } from '../../../services/player/player.model';
import { PlayerService } from '../../../services/player/player.service';
import { PlayerFaceComponent } from '../../shared/player-face/player-face.component';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import { DimensionTagComponent } from '../../shared/dimension-tag/dimension-tag.component';

@Component({
  selector: 'app-player-card-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, PlayerFaceComponent, TooltipDirective, DimensionTagComponent],
  templateUrl: './player-card-row.component.html',
  styleUrls: ['./player-card-row.component.scss'],
  host: {
    class: 'group grid grid-cols-12 items-center border-b border-stone-200/70 px-6 py-3 transition-all hover:bg-emerald-500/5 dark:border-zinc-800/50 cursor-pointer',
    '[class.bg-emerald-500/10]': 'isSelected',
    '(click)': 'selected.emit()',
  },
})
export class PlayerCardRowComponent implements OnInit, OnDestroy {
  protected readonly playerService = inject(PlayerService);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  @Input({ required: true }) player!: Player;
  @Input() isSelected = false;
  @Output() selected = new EventEmitter<void>();

  private observer: IntersectionObserver | null = null;

  ngOnInit(): void {
    // Only players with mc-heads.net URLs need an HTTP fetch; raw skins are CSS backgrounds
    if (this.player.isRawAvatar()) return;

    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          this.playerService.fetchAvatarIfNeeded(this.player.avatarUrl(64));
          this.observer?.disconnect();
          this.observer = null;
        }
      },
      { threshold: 0 }
    );
    this.observer.observe(this.elementRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
