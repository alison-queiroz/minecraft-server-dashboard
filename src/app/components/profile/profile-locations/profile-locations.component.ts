import {
  ChangeDetectionStrategy,
  Component,
  effect,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import type { SavedLocation } from '../../../services/user-profile/user-profile.service';
import { UserProfileService } from '../../../services/user-profile/user-profile.service';
import { LucideMap, LucideExternalLink, LucidePencil, LucideTrash2 } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { MapViewerComponent } from '../../shared/map-viewer/map-viewer.component';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-profile-locations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MapViewerComponent],
  templateUrl: './profile-locations.component.html',
  styleUrls: ['./profile-locations.component.scss'],
})
export class ProfileLocationsComponent {
  protected readonly LucideMap         = LucideMap;
  protected readonly LucideExternalLink = LucideExternalLink;
  protected readonly LucidePencil      = LucidePencil;
  protected readonly LucideTrash2      = LucideTrash2;

  protected readonly profileService = inject(UserProfileService);

  protected readonly mapBaseUrl =
    environment.mapBaseUrl ?? '/map/';

  /** Pre-fill the add form with a captured map hash */
  @Input()
  set capturedHash(value: string) {
    this.capturedHashInput.set(value);
  }

  /** Emits a hash when the user wants to preview a location on the embedded map */
  @Output() previewRequested = new EventEmitter<string>();

  protected readonly showAddForm = signal(false);
  protected readonly newLocName = signal('');
  protected readonly newLocHash = signal('');
  protected readonly newLocMapHash = signal('');  // drives the map iframe
  protected readonly newLocDesc = signal('');
  protected readonly newLocPublic = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editHash = signal('');
  protected readonly editDesc = signal('');
  protected readonly editPublic = signal(false);
  private readonly capturedHashInput = signal('');

  constructor() {
    effect(() => {
      const capturedHash = this.capturedHashInput();
      if (!capturedHash) {
        return;
      }

      this.newLocHash.set(capturedHash);
      this.showAddForm.set(true);
      this.addError.set(null);
    });
  }

  protected toggleAddForm(): void {
    this.showAddForm.update(v => !v);
    this.addError.set(null);
    this.newLocName.set('');
    this.newLocHash.set('');
    this.newLocMapHash.set('');
    this.newLocDesc.set('');
    this.newLocPublic.set(false);
  }

  protected onMapCapture(hash: string): void {
    this.newLocHash.set(hash);
  }

  protected async addLocation(): Promise<void> {
    const name = this.newLocName().trim();
    const mapHash = this.newLocHash().trim();
    if (!name || !mapHash) { this.addError.set('Name and Map Link are required.'); return; }
    this.addError.set(null);
    this.saving.set(true);
    try {
      await this.profileService.addLocation({
        name,
        mapHash: this.normaliseHash(mapHash),
        description: this.newLocDesc().trim(),
        isPublic: this.newLocPublic(),
      });
      this.showAddForm.set(false);
    } finally {
      this.saving.set(false);
    }
  }

  protected startEdit(loc: SavedLocation): void {
    this.editingId.set(loc.id);
    this.editName.set(loc.name);
    this.editHash.set(loc.mapHash);
    this.editDesc.set(loc.description);
    this.editPublic.set(loc.isPublic);
  }

  protected cancelEdit(): void { this.editingId.set(null); }

  protected async saveEdit(id: string): Promise<void> {
    this.saving.set(true);
    try {
      await this.profileService.updateLocation(id, {
        name: this.editName().trim(),
        mapHash: this.normaliseHash(this.editHash().trim()),
        description: this.editDesc().trim(),
        isPublic: this.editPublic(),
      });
      this.editingId.set(null);
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteLocation(id: string): Promise<void> {
    if (!confirm('Delete this location?')) return;
    await this.profileService.deleteLocation(id);
  }

  protected mapUrl(hash: string): string {
    const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
    return base + (hash.startsWith('#') ? hash : '#' + hash);
  }

  protected previewOnMap(hash: string): void {
    this.previewRequested.emit(hash);
  }

  private normaliseHash(input: string): string {
    try {
      const url = new URL(input);
      return url.hash || input;
    } catch {
      return input.startsWith('#') ? input : '#' + input;
    }
  }
}
