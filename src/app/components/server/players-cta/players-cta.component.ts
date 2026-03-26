import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideUsers, LucideChevronRight } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { PlayerService } from '../../../services/player/player.service';

@Component({
  selector: 'app-players-cta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
  host: { class: 'block' },
  templateUrl: './players-cta.component.html',
})
export class PlayersCta {
  protected readonly LucideUsers        = LucideUsers;
  protected readonly LucideChevronRight = LucideChevronRight;

  protected readonly playerService = inject(PlayerService);
}
