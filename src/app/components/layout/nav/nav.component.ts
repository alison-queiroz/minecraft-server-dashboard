import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideHouse, LucideServer, LucideUsers, LucideUserRound,
  LucideMap, LucideX, LucideMenu,
  LucideDatabase,
} from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { ServerService } from '../../../services/server/server.service';
import { AuthService } from '../../../services/auth/auth.service';
import { ServerIconComponent } from '../../shared/server-icon/server-icon.component';
import { UserAvatarComponent } from '../../shared/user-avatar/user-avatar.component';
import { ServerStatusBadgeComponent } from '../../shared/server-status-badge/server-status-badge.component';

@Component({
  selector: 'app-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, ServerIconComponent, UserAvatarComponent, ServerStatusBadgeComponent, IconComponent],
  templateUrl: './nav.component.html',
  styleUrls: ['./nav.component.scss'],
})
export class NavComponent {
  protected readonly LucideHouse    = LucideHouse;
  protected readonly LucideServer   = LucideServer;
  protected readonly LucideUsers    = LucideUsers;
  protected readonly LucideUserRound = LucideUserRound;
  protected readonly LucideMap      = LucideMap;
  protected readonly LucideX        = LucideX;
  protected readonly LucideMenu     = LucideMenu;
  protected readonly LucideDatabase = LucideDatabase;

  protected readonly serverService = inject(ServerService);
  protected readonly auth = inject(AuthService);
  protected readonly menuOpen = signal(false);

  toggleMenu(): void {
    this.menuOpen.update(v => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  async signOut(): Promise<void> {
    this.menuOpen.set(false);
    await this.auth.signOut();
  }
}
