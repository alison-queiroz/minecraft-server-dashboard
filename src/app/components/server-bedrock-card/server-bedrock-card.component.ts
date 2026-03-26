import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgClass } from '@angular/common';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';
import { LucideInfo } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-server-bedrock-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, IconComponent],
  templateUrl: './server-bedrock-card.component.html',
})
export class ServerBedrockCardComponent {
  protected readonly LucideInfo = LucideInfo;

  protected readonly serverService = inject(ServerService);
  protected readonly serverStatus = SERVER_STATUS;
}
