import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';

@Component({
  selector: 'app-server-bedrock-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  templateUrl: './server-bedrock-card.component.html',
})
export class ServerBedrockCardComponent {
  protected readonly serverService = inject(ServerService);
  protected readonly serverStatus = SERVER_STATUS;
}
