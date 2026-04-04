import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { NgClass, DecimalPipe } from '@angular/common';
import { Player } from '../../../services/player/player.model';
import { PlayerService } from '../../../services/player/player.service';
import { PlayerFaceComponent } from '../../shared/player-face/player-face.component';

@Component({
  selector: 'app-player-card-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, DecimalPipe, PlayerFaceComponent],
  templateUrl: './player-card-row.component.html',
  styleUrls: ['./player-card-row.component.scss'],
  host: {
    class: 'grid grid-cols-12 items-center py-3 px-6 hover:bg-emerald-500/5 cursor-pointer transition-all border-b border-zinc-800/50 group',
    '[class.bg-emerald-500/10]': 'isSelected',
    '(click)': 'selected.emit()',
  },
})
export class PlayerCardRowComponent implements OnInit, OnDestroy {
  protected readonly playerService = inject(PlayerService);
  private readonly elementRef = inject(ElementRef);

  @Input({ required: true }) player!: Player;
  @Input() isSelected = false;
  @Output() selected = new EventEmitter<void>();

  private observer?: IntersectionObserver;

  ngOnInit(): void {
    // Only players with mc-heads.net URLs need an HTTP fetch; raw skins are CSS backgrounds
    if (this.player.isRawAvatar()) return;

    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.playerService.fetchAvatarIfNeeded(this.player.avatarUrl(64));
          this.observer?.disconnect();
          this.observer = undefined;
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
