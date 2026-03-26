import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideWifi, LucideServer } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { ServerService } from '../../../services/server/server.service';

@Component({
  selector: 'app-home-connect-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, IconComponent],
  templateUrl: './home-connect-card.component.html',
})
export class HomeConnectCardComponent {
  protected readonly LucideWifi   = LucideWifi;
  protected readonly LucideServer = LucideServer;

  protected readonly serverService = inject(ServerService);
  protected readonly copied = signal(false);

  protected copyAddress(): void {
    const address = this.serverService.hostname() || 'exvegan.duckdns.org';
    navigator.clipboard.writeText(address).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
