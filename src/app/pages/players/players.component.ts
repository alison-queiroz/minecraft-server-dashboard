import type { OnInit} from '@angular/core';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PlayerService } from '../../services/player/player.service';
import { PlayerListComponent } from '../../components/player/player-list/player-list.component';
import { PlayerDetailComponent } from '../../components/player/player-detail/player-detail.component';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { LucideArrowLeft } from '@lucide/angular';

@Component({
  selector: 'app-players',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerListComponent, PlayerDetailComponent, IconComponent],
  templateUrl: './players.component.html',
  styleUrls: ['./players.component.scss'],
})
export class PlayersComponent implements OnInit {
  protected readonly LucideArrowLeft = LucideArrowLeft;
  protected readonly playerService = inject(PlayerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly hasSelection = computed(() => !!this.playerService.selectedPlayerName());

  constructor() {
    // Keep the URL query param in sync with the selected player so refresh restores state
    effect(() => {
      const name = this.playerService.selectedPlayerName();
      void this.router.navigate([], {
        replaceUrl: true,
        queryParams: name ? { player: name } : {},
      });
    });
  }

  ngOnInit(): void {
    const name = this.route.snapshot.queryParamMap.get('player');
    if (name) {
      this.playerService.selectedPlayerName.set(decodeURIComponent(name));
    }
  }
}
