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
import type { SavedLocation, SavedHome } from '../../../services/user-profile/user-profile.service';
import { UserProfileService } from '../../../services/user-profile/user-profile.service';
import { SkinViewerComponent } from '../../shared/skin-viewer/skin-viewer.component';
import { PlayerAdvancementsComponent } from '../player-advancements/player-advancements.component';
import {
  LucideClock, LucideMapPin, LucideMap, LucideExternalLink, LucideHouse, LucideUser, LucideTimer, LucideShare2,
} from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { CollapsibleSectionComponent } from '../../shared/collapsible-section/collapsible-section.component';
import type { Player } from '../../../services/player/player.model';
import { environment } from '../../../../environments/environment';

/** Maps the API dimension name to the BlueMap world ID used in URL fragments. */
const DIMENSION_MAP: Record<string, string> = {
  'Overworld': 'world',
  'Nether':    'world_nether',
  'The End':   'world_the_end',
};

const HOME_WORLD_LABELS: Record<string, string> = {
  world:          'Overworld',
  world_nether:   'Nether',
  world_the_end:  'The End',
};

@Component({
  selector: 'app-player-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe, SkinViewerComponent, RouterLink, IconComponent, CollapsibleSectionComponent, PlayerAdvancementsComponent],
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

  /** Whether the Saved Locations section is collapsed. Starts collapsed. */
  protected readonly locationsCollapsed = signal(true);
  /** Whether the Homes section is collapsed. Starts collapsed. */
  protected readonly homesCollapsed = signal(true);

  protected readonly service = inject(PlayerService);
  private readonly userProfileService = inject(UserProfileService);

  protected readonly linkCopied = signal(false);

  protected readonly mapBaseUrl =
    environment.mapBaseUrl ?? 'https://exvegan-minecraft-map.duckdns.org/';

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

  protected readonly publicHomes = toSignal(
    toObservable(this.service.selectedPlayer).pipe(
      switchMap(player =>
        player
          ? this.userProfileService.getPublicHomesStream(player.name)
          : of([] as SavedHome[])
      )
    ),
    { initialValue: [] as SavedHome[] }
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
    void navigator.clipboard.writeText(url).then(() => {
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    });
  }

  /** Builds a BlueMap fragment from a home's coordinates. */
  protected homeFragment(home: SavedHome): string {
    const x = Math.round(home.x);
    const y = Math.round(home.y) + 2;
    const z = Math.round(home.z);
    return `${home.world}:${x}:${y}:${z}:0:0.36:500:0:0:free`;
  }

  /** Returns a human-readable world label for a home's world id. */
  protected homeWorldLabel(world: string): string {
    return HOME_WORLD_LABELS[world] ?? world;
  }

  /** Strips a leading "PlayerName:" prefix from a stored home name. */
  protected homeDisplayName(name: string): string {
    const colon = name.indexOf(':');
    return colon !== -1 ? name.slice(colon + 1) : name;
  }
}
