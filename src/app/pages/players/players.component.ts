import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PlayerService } from '../../services/player/player.service';
import { PlayerListComponent } from '../../components/player-list/player-list.component';
import { PlayerDetailComponent } from '../../components/player-detail/player-detail.component';

@Component({
  selector: 'app-players',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerListComponent, PlayerDetailComponent],
  templateUrl: './players.component.html',
  styleUrls: ['./players.component.scss'],
})
export class PlayersComponent {
  protected readonly playerService = inject(PlayerService);
}
