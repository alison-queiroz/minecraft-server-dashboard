import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../services/server/server.service';

@Component({
  selector: 'app-server-details-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './server-details-card.component.html',
})
export class ServerDetailsCardComponent {
  protected readonly serverService = inject(ServerService);
}
