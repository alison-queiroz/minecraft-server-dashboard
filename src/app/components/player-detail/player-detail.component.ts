import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  effect,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { PlayerService } from '../../services/player/player.service';
import { UserProfileService, SavedLocation } from '../../services/user-profile/user-profile.service';
import { SkinViewerComponent } from '../skin-viewer/skin-viewer.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-player-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe, SkinViewerComponent],
  templateUrl: './player-detail.component.html',
  styleUrls: ['./player-detail.component.scss'],
})
export class PlayerDetailComponent {
  protected readonly service = inject(PlayerService);
  private readonly userProfileService = inject(UserProfileService);

  protected readonly mapBaseUrl =
    (environment as Record<string, unknown>)['mapBaseUrl'] as string
      ?? 'https://exvegan-minecraft-map.duckdns.org/';

  protected readonly publicLocations = signal<SavedLocation[]>([]);

  private readonly loadPublicLocations = effect(() => {
    const player = this.service.selectedPlayer();
    if (player) {
      this.userProfileService.getPublicLocationsForPlayer(player.name)
        .then(locs => this.publicLocations.set(locs));
    } else {
      this.publicLocations.set([]);
    }
  });

  protected mapUrl(hash: string): string {
    const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
    return base + (hash.startsWith('#') ? hash : '#' + hash);
  }
}
