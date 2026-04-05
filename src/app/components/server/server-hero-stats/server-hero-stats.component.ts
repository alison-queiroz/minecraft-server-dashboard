import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../../services/server/server.service';
import { PlayerService } from '../../../services/player/player.service';
import { UiStatItemComponent } from '../../../shared/ui/ui-stat-item/ui-stat-item.component';

@Component({
  selector: 'app-server-hero-stats',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiStatItemComponent],
  templateUrl: './server-hero-stats.component.html',
  styleUrls: ['./server-hero-stats.component.scss'],
})
export class ServerHeroStatsComponent {
  protected readonly serverService = inject(ServerService);
  protected readonly playerService = inject(PlayerService);
}
