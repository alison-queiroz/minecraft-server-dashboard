import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';
import { PlayerService } from '../../services/player/player.service';
import { ServerIdentityCardComponent } from '../../components/server-identity-card/server-identity-card.component';
import { ServerPlayersCardComponent } from '../../components/server-players-card/server-players-card.component';
import { ServerConnectionCardComponent } from '../../components/server-connection-card/server-connection-card.component';
import { ServerDetailsCardComponent } from '../../components/server-details-card/server-details-card.component';
import { ServerBedrockCardComponent } from '../../components/server-bedrock-card/server-bedrock-card.component';
import { LucideUsers, LucideChevronRight } from '@lucide/angular';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-server-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ServerIdentityCardComponent,
    ServerPlayersCardComponent,
    ServerConnectionCardComponent,
    ServerDetailsCardComponent,
    ServerBedrockCardComponent,
    IconComponent,
  ],
  templateUrl: './server-status.component.html',
  styleUrls: ['./server-status.component.scss'],
})
export class ServerStatusComponent {
  protected readonly LucideUsers        = LucideUsers;
  protected readonly LucideChevronRight = LucideChevronRight;

  protected readonly serverService = inject(ServerService);
  protected readonly playerService = inject(PlayerService);
  protected readonly serverStatus = SERVER_STATUS;
}
