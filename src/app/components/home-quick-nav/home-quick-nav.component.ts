import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlayerService } from '../../services/player/player.service';
import { LucideUsers, LucideServer, LucideChevronRight } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-home-quick-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  templateUrl: './home-quick-nav.component.html',
})
export class HomeQuickNavComponent {
  protected readonly LucideUsers        = LucideUsers;
  protected readonly LucideServer       = LucideServer;
  protected readonly LucideChevronRight = LucideChevronRight;

  protected readonly playerService = inject(PlayerService);
}
