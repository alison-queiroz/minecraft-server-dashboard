import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { UserProfileService, SavedLocation } from '../../services/user-profile/user-profile.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-profile-locations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './profile-locations.component.html',
  styleUrls: ['./profile-locations.component.scss'],
})
export class ProfileLocationsComponent implements OnChanges {
  protected readonly profileService = inject(UserProfileService);

  protected readonly mapBaseUrl =
    (environment as Record<string, unknown>)['mapBaseUrl'] as string
      ?? '/map/';

  /** Pre-fill the add form with a captured map hash */
  @Input() capturedHash = '';

  /** Emits a hash when the user wants to preview a location on the embedded map */
  @Output() previewRequested = new EventEmitter<string>();

  protected readonly showAddForm = signal(false);
  protected readonly newLocName = signal('');
  protected readonly newLocHash = signal('');
  protected readonly newLocDesc = signal('');
  protected readonly newLocPublic = signal(false);
  protected readonly addError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editHash = signal('');
  protected readonly editDesc = signal('');
  protected readonly editPublic = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['capturedHash'] && this.capturedHash) {
      this.newLocHash.set(this.capturedHash);
      this.showAddForm.set(true);
      this.addError.set(null);
    }
  }

  protected toggleAddForm(): void {
    this.showAddForm.update(v => !v);
    this.addError.set(null);
    this.newLocName.set('');
    this.newLocHash.set('');
    this.newLocDesc.set('');
    this.newLocPublic.set(false);
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
