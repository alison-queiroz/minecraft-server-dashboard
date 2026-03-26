import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgClass } from '@angular/common';
import { ServerService, SERVER_STATUS } from '../../services/server/server.service';
import { PlayerService } from '../../services/player/player.service';

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgClass],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
  protected readonly serverService = inject(ServerService);
  protected readonly playerService = inject(PlayerService);
  protected readonly serverStatus = SERVER_STATUS;
  protected readonly copied = signal(false);

  copyAddress(): void {
    const address = this.serverService.hostname() || 'exvegan.duckdns.org';
    navigator.clipboard.writeText(address).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
