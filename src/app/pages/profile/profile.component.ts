import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { UserProfileService } from '../../services/user-profile/user-profile.service';
import { AuthService } from '../../services/auth/auth.service';
import { PlayerService } from '../../services/player/player.service';
import { ActivatedRoute, Router } from '@angular/router';
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly LucideUser      = LucideUser;
  protected readonly LucideTrophy    = LucideTrophy;
  protected readonly LucideMapPin    = LucideMapPin;
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

  private touchStartX = 0;
  private touchStartY = 0;
  private isDraggingHorizontal = false;

  protected readonly linkedJavaPlayer = computed(() => {
    const javaName = this.profileService.minecraftAccounts().java;
    if (!javaName) return null;
    return this.playerService.players().find(p => p.name === javaName && !p.isBedrock()) ?? null;
  });

  constructor() {
    // Keep the URL query param in sync with the active tab so refresh restores state
    effect(() => {
      const tab = this.activeTab();
      this.router.navigate([], {
        replaceUrl: true,
        queryParams: tab !== 'account' ? { tab } : {},
      });
    });
  }

  protected setTab(tab: ProfileTab): void {
    this.activeTab.set(tab);
    this.showMap.set(false);
  }

  protected onTouchStart(e: TouchEvent): void {
    const touch = e.touches.item(0);
    if (!touch) return;
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.isDraggingHorizontal = false;
  }

  protected onTouchMove(e: TouchEvent): void {
    const touch = e.touches.item(0);
    if (!touch) return;
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;
    if (!this.isDraggingHorizontal) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      this.isDraggingHorizontal = true;
    }
    const tabs = this.tabOrder();
    const idx = tabs.indexOf(this.activeTab());
    // At left edge swiping right, or at right edge swiping left — let global handle it
    if (dx > 0 && idx === 0) return;
    if (dx < 0 && idx === tabs.length - 1) return;
    e.stopPropagation();
    this.isTabDragging.set(true);
    this.dragTabX.set(dx);
  }

  protected onTouchEnd(e: TouchEvent): void {
    const wasDragging = this.isDraggingHorizontal;
    this.isTabDragging.set(false);
    this.dragTabX.set(0);

    if (!wasDragging) return;

    const touch = e.changedTouches.item(0);
    if (!touch) return;
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;
    const threshold = window.innerWidth * 0.5;
    if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) return;

    const tabs = this.tabOrder();
    const idx = tabs.indexOf(this.activeTab());

    if (dx < 0) {
      if (idx < tabs.length - 1) {
        e.stopPropagation();
        this.enterTab.set('right');
        const nextTab = tabs[idx + 1];
        if (!nextTab) return;
        this.setTab(nextTab);
        setTimeout(() => this.enterTab.set(null), 350);
      }
      // else: at right edge — don't stop propagation, let global navigate to /map
    } else {
      if (idx > 0) {
        e.stopPropagation();
        this.enterTab.set('left');
        const prevTab = tabs[idx - 1];
        if (!prevTab) return;
        this.setTab(prevTab);
        setTimeout(() => this.enterTab.set(null), 350);
      }
      // else: at left edge — don't stop propagation, let global navigate to /players
    }
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
    // Restore tab from URL query param on refresh
    const tab = this.route.snapshot.queryParamMap.get('tab') as ProfileTab | null;
    if (tab && ['account', 'advancements', 'locations'].includes(tab)) {
      this.activeTab.set(tab);
    }
    await this.profileService.loadProfile();
  }
}

