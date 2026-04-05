import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ServerHeroBannerComponent } from '../server-hero-banner/server-hero-banner.component';
import { ServerHeroStatsComponent } from '../server-hero-stats/server-hero-stats.component';

@Component({
  selector: 'app-server-hero-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ServerHeroBannerComponent, ServerHeroStatsComponent],
  templateUrl: './server-hero-card.component.html',
  styleUrls: ['./server-hero-card.component.scss'],
})
export class ServerHeroCardComponent {}
