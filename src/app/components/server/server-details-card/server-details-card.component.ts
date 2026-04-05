import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ServerService } from '../../../services/server/server.service';
import { LucideInfo } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiStatItemComponent } from '../../../shared/ui/ui-stat-item/ui-stat-item.component';

@Component({
  selector: 'app-server-details-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, UiCardComponent, UiStatItemComponent],
  templateUrl: './server-details-card.component.html',
  styleUrls: ['./server-details-card.component.scss'],
})
export class ServerDetailsCardComponent {
  protected readonly LucideInfo = LucideInfo;

  protected readonly serverService = inject(ServerService);
}
