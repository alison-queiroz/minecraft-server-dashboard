import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../../services/server/server.service';
import { ServerIconComponent } from '../../shared/server-icon/server-icon.component';
import { ServerStatusBadgeComponent } from '../../shared/server-status-badge/server-status-badge.component';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';

@Component({
  selector: 'app-server-hero-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ServerIconComponent, ServerStatusBadgeComponent, UiBadgeComponent],
  templateUrl: './server-hero-banner.component.html',
  styleUrls: ['./server-hero-banner.component.scss'],
})
export class ServerHeroBannerComponent {
  protected readonly serverService = inject(ServerService);
}
