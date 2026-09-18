import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ServerService } from '../../../services/server/server.service';
import { LucideUsers } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-server-players-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './server-players-card.component.html',
  styleUrls: ['./server-players-card.component.scss'],
})
export class ServerPlayersCardComponent {
  protected readonly LucideUsers = LucideUsers;

  protected readonly serverService = inject(ServerService);

  // computed (not a getter) so it isn't recomputed on every change-detection pass.
  readonly playersPercent = computed(() => {
    const max = this.serverService.maxPlayers();
    return max > 0 ? (this.serverService.onlinePlayers() / max) * 100 : 0;
  });
}
