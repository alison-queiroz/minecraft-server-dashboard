import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ServerService, SERVER_STATUS } from '../../../services/server/server.service';
import { LucideInfo, LucideGrid3x3 } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';
import { UiStatItemComponent } from '../../../shared/ui/ui-stat-item/ui-stat-item.component';

@Component({
  selector: 'app-server-bedrock-card',
  standalone: true,
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    UiBadgeComponent,
    UiCardComponent,
    UiStatItemComponent,
  ],
  templateUrl: './server-bedrock-card.component.html',
  styleUrls: ['./server-bedrock-card.component.scss'],
})
export class ServerBedrockCardComponent {
  protected readonly LucideInfo    = LucideInfo;
  protected readonly LucideGrid3x3 = LucideGrid3x3;

  protected readonly serverService = inject(ServerService);
  protected readonly serverStatus = SERVER_STATUS;

  protected readonly bedrockStatusVariant = computed<'success' | 'danger' | 'warning'>(() => {
    if (this.serverService.bedrockStatus() === this.serverStatus.ONLINE) {
      return 'success';
    }

    if (this.serverService.bedrockStatus() === this.serverStatus.OFFLINE) {
      return 'danger';
    }

    return 'warning';
  });
}
