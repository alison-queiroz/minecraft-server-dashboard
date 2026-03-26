import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideMessageSquare } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';
import { ServerService } from '../../services/server/server.service';

@Component({
  selector: 'app-server-motd-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './server-motd-card.component.html',
})
export class ServerMotdCardComponent {
  protected readonly LucideMessageSquare = LucideMessageSquare;
  protected readonly serverService = inject(ServerService);
}
