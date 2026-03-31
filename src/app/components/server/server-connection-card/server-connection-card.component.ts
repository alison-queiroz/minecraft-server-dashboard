import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideWifi, LucideGlobe, LucideServer } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { CopyButtonComponent } from '../../shared/copy-button/copy-button.component';
import { ServerService } from '../../../services/server/server.service';

@Component({
  selector: 'app-server-connection-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, CopyButtonComponent],
  templateUrl: './server-connection-card.component.html',
  styleUrls: ['./server-connection-card.component.scss'],
})
export class ServerConnectionCardComponent {
  protected readonly LucideWifi   = LucideWifi;
  protected readonly LucideGlobe  = LucideGlobe;
  protected readonly LucideServer = LucideServer;

  protected readonly serverService = inject(ServerService);
}
