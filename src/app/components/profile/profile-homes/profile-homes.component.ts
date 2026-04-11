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
import { ProfileItemCardComponent } from '../profile-item-card/profile-item-card.component';
import { DimensionTagComponent } from '../../shared/dimension-tag/dimension-tag.component';
import type { Player } from '../../../services/player/player.model';
import { environment } from '../../../../environments/environment';

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
  imports: [IconComponent, DecimalPipe, ProfileItemCardComponent, DimensionTagComponent],
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

  protected readonly showAddForm  = signal(false);
  protected readonly newName      = signal('');
  protected readonly newX         = signal('');
  protected readonly newY         = signal('');
  protected readonly newZ         = signal('');
  protected readonly newWorld     = signal('world');
  protected readonly newPublic    = signal(false);
  protected readonly addError     = signal<string | null>(null);
  protected readonly saving       = signal(false);
  protected readonly syncing      = signal(false);

  protected readonly editingId    = signal<string | null>(null);
  /** Reference to the home being edited — needed to resolve UUID and original server name. */
  private readonly editingHome    = signal<LocalHome | null>(null);
  protected readonly editName     = signal('');
  protected readonly editX        = signal('');
  protected readonly editY        = signal('');
  protected readonly editZ        = signal('');
  protected readonly editWorld    = signal('world');
  protected readonly editPublic   = signal(false);

  constructor() {
    effect(() => {
      if (this.players().length) {
        void this._loadFromServer();
      }
    });
  }

  /** Loads all homes from the Python API and populates the local signal. No Firestore writes. */
  private async _loadFromServer(): Promise<void> {
    this.syncing.set(true);
    try {
      const raw = await this._fetchAllPlayerHomes();
      // Preserve any local isPublic toggles for homes that are still present
      const prev = new Map(this.homes().map(h => [h.id, h.isPublic]));
      this.homes.set(raw.map(h => ({
        ...h,
        id: h.name,
        isPublic: prev.get(h.name) ?? false,
      })));
    } finally {
      this.syncing.set(false);
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

  protected toggleAddForm(): void {
    this.showAddForm.update(v => !v);
    this.addError.set(null);
    this.newName.set('');
    this.newX.set('');
    this.newY.set('');
    this.newZ.set('');
    this.newWorld.set('world');
    this.newPublic.set(false);
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
    const player = javaPlayers[0];
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
      this.showAddForm.set(false);
    } catch {
      this.addError.set('Failed to create home on server.');
    } finally {
      this.saving.set(false);
    }
  }

  protected startEdit(home: LocalHome): void {
    this.editingId.set(home.id);
    this.editingHome.set(home);
    // Show the bare name (without PlayerName: prefix) for a clean editing experience
    this.editName.set(this.homeDisplayName(home.name));
    this.editX.set(String(home.x));
    this.editY.set(String(home.y));
    this.editZ.set(String(home.z));
    this.editWorld.set(home.world);
    this.editPublic.set(home.isPublic);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editingHome.set(null);
  }

  protected async saveEdit(id: string): Promise<void> {
    const original = this.homes().find(h => h.id === id);
    if (!original) return;
    const target = this._resolveServerTarget(original.name);
    if (!target) return;
    const javaPlayers = this.players().filter(p => !p.isBedrock());
    const owner = javaPlayers.length > 1
      ? javaPlayers.find(p => original.name.startsWith(`${p.name}:`))
      : undefined;
    const prefix = owner ? `${owner.name}:` : '';
    const newStoredName = prefix + this.editName().trim();
    const body: Record<string, unknown> = {
      x: parseFloat(this.editX()),
      y: parseFloat(this.editY()),
      z: parseFloat(this.editZ()),
      world: this.editWorld(),
    };
    if (this.editName().trim() !== target.serverName) {
      body['new_name'] = this.editName().trim();
    }
    this.saving.set(true);
    try {
      await firstValueFrom(
        this.http.put(
          `/api/players/${target.uuid}/homes/${encodeURIComponent(target.serverName)}`,
          body,
        )
      );
      this.homes.update(hs => hs.map(h => h.id === id ? {
        ...h,
        id: newStoredName,
        name: newStoredName,
        x: parseFloat(this.editX()),
        y: parseFloat(this.editY()),
        z: parseFloat(this.editZ()),
        world: this.editWorld(),
        isPublic: this.editPublic(),
      } : h));
      this.editingId.set(null);
      this.editingHome.set(null);
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
      return { uuid: javaPlayers[0].uuid, serverName: storedName };
    }
    // Multi-account: match by "PlayerName:" prefix
    const owner = javaPlayers.find(p => storedName.startsWith(`${p.name}:`));
    if (!owner) return null;
    return { uuid: owner.uuid, serverName: storedName.slice(owner.name.length + 1) };
  }

  protected setAllVisible(isPublic: boolean): void {
    this.homes.update(hs => hs.map(h => ({ ...h, isPublic })));
  }

  /** Builds a BlueMap hash fragment for a home's coordinates. */
  protected homeMapHash(home: LocalHome): string {
    const x = Math.round(home.x);
    const y = Math.round(home.y) + 2;
    const z = Math.round(home.z);
    return `#${home.world}:${x}:${y}:${z}:0:0.36:500:0:0:free`;
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
