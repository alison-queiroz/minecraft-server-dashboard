import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  protected readonly hasSelection = computed(() => !!this.playerService.selectedPlayerName());

  ngOnInit(): void {
    const name = this.route.snapshot.queryParamMap.get('player');
    if (name) {
      this.playerService.selectedPlayerName.set(decodeURIComponent(name));
    }
  }
}
