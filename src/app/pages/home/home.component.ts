import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgClass } from '@angular/common';
import { ServerService } from '../../services/server/server.service';
import { PlayerService } from '../../services/player/player.service';
import { ServerIconComponent } from '../../components/server-icon/server-icon.component';
import { ServerStatusBadgeComponent } from '../../components/server-status-badge/server-status-badge.component';
import { TagChipComponent } from '../../components/tag-chip/tag-chip.component';
import { LucideWifi, LucideServer, LucideUsers, LucideChevronRight } from '@lucide/angular';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgClass, ServerIconComponent, ServerStatusBadgeComponent, TagChipComponent, IconComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
  protected readonly LucideWifi         = LucideWifi;
  protected readonly LucideServer       = LucideServer;
  protected readonly LucideUsers        = LucideUsers;
  protected readonly LucideChevronRight = LucideChevronRight;

  protected readonly serverService = inject(ServerService);
  protected readonly playerService = inject(PlayerService);
  protected readonly copied = signal(false);

  copyAddress(): void {
    const address = this.serverService.hostname() || 'exvegan.duckdns.org';
    navigator.clipboard.writeText(address).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
