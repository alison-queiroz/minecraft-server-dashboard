import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { Player } from '../../../services/player/player.model';
import { PlayerFaceComponent } from '../../shared/player-face/player-face.component';
import { TooltipDirective } from '../../../directives/tooltip.directive';
import { DimensionTagComponent } from '../../shared/dimension-tag/dimension-tag.component';

// Avatars need no prefetch here: <app-player-face> renders a lazy <img>, so the
// browser loads each face once, at the displayed size, as the row scrolls in.
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
export class PlayerCardRowComponent {
  @Input({ required: true }) player!: Player;
  @Input() isSelected = false;
  @Output() selected = new EventEmitter<void>();
}
