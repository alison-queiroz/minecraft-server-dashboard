import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { Player } from '../../services/player/player.model';
import { PlayerService } from '../../services/player/player.service';
import { inject } from '@angular/core';

@Component({
  selector: 'app-player-card-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  templateUrl: './player-card-row.component.html',
  styleUrls: ['./player-card-row.component.scss'],
  host: {
    class: 'grid grid-cols-12 items-center py-3 px-6 hover:bg-emerald-500/5 cursor-pointer transition-all border-b border-zinc-800/50 group',
    '[class.bg-emerald-500/10]': 'isSelected',
    '(click)': 'select.emit()',
  },
})
export class PlayerCardRowComponent {
  protected readonly playerService = inject(PlayerService);

  @Input({ required: true }) player!: Player;
  @Input() isSelected = false;
  @Output() select = new EventEmitter<void>();
}
