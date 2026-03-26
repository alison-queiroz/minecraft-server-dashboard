import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  inject,
  signal,
  OnInit,
  computed,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { UserProfileService, SavedLocation, AccountType } from '../../services/user-profile/user-profile.service';
import { AuthService } from '../../services/auth/auth.service';
import { PlayerService } from '../../services/player/player.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
})
export class ProfileComponent implements OnInit {
  protected readonly profileService = inject(UserProfileService);
  protected readonly auth = inject(AuthService);
  protected readonly playerService = inject(PlayerService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly mapBaseUrl =
    (environment as Record<string, unknown>)['mapBaseUrl'] as string
      ?? 'https://exvegan-minecraft-map.duckdns.org/';

  // ---- Account linking -----------------------------------------------------
  protected readonly accountInputs = signal({ java: '', bedrock: '', admin: '' });
  protected readonly savingAccount = signal<AccountType | null>(null);
  protected readonly accountError = signal<string | null>(null);

  protected readonly knownPlayers = computed(() =>
    this.playerService.players().map(p => p.name)
  );

  // ---- Map iframe ----------------------------------------------------------
  @ViewChild('mapIframe') private mapIframe?: ElementRef<HTMLIFrameElement>;

  protected readonly showMap = signal(false);
  protected readonly mapSrc = signal<SafeResourceUrl>(
    this.sanitizer.bypassSecurityTrustResourceUrl(this.mapBaseUrl)
  );
  protected readonly captureInput = signal('');
  protected readonly showCaptureInput = signal(false);

  // ---- Location management -------------------------------------------------
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

  async ngOnInit(): Promise<void> {
    await this.profileService.loadProfile();
    const accts = this.profileService.minecraftAccounts();
    this.accountInputs.set({
      java: accts.java ?? '',
      bedrock: accts.bedrock ?? '',
      admin: accts.admin ?? '',
    });
  }

  // ---- Account linking -----------------------------------------------------

  protected updateAccountInput(type: AccountType, value: string): void {
    this.accountInputs.update(v => ({ ...v, [type]: value }));
  }

  protected async saveAccount(type: AccountType): Promise<void> {
    const username = this.accountInputs()[type].trim();
    if (!username) { this.accountError.set('Please enter a username.'); return; }
    this.accountError.set(null);
    this.savingAccount.set(type);
    try {
      await this.profileService.linkAccount(type, username);
    } finally {
      this.savingAccount.set(null);
    }
  }

  // ---- Map iframe ----------------------------------------------------------

  protected toggleMap(): void {
    this.showMap.update(v => !v);
  }

  protected viewLocationOnMap(hash: string): void {
    const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
    const url = base + (hash.startsWith('#') ? hash : '#' + hash);
    this.mapSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    this.showMap.set(true);
  }

  protected capturePosition(): void {
    try {
      const href = this.mapIframe?.nativeElement?.contentWindow?.location?.href;
      if (href && href !== 'about:blank') {
        this.newLocHash.set(this.normaliseHash(href));
        this.showAddForm.set(true);
        this.showCaptureInput.set(false);
        return;
      }
    } catch {
      // cross-origin: map not yet proxied, show paste fallback
    }
    this.showCaptureInput.set(true);
  }

  protected applyCapturedUrl(): void {
    const raw = this.captureInput().trim();
    if (!raw) return;
    const hash = this.normaliseHash(raw);
    this.newLocHash.set(hash);
    this.showCaptureInput.set(false);
    this.captureInput.set('');
    this.showAddForm.set(true);
  }

  // ---- Add location --------------------------------------------------------

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

  // ---- Edit location -------------------------------------------------------

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

  // ---- Helpers -------------------------------------------------------------

  protected mapUrl(hash: string): string {
    const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
    return base + (hash.startsWith('#') ? hash : '#' + hash);
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
