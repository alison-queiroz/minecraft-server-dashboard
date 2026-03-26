import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../services/server/server.service';
import { PlayerService } from '../../services/player/player.service';

@Component({
  selector: 'app-server-hero-stats',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './server-hero-stats.component.html',
})
export class ServerHeroStatsComponent {
  protected readonly serverService = inject(ServerService);
  protected readonly playerService = inject(PlayerService);
}
