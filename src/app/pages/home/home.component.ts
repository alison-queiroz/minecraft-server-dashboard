import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ServerHeroBannerComponent } from '../../components/server/server-hero-banner/server-hero-banner.component';
import { ServerPlayersCardComponent } from '../../components/server/server-players-card/server-players-card.component';
import { ServerConnectionCardComponent } from '../../components/server/server-connection-card/server-connection-card.component';
import { ServerBedrockCardComponent } from '../../components/server/server-bedrock-card/server-bedrock-card.component';
import { ServerDetailsCardComponent } from '../../components/server/server-details-card/server-details-card.component';
import { ServerMotdCardComponent } from '../../components/server/server-motd-card/server-motd-card.component';
import { PageContainerComponent } from '../../components/shared/page-container/page-container.component';

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ServerHeroBannerComponent,
    ServerPlayersCardComponent,
    ServerConnectionCardComponent,
    ServerBedrockCardComponent,
    ServerDetailsCardComponent,
    ServerMotdCardComponent,
    PageContainerComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent {}
