import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';

@Component({
  selector: 'app-server-identity-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  templateUrl: './server-identity-card.component.html',
})
export class ServerIdentityCardComponent {
  protected readonly serverService = inject(ServerService);
  protected readonly serverStatus = SERVER_STATUS;
}
