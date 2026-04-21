import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideMoon, LucideServer, LucideSun, LucideUsers, LucideUserRound,
  LucideMap, LucideX, LucideMenu,
  LucideDatabase, LucideChartLine,
} from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { ServerService } from '../../../services/server/server.service';
import { AuthService } from '../../../services/auth/auth.service';
import { ThemeService } from '../../../services/theme/theme.service';
import { ServerIconComponent } from '../../shared/server-icon/server-icon.component';
import { UserAvatarComponent } from '../../shared/user-avatar/user-avatar.component';
import { ServerStatusBadgeComponent } from '../../shared/server-status-badge/server-status-badge.component';
import { IconHomeComponent } from '../../shared/icon-home/icon-home.component';

@Component({
  selector: 'app-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, ServerIconComponent, UserAvatarComponent, ServerStatusBadgeComponent, IconComponent, IconHomeComponent],
  templateUrl: './nav.component.html',
  styleUrls: ['./nav.component.scss'],
})
export class NavComponent {
  protected readonly LucideMoon     = LucideMoon;
  protected readonly LucideServer   = LucideServer;
  protected readonly LucideSun      = LucideSun;
  protected readonly LucideUsers    = LucideUsers;
  protected readonly LucideUserRound = LucideUserRound;
  protected readonly LucideMap      = LucideMap;
  protected readonly LucideX        = LucideX;
  protected readonly LucideMenu     = LucideMenu;
  protected readonly LucideDatabase = LucideDatabase;
  protected readonly LucideChartLine = LucideChartLine;
  protected readonly LucideServiceHub = LucideServer;

  protected readonly serverService = inject(ServerService);
  protected readonly auth = inject(AuthService);
  protected readonly themeService = inject(ThemeService);
  protected readonly menuOpen = signal(false);

  toggleMenu(): void {
    this.menuOpen.update(v => !v);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  async signOut(): Promise<void> {
    this.menuOpen.set(false);
    await this.auth.signOut();
  }
}
