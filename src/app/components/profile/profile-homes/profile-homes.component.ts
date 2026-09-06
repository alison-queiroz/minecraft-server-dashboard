import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { EssentialsHome } from '../../../services/player/player.model';
import { LucideHouse, LucidePencil, LucideTrash2, LucideCheck, LucideRefreshCw, LucideMap, LucideExternalLink } from '@lucide/angular';
import { IconComponent } from '../../shared/icon/icon.component';
import { IconButtonComponent } from '../../shared/icon-button/icon-button.component';
import { InlineErrorComponent } from '../../shared/inline-error/inline-error.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { CollapsibleSectionComponent } from '../../shared/collapsible-section/collapsible-section.component';
import { ActionButtonComponent } from '../../shared/action-button/action-button.component';
import { ProfileItemCardComponent } from '../profile-item-card/profile-item-card.component';
import { DimensionTagComponent } from '../../shared/dimension-tag/dimension-tag.component';
import { MapViewerComponent } from '../../shared/map-viewer/map-viewer.component';
import { UiToggleComponent } from '../../shared/ui-toggle/ui-toggle.component';
import { SaveButtonComponent } from '../../shared/save-button/save-button.component';
import { CancelButtonComponent } from '../../shared/cancel-button/cancel-button.component';
import { IconHomeComponent } from '../../shared/icon-home/icon-home.component';
import { UiInputComponent } from '../../shared/ui-input/ui-input.component';
import type { Player } from '../../../services/player/player.model';
import { environment } from '../../../../environments/environment';
import { UserProfileService } from '../../../services/user-profile/user-profile.service';

export const WORLD_OPTIONS = [
  { value: 'world',        label: 'Overworld' },
  { value: 'world_nether', label: 'Nether' },
  { value: 'world_the_end', label: 'The End' },
] as const;

/** A home loaded from the Python backend, enriched with a local-only isPublic preference. */
export interface LocalHome extends EssentialsHome {
  /** Equals `name` — used as a stable template key. */
  id: string;
  /** Local-only visibility preference. Not persisted across page loads. */
  isPublic: boolean;
}

@Component({
  selector: 'app-profile-homes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, IconButtonComponent, InlineErrorComponent, EmptyStateComponent, CollapsibleSectionComponent, ActionButtonComponent, DecimalPipe, ProfileItemCardComponent, DimensionTagComponent, MapViewerComponent, UiToggleComponent, SaveButtonComponent, CancelButtonComponent, IconHomeComponent, UiInputComponent],
  templateUrl: './profile-homes.component.html',
  styleUrls: ['./profile-homes.component.scss'],
})
export class ProfileHomesComponent {
  protected readonly LucideHouse      = LucideHouse;
  protected readonly LucidePencil     = LucidePencil;
  protected readonly LucideTrash2     = LucideTrash2;
  protected readonly LucideCheck      = LucideCheck;
  protected readonly LucideRefreshCw  = LucideRefreshCw;
  protected readonly LucideMap        = LucideMap;
  protected readonly LucideExternalLink = LucideExternalLink;

  private readonly http = inject(HttpClient);
  private readonly userProfileService = inject(UserProfileService);

  protected readonly mapBaseUrl = environment.mapBaseUrl ?? 'https://exvegan-minecraft-map.duckdns.org/';

  /** All linked players (Java + Admin). Bedrock-only is skipped since EssentialsX is Java-only. */
  readonly players = input<Player[]>([]);

  /** Emits a BlueMap hash when the user wants to preview a home on the embedded map. */
  @Output() previewRequested = new EventEmitter<string>();

  /** Source of truth: homes loaded directly from the Python backend. No Firestore involved. */
  protected readonly homes = signal<LocalHome[]>([]);

  /**
   * Homes grouped by character name for display.
   * When only one Java player is linked the group header is hidden.
   */
  protected readonly groupedHomes = computed(() => {
    const homes = this.homes();
    const javaPlayers = this.players().filter(p => !p.isBedrock());
    if (javaPlayers.length <= 1) {
      return [{ playerName: null as string | null, homes }];
    }
    const groups = javaPlayers.map(p => ({
      playerName: p.name,
      homes: homes.filter(h => h.name.startsWith(`${p.name}:`)),
    }));
    const prefixed = new Set(javaPlayers.map(p => `${p.name}:`));
    const ungrouped = homes.filter(h => ![...prefixed].some(pr => h.name.startsWith(pr)));
    if (ungrouped.length) groups.push({ playerName: 'Other', homes: ungrouped });
    return groups;
  });

  /** Display name strips the character prefix when present. */
  protected homeDisplayName(homeName: string): string {
    const colon = homeName.indexOf(':');
    return colon !== -1 ? homeName.slice(colon + 1) : homeName;
  }

  protected readonly worldOptions = WORLD_OPTIONS;

  /** Set of playerName values whose home group is currently collapsed. */
  protected readonly collapsedGroups = signal<Set<string>>(new Set());

  protected readonly showAddForm  = signal(false);
  protected readonly newName      = signal('');
  protected readonly newX         = signal('');
  protected readonly newY         = signal('');
  protected readonly newZ         = signal('');
  protected readonly newWorld     = signal('world');
  protected readonly newPublic    = signal(false);
  protected readonly newMapHash   = signal('');  // drives the map picker iframe
  protected readonly addError     = signal<string | null>(null);
  protected readonly saving       = signal(false);
  protected readonly syncing      = signal(false);

  protected readonly editingId    = signal<string | null>(null);
  protected readonly editPublic   = signal(false);

  /** Stable identity of the linked Java players — reloads key off this, not the
   * array reference (which changes on every live player tick). */
  private readonly linkedJavaKey = computed(() =>
    this.players().filter(p => !p.isBedrock()).map(p => p.uuid).sort().join(','));
  private _lastLoadedKey = '';
  private _loadInFlight = false;

  constructor() {
    effect(() => {
      const key = this.linkedJavaKey();
      // Only (re)load when the set of linked Java players actually changes.
      // Depending on players() directly would re-run on every onSnapshot tick
      // (new array reference), re-fetching all homes and rewriting Firestore
      // continuously while the tab is open.
      if (!key || key === this._lastLoadedKey) return;
      this._lastLoadedKey = key;
      void this._loadFromServer();
    });
  }

  /** Loads all homes from the Python API and populates the local signal. No Firestore writes. */
  private async _loadFromServer(): Promise<void> {
    if (this._loadInFlight) return;  // guard against overlapping loads racing on this.homes()
    this._loadInFlight = true;
    this.syncing.set(true);
    try {
      const raw = await this._fetchAllPlayerHomes();
      // Restore isPublic: existing local state has priority (mid-session refresh),
      // then fall back to Firestore (page reload / first open), then default false.
      const prevLocal = new Map(this.homes().map(h => [h.id, h.isPublic]));
      const firestoreByName = new Map(
        this.userProfileService.savedHomes().map(h => [h.name, h.isPublic])
      );
      this.homes.set(raw.map(h => ({
        ...h,
        id: h.name,
        isPublic: prevLocal.has(h.name)
          ? (prevLocal.get(h.name) ?? false)
          : (firestoreByName.get(h.name) ?? false),
      })));
      // Keep Firestore in sync: adds new homes, updates coords that changed in-game.
      await this.userProfileService.upsertHomesFromLocal(this.homes());
    } finally {
      this.syncing.set(false);
      this._loadInFlight = false;
    }
  }

  async syncFromServer(): Promise<void> {
    await this._loadFromServer();
  }

  async refreshFromServer(): Promise<void> {
    await this._loadFromServer();
  }

  /** Fetch the player's homes directly from the API endpoint. */
  private async fetchServerHomes(uuid: string): Promise<EssentialsHome[]> {
    try {
      return await firstValueFrom(
        this.http.get<EssentialsHome[]>(`/api/players/${uuid}/homes`)
      );
    } catch {
      return [];
    }
  }

  /** Fetches homes for all linked players, namespacing by character name to avoid collisions. */
  private async _fetchAllPlayerHomes(): Promise<EssentialsHome[]> {
    const results: EssentialsHome[] = [];
    for (const p of this.players()) {
      if (p.isBedrock()) continue; // EssentialsX only manages Java players
      const homes = await this.fetchServerHomes(p.uuid);
      for (const h of homes) {
        // Prefix with player name when multiple Java accounts are linked
        const prefix = this.players().filter(pl => !pl.isBedrock()).length > 1
          ? `${p.name}:` : '';
        results.push({ ...h, name: prefix + h.name });
      }
    }
    return results;
  }

  protected toggleGroup(playerName: string): void {
    this.collapsedGroups.update(s => {
      const next = new Set(s);
      if (next.has(playerName)) { next.delete(playerName); } else { next.add(playerName); }
      return next;
    });
  }

  protected isGroupCollapsed(playerName: string): boolean {
    return this.collapsedGroups().has(playerName);
  }

  protected toggleAddForm(): void {
    this.showAddForm.update(v => !v);
    this.addError.set(null);
    this.newName.set('');
    this.newX.set('');
    this.newY.set('');
    this.newZ.set('');
    this.newWorld.set('world');
    this.newPublic.set(false);
    this.newMapHash.set('');
  }

  /** Called by the map picker when the user pins a location. */
  protected onMapCapture(hash: string): void {
    // Parse x/z/world from a BlueMap hash: #world:x:y:z:pitch:yaw:distance:...
    const stripped = hash.startsWith('#') ? hash.slice(1) : hash;
    const parts = stripped.split(':');
    if (parts.length >= 4) {
      const [world, xStr, yStr, zStr] = parts;
      if (world) this.newWorld.set(world === 'world_nether' ? 'world_nether' : world === 'world_the_end' ? 'world_the_end' : 'world');
      if (xStr) this.newX.set(String(Math.round(parseFloat(xStr))));
      if (yStr) this.newY.set(String(Math.round(parseFloat(yStr))));
      if (zStr) this.newZ.set(String(Math.round(parseFloat(zStr))));
    }
  }

  protected async addHome(): Promise<void> {
    const javaPlayers = this.players().filter(p => !p.isBedrock());
    if (!javaPlayers.length) return;
    const name = this.newName().trim();
    const x = parseFloat(this.newX());
    const y = parseFloat(this.newY());
    const z = parseFloat(this.newZ());
    if (!name) { this.addError.set('Home name is required.'); return; }
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      this.addError.set('X, Y and Z must be valid numbers.');
      return;
    }
    // When multiple Java accounts are linked, adds to the first one.
    // To target a specific account use /sethome in-game.
    const [player] = javaPlayers;
    if (!player) return;
    this.addError.set(null);
    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.post(`/api/players/${player.uuid}/homes`, { name, x, y, z, world: this.newWorld() })
      );
      const prefix = javaPlayers.length > 1 ? `${player.name}:` : '';
      const storedName = prefix + name;
      this.homes.update(hs => [...hs, {
        id: storedName, name: storedName, x, y, z,
        world: this.newWorld(), isPublic: this.newPublic(),
      }]);
      void this.userProfileService.upsertHomesFromLocal(this.homes());
      this.showAddForm.set(false);
    } catch {
      this.addError.set('Failed to create home on server.');
    } finally {
      this.saving.set(false);
    }
  }

  protected startEdit(home: LocalHome): void {
    this.editingId.set(home.id);
    this.editPublic.set(home.isPublic);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected async saveEdit(id: string): Promise<void> {
    this.saving.set(true);
    try {
      this.homes.update(hs => hs.map(h => h.id === id ? { ...h, isPublic: this.editPublic() } : h));
      await this.userProfileService.upsertHomesFromLocal(this.homes());
      this.editingId.set(null);
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteHome(home: LocalHome): Promise<void> {
    if (!confirm('Remove this home from the server?')) return;
    const target = this._resolveServerTarget(home.name);
    if (target) {
      try {
        await firstValueFrom(
          this.http.delete(
            `/api/players/${target.uuid}/homes/${encodeURIComponent(target.serverName)}`,
          )
        );
      } catch (err) {
        console.warn('Failed to delete server home:', err);
        return;
      }
    }
    this.homes.update(hs => hs.filter(h => h.id !== home.id));
    void this.userProfileService.deleteHomeByName(home.name);
  }

  /**
   * Resolves a stored home name (which may carry a "PlayerName:" prefix) to the
   * matching player UUID and the bare server-side home name.
   * Returns null when no Java player can be matched.
   */
  private _resolveServerTarget(storedName: string): { uuid: string; serverName: string } | null {
    const javaPlayers = this.players().filter(p => !p.isBedrock());
    if (!javaPlayers.length) return null;
    if (javaPlayers.length === 1) {
      const [first] = javaPlayers;
      if (!first) return null;
      return { uuid: first.uuid, serverName: storedName };
    }
    // Multi-account: match by "PlayerName:" prefix
    const owner = javaPlayers.find(p => storedName.startsWith(`${p.name}:`));
    if (!owner) return null;
    return { uuid: owner.uuid, serverName: storedName.slice(owner.name.length + 1) };
  }

  protected setAllVisible(isPublic: boolean): void {
    this.homes.update(hs => hs.map(h => ({ ...h, isPublic })));
    void this.userProfileService.upsertHomesFromLocal(this.homes());
  }

  /** Builds a BlueMap hash fragment for a home's coordinates. */
  protected homeMapHash(home: LocalHome): string {
    const x = Math.round(home.x);
    const y = Math.round(home.y) + 2;
    const z = Math.round(home.z);
    return `#${home.world}:${x}:${y}:${z}:0:0.36:1.5:0:0:free`;
  }

  /** Full BlueMap URL for a home. */
  protected homeMapUrl(home: LocalHome): string {
    const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
    return base + this.homeMapHash(home);
  }

  protected previewHomeOnMap(home: LocalHome): void {
    this.previewRequested.emit(this.homeMapHash(home));
  }

  protected allPublic(): boolean {
    const homes = this.homes();
    return homes.length > 0 && homes.every(h => h.isPublic);
  }
}
