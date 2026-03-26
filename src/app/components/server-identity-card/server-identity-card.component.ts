import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../services/server/server.service';
import { ServerIconComponent } from '../server-icon/server-icon.component';
import { ServerStatusBadgeComponent } from '../server-status-badge/server-status-badge.component';
import { TagChipComponent } from '../tag-chip/tag-chip.component';

@Component({
  selector: 'app-server-identity-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ServerIconComponent, ServerStatusBadgeComponent, TagChipComponent],
  templateUrl: './server-identity-card.component.html',
})
export class ServerIdentityCardComponent {
  protected readonly serverService = inject(ServerService);
}
