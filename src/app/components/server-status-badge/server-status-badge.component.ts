import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';

@Component({
  selector: 'app-server-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'size',
    '[attr.data-status]': 'serverService.status()',
  },
  templateUrl: './server-status-badge.component.html',
  styleUrls: ['./server-status-badge.component.scss'],
})
export class ServerStatusBadgeComponent {
  /** sm = nav/home size, lg = server-identity-card size */
  @Input() size: 'sm' | 'lg' = 'sm';
  /** Hide the text label on mobile (shows only on sm: breakpoint and above) */
  @Input() mobileHideLabel = false;

  protected readonly serverService = inject(ServerService);
  protected readonly serverStatus = SERVER_STATUS;
}
