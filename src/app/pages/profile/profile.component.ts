import type {
  OnInit} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { UserProfileService } from '../../services/user-profile/user-profile.service';
import { AuthService } from '../../services/auth/auth.service';
import { PlayerService } from '../../services/player/player.service';
import type { Player } from '../../services/player/player.model';
import { ActivatedRoute, Router } from '@angular/router';
import { ProfileAccountsComponent } from '../../components/profile/profile-accounts/profile-accounts.component';
import { MapViewerComponent } from '../../components/shared/map-viewer/map-viewer.component';
import { ProfileLocationsComponent } from '../../components/profile/profile-locations/profile-locations.component';
import { ProfileHomesComponent } from '../../components/profile/profile-homes/profile-homes.component';
import { UserAvatarComponent } from '../../components/shared/user-avatar/user-avatar.component';
import { PlayerAdvancementsComponent } from '../../components/player/player-advancements/player-advancements.component';
import { LucideUser, LucideTrophy, LucideArrowLeft } from '@lucide/angular';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { IconHomeComponent } from '../../components/shared/icon-home/icon-home.component';
import { IconMapPinComponent } from '../../components/shared/icon-map-pin/icon-map-pin.component';
import { SwipeNavigateModule } from '../../directives/swipe-navigate.module';
import { SWIPE_ANIMATION_RESET_MS } from '../../constants/ui.constants';
import { PageContainerComponent } from '../../components/shared/page-container/page-container.component';

type ProfileTab = 'account' | 'advancements' | 'locations' | 'homes';
const PROFILE_TABS: readonly ProfileTab[] = ['account', 'advancements', 'locations', 'homes'];

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ProfileAccountsComponent,
    MapViewerComponent,
    ProfileLocationsComponent,
    ProfileHomesComponent,
    UserAvatarComponent,
    PlayerAdvancementsComponent,
    IconComponent,
    IconHomeComponent,
    IconMapPinComponent,
    SwipeNavigateModule,
    PageContainerComponent,
  ],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
})
export class ProfileComponent implements OnInit {
  protected readonly profileService = inject(UserProfileService);
  protected readonly auth = inject(AuthService);
  private readonly playerService = inject(PlayerService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly LucideUser      = LucideUser;
  protected readonly LucideTrophy    = LucideTrophy;
  protected readonly LucideArrowLeft = LucideArrowLeft;

  protected readonly activeTab = signal<ProfileTab>('account');
  protected readonly capturedMapHash = signal('');
  protected readonly mapPreviewHash  = signal('');
  protected readonly showMap = signal(false);

  /** Tab drag offset for swipe animation */
  protected readonly dragTabX = signal(0);
  protected readonly isTabDragging = signal(false);
  /** Drives slide-in keyframe after tab commit (mirrors global enterFrom) */
  protected readonly enterTab = signal<'left' | 'right' | null>(null);

  protected readonly tabOrder = computed<ProfileTab[]>(() => {
    const tabs: ProfileTab[] = ['account'];
    if (this.linkedJavaPlayer()) {
      tabs.push('advancements');
    }
    tabs.push('locations');
    tabs.push('homes');
    return tabs;
  });

  protected readonly activeTabIndex = computed(() => this.tabOrder().indexOf(this.activeTab()));

  protected readonly linkedJavaPlayer = computed(() => {
    const javaName = this.profileService.minecraftAccounts().java;
    if (!javaName) return null;
    return this.playerService.players().find(p => p.name === javaName && !p.isBedrock()) ?? null;
  });

  /** All linked Java + Admin players for the Homes tab. Bedrock excluded (EssentialsX is Java-only). */
  protected readonly linkedPlayers = computed(() => {
    const { java, admin } = this.profileService.minecraftAccounts();
    const all = this.playerService.players();
    const names = [java, admin].filter((n): n is string => !!n);
    return names.map(name => all.find(p => p.name === name && !p.isBedrock())).filter((p): p is Player => !!p);
  });

  constructor() {
    // Keep the URL query param in sync with the active tab so refresh restores state
    effect(() => {
      const tab = this.activeTab();
      void this.router.navigate([], {
        replaceUrl: true,
        queryParams: tab !== 'account' ? { tab } : {},
      });
    });
  }

  protected setTab(tab: ProfileTab): void {
    this.activeTab.set(tab);
    this.showMap.set(false);
  }

  protected onTabDragXChange(value: number): void {
    this.dragTabX.set(value);
  }

  protected onTabDraggingChange(value: boolean): void {
    this.isTabDragging.set(value);
  }

  protected onTabNavigateDirection(direction: 'left' | 'right'): void {
    this.dragTabX.set(0);
    this.enterTab.set(direction);

    const currentIndex = this.activeTabIndex();
    const nextIndex = direction === 'right' ? currentIndex + 1 : currentIndex - 1;
    const nextTab = this.tabOrder()[nextIndex];
    if (!nextTab) {
      return;
    }

    this.setTab(nextTab);
    setTimeout(() => this.enterTab.set(null), SWIPE_ANIMATION_RESET_MS);
  }

  protected previewMap(hash: string): void {
    this.mapPreviewHash.set(hash);
    this.showMap.set(true);
  }

  protected closeMap(): void {
    this.showMap.set(false);
  }

  async ngOnInit(): Promise<void> {
    // Restore tab from URL query param on refresh
    const tab = this.route.snapshot.queryParamMap.get('tab') as ProfileTab | null;
    if (tab && PROFILE_TABS.includes(tab)) {
      this.activeTab.set(tab);
    }
    await this.profileService.loadProfile();
  }
}

