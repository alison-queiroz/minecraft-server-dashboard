import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';
import { PlayerService } from '../../services/player/player.service';

@Component({
  selector: 'app-server-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, RouterLink],
  templateUrl: './server-status.component.html',
  styleUrls: ['./server-status.component.scss'],
})
export class ServerStatusComponent {
  protected readonly serverService = inject(ServerService);
  protected readonly playerService = inject(PlayerService);
  protected readonly serverStatus = SERVER_STATUS;
  protected readonly copied = signal(false);
  protected readonly copiedIp = signal(false);

  copyAddress(): void {
    const address = this.serverService.hostname() || 'exvegan.duckdns.org';
    navigator.clipboard.writeText(address).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  copyIp(): void {
    const ip = this.serverService.ip() || '';
    if (!ip) return;
    navigator.clipboard.writeText(ip).then(() => {
      this.copiedIp.set(true);
      setTimeout(() => this.copiedIp.set(false), 2000);
    });
  }

  get playersPercent(): number {
    const max = this.serverService.maxPlayers();
    return max > 0 ? (this.serverService.onlinePlayers() / max) * 100 : 0;
  }
}
