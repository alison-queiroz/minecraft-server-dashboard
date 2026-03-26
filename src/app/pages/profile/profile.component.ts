import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { UserProfileService } from '../../services/user-profile/user-profile.service';
import { AuthService } from '../../services/auth/auth.service';
import { ProfileAccountsComponent } from '../../components/profile/profile-accounts/profile-accounts.component';
import { MapViewerComponent } from '../../components/shared/map-viewer/map-viewer.component';
import { ProfileLocationsComponent } from '../../components/profile/profile-locations/profile-locations.component';
import { UserAvatarComponent } from '../../components/shared/user-avatar/user-avatar.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ProfileAccountsComponent, MapViewerComponent, ProfileLocationsComponent, UserAvatarComponent],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
})
export class ProfileComponent implements OnInit {
  protected readonly profileService = inject(UserProfileService);
  protected readonly auth = inject(AuthService);

  /** Hash emitted by MapViewerComponent when the user captures a position */
  protected readonly capturedMapHash = signal('');
  /** Hash emitted by ProfileLocationsComponent when the user wants to preview a location */
  protected readonly mapPreviewHash = signal('');

  async ngOnInit(): Promise<void> {
    await this.profileService.loadProfile();
  }
}

