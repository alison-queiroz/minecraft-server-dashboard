import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { MapViewerComponent } from '../../components/map-viewer/map-viewer.component';
import { UserProfileService, SavedLocation } from '../../services/user-profile/user-profile.service';
import { FormsModule } from '@angular/forms';
import { LucideMap, LucideX } from '@lucide/angular';
import { IconComponent } from '../../components/icon/icon.component';
import { AuthService } from '../../services/auth/auth.service';

@Component({
  selector: 'app-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MapViewerComponent, FormsModule, IconComponent],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.scss'],
})
export class MapComponent {
  protected readonly LucideMap = LucideMap;
  protected readonly LucideX   = LucideX;

  private readonly profileService = inject(UserProfileService);
  protected readonly auth = inject(AuthService);

  /** Fragment from the URL (#world:x:y:z:...) — used when navigating from player cards */
  protected readonly navigateToHash = toSignal(
    inject(ActivatedRoute).fragment.pipe(map(f => f ?? '')),
    { initialValue: '' }
  );

  protected readonly capturedHash = signal('');
  protected readonly showSaveForm = signal(false);
  protected readonly saveName = signal('');
  protected readonly saveDesc = signal('');
  protected readonly savePublic = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saved = signal(false);

  protected onPositionCaptured(hash: string): void {
    this.capturedHash.set(hash);
    this.showSaveForm.set(true);
    this.saved.set(false);
    this.saveError.set(null);
  }

  protected async saveLocation(): Promise<void> {
    const name = this.saveName().trim();
    if (!name) { this.saveError.set('Name is required.'); return; }
    if (!this.auth.currentUser()) { this.saveError.set('Sign in to save locations.'); return; }

    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.profileService.loadProfile();
      await this.profileService.addLocation({
        name,
        mapHash: this.capturedHash(),
        description: this.saveDesc().trim(),
        isPublic: this.savePublic(),
      });
      this.saved.set(true);
      this.showSaveForm.set(false);
      this.saveName.set('');
      this.saveDesc.set('');
      this.savePublic.set(false);
    } catch {
      this.saveError.set('Failed to save. Try again.');
    } finally {
      this.saving.set(false);
    }
  }

  protected cancelSave(): void {
    this.showSaveForm.set(false);
    this.capturedHash.set('');
  }
}
