import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { PlayerService } from '../../../services/player/player.service';
import { UserProfileService, SavedLocation } from '../../../services/user-profile/user-profile.service';
import { SkinViewerComponent } from '../../shared/skin-viewer/skin-viewer.component';
import { PlayerAdvancementsComponent } from '../player-advancements/player-advancements.component';
import {
  LucideClock, LucideMapPin, LucideMap, LucideExternalLink, LucideHouse, LucideUser, LucideTimer, LucideShare2,
} from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { Player } from '../../../services/player/player.model';
import { environment } from '../../../../environments/environment';

/** Maps the API dimension name to the BlueMap world ID used in URL fragments. */
const DIMENSION_MAP: Record<string, string> = {
  'Overworld': 'world',
  'Nether':    'world_nether',
  'The End':   'world_the_end',
};

@Component({
  selector: 'app-player-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe, SkinViewerComponent, RouterLink, IconComponent, PlayerAdvancementsComponent],
  templateUrl: './player-detail.component.html',
  styleUrls: ['./player-detail.component.scss'],
})
export class PlayerDetailComponent {
  protected readonly LucideClock        = LucideClock;
  protected readonly LucideMapPin       = LucideMapPin;
  protected readonly LucideMap          = LucideMap;
  protected readonly LucideExternalLink = LucideExternalLink;
  protected readonly LucideHouse        = LucideHouse;
  protected readonly LucideUser         = LucideUser;
  protected readonly LucideTimer        = LucideTimer;
  protected readonly LucideShare2       = LucideShare2;

  protected readonly service = inject(PlayerService);
  private readonly userProfileService = inject(UserProfileService);

  protected readonly linkCopied = signal(false);

  protected readonly mapBaseUrl =
    (environment as Record<string, unknown>)['mapBaseUrl'] as string
      ?? 'https://exvegan-minecraft-map.duckdns.org/';

  protected readonly publicLocations = toSignal(
    toObservable(this.service.selectedPlayer).pipe(
      switchMap(player =>
        player
          ? this.userProfileService.getPublicLocationsStream(player.name)
          : of([] as SavedLocation[])
      )
    ),
    { initialValue: [] as SavedLocation[] }
  );

  /** Builds a BlueMap fragment from the player's position.
   *  Format: worldId:x:y:z:yaw:pitch:distance:orbitAngle:mode */
  protected playerMapFragment(player: Player): string {
    const mapId = DIMENSION_MAP[player.dimension] ?? 'world';
    const x = Math.round(player.pos[0] ?? 0);
    const y = Math.round(player.pos[1] ?? 0) + 2;
    const z = Math.round(player.pos[2] ?? 0);
    return `${mapId}:${x}:${y}:${z}:0:0.36:1.33:0:0:free`;
  }

  /** Extracts the fragment (text after #) from a map hash string for Angular routerLink */
  protected locFragment(hash: string): string {
    return hash.startsWith('#') ? hash.slice(1) : hash;
  }

  /** Extracts the fragment (text after #) from a full Dynmap URL for use with routerLink */
  protected houseFragment(url: string): string {
    const i = url.indexOf('#');
    return i >= 0 ? url.slice(i + 1) : '';
  }

  /** Copies a shareable link for this player card to the clipboard. */
  protected share(player: Player): void {
    const url = `${window.location.origin}/players?player=${encodeURIComponent(player.name)}`;
    navigator.clipboard.writeText(url).then(() => {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    });
  }
}
