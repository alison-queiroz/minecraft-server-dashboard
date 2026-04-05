import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideWifi, LucideServer } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { CopyButtonComponent } from '../../shared/copy-button/copy-button.component';
import { ServerService } from '../../../services/server/server.service';
import { UiCardComponent } from '../../../shared/ui/ui-card/ui-card.component';

@Component({
  selector: 'app-home-connect-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, CopyButtonComponent, UiCardComponent],
  templateUrl: './home-connect-card.component.html',
  styleUrls: ['./home-connect-card.component.scss'],
})
export class HomeConnectCardComponent {
  protected readonly LucideWifi   = LucideWifi;
  protected readonly LucideServer = LucideServer;

  protected readonly serverService = inject(ServerService);
}
