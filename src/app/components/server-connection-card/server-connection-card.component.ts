import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { ServerService } from '../../services/server/server.service';

@Component({
  selector: 'app-server-connection-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  templateUrl: './server-connection-card.component.html',
})
export class ServerConnectionCardComponent {
  protected readonly serverService = inject(ServerService);
  protected readonly copied = signal(false);
  protected readonly copiedIp = signal(false);

  protected copyAddress(): void {
    const address = this.serverService.hostname() || 'exvegan.duckdns.org';
    navigator.clipboard.writeText(address).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  protected copyIp(): void {
    const ip = this.serverService.ip() || '';
    if (!ip) return;
    navigator.clipboard.writeText(ip).then(() => {
      this.copiedIp.set(true);
      setTimeout(() => this.copiedIp.set(false), 2000);
    });
  }
}
