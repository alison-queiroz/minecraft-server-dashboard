import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { PlayerService } from '../../services/player/player.service';
import { UserProfileService, SavedLocation } from '../../services/user-profile/user-profile.service';
import { SkinViewerComponent } from '../skin-viewer/skin-viewer.component';
import {
  LucideClock, LucideMapPin, LucideMap, LucideExternalLink, LucideHouse, LucideUser,
} from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-player-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe, SkinViewerComponent, RouterLink, IconComponent],
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

  protected readonly service = inject(PlayerService);
  private readonly userProfileService = inject(UserProfileService);

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

  protected mapUrl(hash: string): string {
    const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
    return base + (hash.startsWith('#') ? hash : '#' + hash);
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
}
