import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';
import { ServerIdentityCardComponent } from '../../components/server/server-identity-card/server-identity-card.component';
import { ServerPlayersCardComponent } from '../../components/server/server-players-card/server-players-card.component';
import { ServerConnectionCardComponent } from '../../components/server/server-connection-card/server-connection-card.component';
import { ServerDetailsCardComponent } from '../../components/server/server-details-card/server-details-card.component';
import { ServerBedrockCardComponent } from '../../components/server/server-bedrock-card/server-bedrock-card.component';
import { ServerMotdCardComponent } from '../../components/server/server-motd-card/server-motd-card.component';
import { PlayersCta } from '../../components/server/players-cta/players-cta.component';
import { LucideChevronLeft } from '@lucide/angular';
import { IconComponent } from '../../components/shared/icon/icon.component';

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
    ServerMotdCardComponent,
    PlayersCta,
    IconComponent,
  ],
  templateUrl: './server-status.component.html',
  styleUrls: ['./server-status.component.scss'],
})
export class ServerStatusComponent {
  protected readonly LucideChevronLeft = LucideChevronLeft;

  protected readonly serverService = inject(ServerService);
  protected readonly serverStatus = SERVER_STATUS;
}
