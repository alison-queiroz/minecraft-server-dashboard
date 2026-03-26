import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../services/server/server.service';
import { ServerIconComponent } from '../server-icon/server-icon.component';
import { ServerStatusBadgeComponent } from '../server-status-badge/server-status-badge.component';
import { TagChipComponent } from '../tag-chip/tag-chip.component';

@Component({
  selector: 'app-server-hero-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ServerIconComponent, ServerStatusBadgeComponent, TagChipComponent],
  templateUrl: './server-hero-banner.component.html',
})
export class ServerHeroBannerComponent {
  protected readonly serverService = inject(ServerService);
}
