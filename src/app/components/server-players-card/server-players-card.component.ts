import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../services/server/server.service';
import { PlayerService } from '../../services/player/player.service';

@Component({
  selector: 'app-server-players-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './server-players-card.component.html',
})
export class ServerPlayersCardComponent {
  protected readonly serverService = inject(ServerService);
  protected readonly playerService = inject(PlayerService);

  get playersPercent(): number {
    const max = this.serverService.maxPlayers();
    return max > 0 ? (this.serverService.onlinePlayers() / max) * 100 : 0;
  }
}
