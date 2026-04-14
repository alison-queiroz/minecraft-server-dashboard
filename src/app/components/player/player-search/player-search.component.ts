import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideSearch } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { PlayerService } from '../../../services/player/player.service';

@Component({
  selector: 'app-player-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './player-search.component.html',
  styleUrls: ['./player-search.component.scss'],
})
export class PlayerSearchComponent {
  protected readonly LucideSearch = LucideSearch;
  protected readonly service = inject(PlayerService);
}
