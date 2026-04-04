import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { UserProfileService } from '../../services/user-profile/user-profile.service';
import { AuthService } from '../../services/auth/auth.service';
import { PlayerService } from '../../services/player/player.service';
import { ProfileAccountsComponent } from '../../components/profile/profile-accounts/profile-accounts.component';
import { MapViewerComponent } from '../../components/shared/map-viewer/map-viewer.component';
import { ProfileLocationsComponent } from '../../components/profile/profile-locations/profile-locations.component';
import { UserAvatarComponent } from '../../components/shared/user-avatar/user-avatar.component';
import { PlayerAdvancementsComponent } from '../../components/player/player-advancements/player-advancements.component';
import { LucideUser, LucideTrophy, LucideMapPin, LucideArrowLeft } from '@lucide/angular';
import { IconComponent } from '../../components/shared/icon/icon.component';

type ProfileTab = 'account' | 'advancements' | 'locations';

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProfileAccountsComponent, MapViewerComponent, ProfileLocationsComponent, UserAvatarComponent, PlayerAdvancementsComponent, IconComponent],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
})
export class ProfileComponent implements OnInit {
  protected readonly profileService = inject(UserProfileService);
  protected readonly auth = inject(AuthService);
  private readonly playerService = inject(PlayerService);

  protected readonly LucideUser      = LucideUser;
  protected readonly LucideTrophy    = LucideTrophy;
  protected readonly LucideMapPin    = LucideMapPin;
  protected readonly LucideArrowLeft = LucideArrowLeft;

  protected readonly activeTab = signal<ProfileTab>('account');
  protected readonly capturedMapHash = signal('');
  protected readonly mapPreviewHash  = signal('');
  protected readonly showMap = signal(false);

  private touchStartX = 0;

  protected readonly linkedJavaPlayer = computed(() => {
    const javaName = this.profileService.minecraftAccounts().java;
    if (!javaName) return null;
    return this.playerService.players().find(p => p.name === javaName && !p.isBedrock()) ?? null;
  });

  protected setTab(tab: ProfileTab): void {
    this.activeTab.set(tab);
    this.showMap.set(false);
  }

  protected onTouchStart(e: TouchEvent): void {
    this.touchStartX = e.touches[0].clientX;
  }

  protected onTouchEnd(e: TouchEvent): void {
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    if (Math.abs(dx) < 50) return;
    const tabs = this.tabOrder();
    const idx = tabs.indexOf(this.activeTab());
    if (dx < 0 && idx < tabs.length - 1) this.setTab(tabs[idx + 1]);
    else if (dx > 0 && idx > 0) this.setTab(tabs[idx - 1]);
  }

  private tabOrder(): ProfileTab[] {
    const t: ProfileTab[] = ['account'];
    if (this.linkedJavaPlayer()) t.push('advancements');
    t.push('locations');
    return t;
  }

  protected previewMap(hash: string): void {
    this.mapPreviewHash.set(hash);
    this.showMap.set(true);
  }

  protected closeMap(): void {
    this.showMap.set(false);
  }

  async ngOnInit(): Promise<void> {
    await this.profileService.loadProfile();
  }
}

