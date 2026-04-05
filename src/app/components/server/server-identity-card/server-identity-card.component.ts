import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../../services/server/server.service';
import { ServerIconComponent } from '../../shared/server-icon/server-icon.component';
import { ServerStatusBadgeComponent } from '../../shared/server-status-badge/server-status-badge.component';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';

@Component({
  selector: 'app-server-identity-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ServerIconComponent,
    ServerStatusBadgeComponent,
    UiBadgeComponent,
    UiCardComponent,
  ],
  templateUrl: './server-identity-card.component.html',
  styleUrls: ['./server-identity-card.component.scss'],
})
export class ServerIdentityCardComponent {
  protected readonly serverService = inject(ServerService);
}
