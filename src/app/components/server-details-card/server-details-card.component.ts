import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../services/server/server.service';
import { LucideInfo } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-server-details-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './server-details-card.component.html',
})
export class ServerDetailsCardComponent {
  protected readonly LucideInfo = LucideInfo;

  protected readonly serverService = inject(ServerService);
}
