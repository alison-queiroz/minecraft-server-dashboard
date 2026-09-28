import type { OnInit } from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
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
import { UiInputComponent } from '../../shared/ui-input/ui-input.component';
import { MAP_BASE_URL, joinMapUrl } from '../../../utils/map-hash.util';
import type {
  AccountHomes,
  HomeCoordinates,
  HomeVisibilityChange,
  ProfileHome,
} from '../../../services/user-profile/user-profile.models';
import { ProfileHomesService } from '../../../services/user-profile/profile-homes.service';

export const WORLD_OPTIONS = [
  { value: 'world',        label: 'Overworld' },
  { value: 'world_nether', label: 'Nether' },
  { value: 'world_the_end', label: 'The End' },
] as const;

/** A home row: one account's home plus the owning player and a stable key. */
export interface HomeRow extends ProfileHome {
  uuid: string;
  /** `<uuid>/<name>` — unique across linked accounts. */
  key: string;
}

interface HomeGroup {
  uuid: string;
  /** Account name; null when only one account is linked (header hidden). */
  label: string | null;
  homes: HomeRow[];
}

const homeKey = (uuid: string, name: string): string => `${uuid}/${name}`;

@Component({
  selector: 'app-profile-homes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, IconButtonComponent, InlineErrorComponent, EmptyStateComponent, CollapsibleSectionComponent, ActionButtonComponent, DecimalPipe, ProfileItemCardComponent, DimensionTagComponent, MapViewerComponent, UiToggleComponent, UiInputComponent],
  templateUrl: './profile-homes.component.html',
  styleUrls: ['./profile-homes.component.scss'],
})
export class ProfileHomesComponent implements OnInit {
  protected readonly LucideHouse      = LucideHouse;
  protected readonly LucidePencil     = LucidePencil;
  protected readonly LucideTrash2     = LucideTrash2;
  protected readonly LucideCheck      = LucideCheck;
  protected readonly LucideRefreshCw  = LucideRefreshCw;
  protected readonly LucideMap        = LucideMap;
  protected readonly LucideExternalLink = LucideExternalLink;

  private readonly homesService = inject(ProfileHomesService);

  protected readonly mapBaseUrl = MAP_BASE_URL;

  /** Emits a BlueMap hash when the user wants to preview a home on the embedded map. */
  @Output() previewRequested = new EventEmitter<string>();

  /** Source of truth: the caller's linked Java accounts and their homes, from /api/profile/homes. */
  protected readonly accounts = signal<AccountHomes[]>([]);
  protected readonly loaded = signal(false);

  protected readonly groups = computed<HomeGroup[]>(() => {
    const accounts = this.accounts();
    return accounts.map(account => ({
      uuid: account.uuid,
      label: accounts.length > 1 ? account.name : null,
      homes: account.homes.map(home => ({ ...home, uuid: account.uuid, key: homeKey(account.uuid, home.name) })),
    }));
  });

  protected readonly rows = computed(() => this.groups().flatMap(group => group.homes));

  protected readonly worldOptions = WORLD_OPTIONS;

  /** uuids of the account groups currently collapsed. */
  protected readonly collapsedGroups = signal<Set<string>>(new Set());

  protected readonly showAddForm  = signal(false);
  protected readonly newAccount   = signal('');  // uuid of the account the new home goes to
  protected readonly newName      = signal('');
  protected readonly newX         = signal('');
  protected readonly newY         = signal('');
  protected readonly newZ         = signal('');
  protected readonly newWorld     = signal('world');
  protected readonly newPublic    = signal(false);
  protected readonly newMapHash   = signal('');  // drives the map picker iframe
  protected readonly addError     = signal<string | null>(null);
  protected readonly actionError  = signal<string | null>(null);
  protected readonly saving       = signal(false);
  protected readonly syncing      = signal(false);

  protected readonly editingKey   = signal<string | null>(null);
  protected readonly editPublic   = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  /** (Re)loads the caller's homes; the server resolves linked accounts and visibility. */
  private async load(): Promise<void> {
    this.syncing.set(true);
    try {
      this.accounts.set(await this.homesService.loadOwnHomes());
      this.actionError.set(null);
    } catch {
      this.actionError.set('Failed to load homes from the server.');
    } finally {
      this.syncing.set(false);
      this.loaded.set(true);
    }
  }

  async refreshFromServer(): Promise<void> {
    await this.load();
  }

  protected toggleGroup(uuid: string): void {
    this.collapsedGroups.update(s => {
      const next = new Set(s);
      if (next.has(uuid)) { next.delete(uuid); } else { next.add(uuid); }
      return next;
    });
  }

  protected isGroupCollapsed(uuid: string): boolean {
    return this.collapsedGroups().has(uuid);
  }

  protected toggleAddForm(): void {
    this.showAddForm.update(v => !v);
    this.addError.set(null);
    this.newAccount.set(this.accounts().at(0)?.uuid ?? '');
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
    const uuid = this.newAccount() || this.accounts().at(0)?.uuid;
    if (!uuid) return;
    const name = this.newName().trim();
    const x = parseFloat(this.newX());
    const y = parseFloat(this.newY());
    const z = parseFloat(this.newZ());
    if (!name) { this.addError.set('Home name is required.'); return; }
    if (![x, y, z].every(Number.isFinite)) {
      this.addError.set('X, Y and Z must be valid numbers.');
      return;
    }
    this.addError.set(null);
    this.saving.set(true);
    const outcome = await this.submitNewHome({ name, x, y, z, world: this.newWorld() }, uuid)
      .finally(() => this.saving.set(false));
    if (outcome === 'failed') return;
    this.showAddForm.set(false);
    await this.load();
    if (outcome === 'created-private') {
      this.actionError.set('Home created, but it could not be shown on your player card.');
    }
  }

  /** Creates the home, then applies the requested visibility. */
  private async submitNewHome(home: HomeCoordinates, uuid: string): Promise<'created' | 'created-private' | 'failed'> {
    try {
      await this.homesService.createHome(uuid, home);
    } catch {
      this.addError.set('Failed to create home on server.');
      return 'failed';
    }
    if (!this.newPublic()) return 'created';
    return (await this.saveVisibility([{ uuid, name: home.name, isPublic: true }])) ? 'created' : 'created-private';
  }

  protected startEdit(home: HomeRow): void {
    this.editingKey.set(home.key);
    this.editPublic.set(home.isPublic);
  }

  protected cancelEdit(): void {
    this.editingKey.set(null);
  }

  protected async saveEdit(home: HomeRow): Promise<void> {
    this.saving.set(true);
    try {
      if (await this.saveVisibility([{ uuid: home.uuid, name: home.name, isPublic: this.editPublic() }])) {
        this.editingKey.set(null);
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteHome(home: HomeRow): Promise<void> {
    if (!confirm('Remove this home from the server?')) return;
    try {
      await this.homesService.deleteHome(home.uuid, home.name);
    } catch {
      this.actionError.set('Failed to delete the home on the server.');
      return;
    }
    this.accounts.update(accounts => accounts.map(account => account.uuid !== home.uuid ? account : {
      ...account,
      homes: account.homes.filter(h => h.name !== home.name),
    }));
  }

  protected async setAllVisible(isPublic: boolean): Promise<void> {
    const changes = this.rows().map(home => ({ uuid: home.uuid, name: home.name, isPublic }));
    if (changes.length) await this.saveVisibility(changes);
  }

  /** Persists visibility changes, then mirrors them locally. False on failure. */
  private async saveVisibility(changes: HomeVisibilityChange[]): Promise<boolean> {
    try {
      await this.homesService.setHomesVisibility(changes);
    } catch {
      this.actionError.set('Failed to update home visibility.');
      return false;
    }
    const byKey = new Map(changes.map(c => [homeKey(c.uuid, c.name), c.isPublic]));
    this.accounts.update(accounts => accounts.map(account => ({
      ...account,
      homes: account.homes.map(h => ({ ...h, isPublic: byKey.get(homeKey(account.uuid, h.name)) ?? h.isPublic })),
    })));
    this.actionError.set(null);
    return true;
  }

  /** Builds a BlueMap hash fragment for a home's coordinates. */
  protected homeMapHash(home: HomeRow): string {
    const x = Math.round(home.x);
    const y = Math.round(home.y) + 2;
    const z = Math.round(home.z);
    return `#${home.world}:${x}:${y}:${z}:0:0.36:1.5:0:0:free`;
  }

  /** Full BlueMap URL for a home. */
  protected homeMapUrl(home: HomeRow): string {
    return joinMapUrl(this.mapBaseUrl, this.homeMapHash(home));
  }

  protected previewHomeOnMap(home: HomeRow): void {
    this.previewRequested.emit(this.homeMapHash(home));
  }

  protected allPublic(): boolean {
    const rows = this.rows();
    return rows.length > 0 && rows.every(h => h.isPublic);
  }
}
