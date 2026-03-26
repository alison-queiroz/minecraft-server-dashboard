import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  ElementRef,
  ViewChild,
  effect,
  OnDestroy,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { PlayerService } from '../../services/player/player.service';
import { SkinService } from '../../services/skin/skin.service';
import { UserProfileService, SavedLocation } from '../../services/user-profile/user-profile.service';
import { environment } from '../../../environments/environment';

declare const skinview3d: any;

@Component({
  selector: 'app-player-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './player-detail.component.html',
  styleUrls: ['./player-detail.component.scss'],
})
export class PlayerDetailComponent implements OnDestroy {
  protected readonly service = inject(PlayerService);
  private readonly skinService = inject(SkinService);
  private readonly userProfileService = inject(UserProfileService);

  protected readonly mapBaseUrl =
    (environment as Record<string, unknown>)['mapBaseUrl'] as string
      ?? 'https://exvegan-minecraft-map.duckdns.org/';

  protected readonly publicLocations = signal<SavedLocation[]>([]);

  @ViewChild('skinContainer', { static: false })
  private skinContainer!: ElementRef<HTMLDivElement>;

  private skinViewer: any = null;
  private currentSkinUrl: string | null = null;
  private pendingSkinUrl: string | null = null;

  private readonly loadPublicLocations = effect(() => {
    const player = this.service.selectedPlayer();
    if (player) {
      this.userProfileService.getPublicLocationsForPlayer(player.name)
        .then(locs => this.publicLocations.set(locs));
    } else {
      this.publicLocations.set([]);
    }
  });

  private readonly updateSkinOnPlayerChange = effect(() => {
    const player = this.service.selectedPlayer();
    if (player?.is_raw_skin) {
      this.skinService.ensureSkinView3dLoaded();
      // Timeout allows Angular to render the @if block first
      setTimeout(() => this.loadAndRender3DSkin(player.skin_url), 50);
    } else {
      this.disposeSkinViewer();
    }
  });

  ngOnDestroy(): void {
    this.disposeSkinViewer();
  }

  private async loadAndRender3DSkin(url: string): Promise<void> {
    this.pendingSkinUrl = url;
    const blobUrl = await this.skinService.getBlobUrl(url);

    // Guard against stale requests (player changed while fetching)
    if (this.pendingSkinUrl !== url) return;

    this.render3DSkin(blobUrl, url);
  }

  private render3DSkin(blobUrl: string, originalUrl: string): void {
    if (!this.skinContainer) return;

    if (typeof skinview3d === 'undefined') {
      setTimeout(() => this.render3DSkin(blobUrl, originalUrl), 100);
      return;
    }

    if (originalUrl === this.currentSkinUrl) return;
    this.currentSkinUrl = originalUrl;

    if (!this.skinViewer) {
      this.skinViewer = new skinview3d.SkinViewer({
        canvas: document.createElement('canvas'),
        width: 220,
        height: 300,
        zoom: 0.62,
        skin: blobUrl,
      });
      this.skinViewer.animation = new skinview3d.IdleAnimation();
      this.skinContainer.nativeElement.innerHTML = '';
      this.skinContainer.nativeElement.appendChild(this.skinViewer.canvas);
    } else {
      this.skinViewer.loadSkin(blobUrl);
    }
  }

  private disposeSkinViewer(): void {
    this.pendingSkinUrl = null;
    this.currentSkinUrl = null;
    if (this.skinViewer) {
      this.skinViewer.dispose();
      this.skinViewer = null;
    }
  }

  protected mapUrl(hash: string): string {
    const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
    return base + (hash.startsWith('#') ? hash : '#' + hash);
  }
}
