import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideUsers, LucideChevronRight } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { PlayerService } from '../../../services/player/player.service';
import { UiListItemComponent } from '../../../shared/ui/ui-list-item/ui-list-item.component';

@Component({
  selector: 'app-players-cta',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, UiListItemComponent],
  host: { class: 'block' },
  templateUrl: './players-cta.component.html',
  styleUrls: ['./players-cta.component.scss'],
})
export class PlayersCta {
  protected readonly LucideUsers        = LucideUsers;
  protected readonly LucideChevronRight = LucideChevronRight;

  protected readonly playerService = inject(PlayerService);
}
