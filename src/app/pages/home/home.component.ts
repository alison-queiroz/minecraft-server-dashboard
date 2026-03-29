import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ServerHeroCardComponent } from '../../components/server/server-hero-card/server-hero-card.component';
import { HomeConnectCardComponent } from '../../components/home/home-connect-card/home-connect-card.component';
import { HomeQuickNavComponent } from '../../components/home/home-quick-nav/home-quick-nav.component';
import { ServerBedrockCardComponent } from 'src/app/components/server/server-bedrock-card/server-bedrock-card.component';

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ServerHeroCardComponent,
    HomeConnectCardComponent,
    HomeQuickNavComponent,
    ServerBedrockCardComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent {}
