import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../../services/server/server.service';
import { ServerIconComponent } from '../../shared/server-icon/server-icon.component';
import { ServerStatusBadgeComponent } from '../../shared/server-status-badge/server-status-badge.component';
import { TagChipComponent } from '../../shared/tag-chip/tag-chip.component';

@Component({
  selector: 'app-server-identity-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ServerIconComponent, ServerStatusBadgeComponent, TagChipComponent],
  templateUrl: './server-identity-card.component.html',
  styleUrls: ['./server-identity-card.component.scss'],
})
export class ServerIdentityCardComponent {
  protected readonly serverService = inject(ServerService);
}
