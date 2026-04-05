import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideHouse, LucideMoon, LucideServer, LucideSun, LucideUsers, LucideUserRound,
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
import { UiBadgeComponent } from '../../../shared/ui/ui-badge/ui-badge.component';
import { UiIconButtonComponent } from '../../../shared/ui/ui-icon-button/ui-icon-button.component';

@Component({
  selector: 'app-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    ServerIconComponent,
    UserAvatarComponent,
    ServerStatusBadgeComponent,
    IconComponent,
    UiBadgeComponent,
    UiIconButtonComponent,
  ],
  templateUrl: './nav.component.html',
  styleUrls: ['./nav.component.scss'],
})
export class NavComponent {
  protected readonly LucideHouse    = LucideHouse;
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

  protected readonly serverService: ServerService = inject(ServerService);
  protected readonly auth: AuthService = inject(AuthService);
  protected readonly themeService: ThemeService = inject(ThemeService);
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
