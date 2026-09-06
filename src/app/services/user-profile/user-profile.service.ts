import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable } from 'rxjs';
import { getApps, initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';

export interface SavedLocation {
  id: string;
  name: string;
  /** The `#world:x:y:z:...` fragment from the Minecraft map URL */
  mapHash: string;
  description: string;
  /** When true other players can see this location on the player card */
  isPublic: boolean;
}

export interface SavedHome {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** EssentialsX world id: 'world', 'world_nether', 'world_the_end' */
  world: string;
  /** When true other players can see this home on the player card */
  isPublic: boolean;
}

export type AccountType = 'java' | 'bedrock' | 'admin';

export interface MinecraftAccounts {
  java: string | null;
  bedrock: string | null;
  admin: string | null;
}

export interface UserProfile {
  minecraftAccounts: MinecraftAccounts;
  savedLocations: SavedLocation[];
  savedHomes: SavedHome[];
}

const DEFAULT_ACCOUNTS: MinecraftAccounts = { java: null, bedrock: null, admin: null };
const DEFAULT_PROFILE: UserProfile = { minecraftAccounts: DEFAULT_ACCOUNTS, savedLocations: [], savedHomes: [] };

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly auth = inject(AuthService);

  private readonly db = (() => {
    const app = getApps().at(0) ?? initializeApp(environment.firebaseConfig);
    return getFirestore(app);
  })();

  readonly profile = signal<UserProfile>(DEFAULT_PROFILE);
  readonly isLoading = signal(false);

  /** True once the profile has been successfully loaded for the current user. */
  readonly isLoaded = signal(false);

  /** Prevents concurrent loads for the same UID. */
  private _loadedUid: string | null = null;
  private _loadingPromise: Promise<void> | null = null;

  readonly savedLocations = computed(() => this.profile().savedLocations);
  readonly savedHomes = computed(() => this.profile().savedHomes ?? []);
  readonly minecraftAccounts = computed(() => this.profile().minecraftAccounts);
  /** Primary Java username for backward-compat display */
  readonly minecraftUsername = computed(() => this.profile().minecraftAccounts.java);

  // ---- Public API ----------------------------------------------------------

  async loadProfile(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    // Return immediately if already loaded for this user session.
    if (this._loadedUid === uid) return;
    // Deduplicate concurrent calls (e.g. guard fires on multiple routes at once).
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = this._doLoadProfile(uid);
    try {
      await this._loadingPromise;
    } finally {
      this._loadingPromise = null;
    }
  }

  private async _doLoadProfile(uid: string): Promise<void> {
    this.isLoading.set(true);
    try {
      // E2E test bypass – avoids real Firestore calls in Playwright tests.
      const e2eProfile = !environment.production
        ? (globalThis as { __E2E_PROFILE__?: Partial<UserProfile> }).__E2E_PROFILE__
        : undefined;
      if (e2eProfile) {
        this.profile.set({ ...DEFAULT_PROFILE, ...e2eProfile });
        this._loadedUid = uid;
        return;
      }

      const snap = await getDoc(doc(this.db, 'users', uid));
      if (snap.exists()) {
        const raw = snap.data() as Partial<UserProfile> & { minecraftUsername?: string };
        // Migrate legacy single-username field
        if (!raw.minecraftAccounts && raw.minecraftUsername) {
          raw.minecraftAccounts = { java: raw.minecraftUsername, bedrock: null, admin: null };
        }
        this.profile.set({ ...DEFAULT_PROFILE, ...raw });
      } else {
        this.profile.set(DEFAULT_PROFILE);
      }
      this._loadedUid = uid;
    } finally {
      this.isLoading.set(false);
      this.isLoaded.set(true);
    }
  }

  async linkAccount(type: AccountType, username: string): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const ref = doc(this.db, 'users', uid);
    const snap = await getDoc(ref);
    const current = snap.exists()
      ? (snap.data() as UserProfile).minecraftAccounts ?? DEFAULT_ACCOUNTS
      : DEFAULT_ACCOUNTS;

    const updated: MinecraftAccounts = { ...current, [type]: username };

    await this.removePreviousUsernameMapping(uid, current[type], username);

    if (snap.exists()) {
      await updateDoc(ref, { minecraftAccounts: updated });
    } else {
      await setDoc(ref, { ...DEFAULT_PROFILE, minecraftAccounts: updated });
    }

    // Write reverse-lookup so player cards can find this user's public locations
    if (username) {
      await setDoc(doc(this.db, 'usernames', username), { uid, type }, { merge: true });
    }

    this.profile.update(p => ({ ...p, minecraftAccounts: updated }));
  }

  async unlinkAccount(type: AccountType): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const ref = doc(this.db, 'users', uid);
    const snap = await getDoc(ref);
    const current = snap.exists()
      ? (snap.data() as UserProfile).minecraftAccounts ?? DEFAULT_ACCOUNTS
      : DEFAULT_ACCOUNTS;

    const previousUsername = current[type];
    if (previousUsername) {
      try {
        const prevSnap = await getDoc(doc(this.db, 'usernames', previousUsername));
        if (!prevSnap.exists() || this.belongsToUser(prevSnap.data(), uid)) {
          await deleteDoc(doc(this.db, 'usernames', previousUsername));
        }
      } catch { /* ignore — stale data */ }
    }

    const updated: MinecraftAccounts = { ...current, [type]: null };
    if (snap.exists()) {
      await updateDoc(ref, { minecraftAccounts: updated });
    } else {
      await setDoc(ref, { ...DEFAULT_PROFILE, minecraftAccounts: updated });
    }
    this.profile.update(p => ({ ...p, minecraftAccounts: updated }));
  }

  async addLocation(location: Omit<SavedLocation, 'id'>): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const id = crypto.randomUUID();
    const newLoc: SavedLocation = { id, ...location };
    const updated = [...this.profile().savedLocations, newLoc];

    await this._persistLocations(uid, updated);
    this.profile.update(p => ({ ...p, savedLocations: updated }));
  }

  async updateLocation(id: string, changes: Partial<Omit<SavedLocation, 'id'>>): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const updated = this.profile().savedLocations.map(loc =>
      loc.id === id ? { ...loc, ...changes } : loc
    );

    await this._persistLocations(uid, updated);
    this.profile.update(p => ({ ...p, savedLocations: updated }));
  }

  async deleteLocation(id: string): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const updated = this.profile().savedLocations.filter(loc => loc.id !== id);
    await this._persistLocations(uid, updated);
    this.profile.update(p => ({ ...p, savedLocations: updated }));
  }

  async addHome(home: Omit<SavedHome, 'id'>): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const id = crypto.randomUUID();
    const newHome: SavedHome = { id, ...home };
    const updated = [...(this.profile().savedHomes ?? []), newHome];

    await this._persistHomes(uid, updated);
    this.profile.update(p => ({ ...p, savedHomes: updated }));
  }

  /**
   * Merges a batch of server homes into savedHomes in a single Firestore write.
   * For each server home: adds it if not present by name, or updates coords if present.
   * Preserves existing isPublic values.
   */
  async syncHomesFromServer(serverHomes: Omit<SavedHome, 'id' | 'isPublic'>[]): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid || serverHomes.length === 0) return;

    const existing = this.profile().savedHomes ?? [];
    const existingByName = new Map(existing.map(h => [h.name, h]));
    let changed = false;

    const updated: SavedHome[] = existing.map(h => {
      const server = serverHomes.find(sh => sh.name === h.name);
      if (server && (h.x !== server.x || h.y !== server.y || h.z !== server.z || h.world !== server.world)) {
        changed = true;
        return { ...h, x: server.x, y: server.y, z: server.z, world: server.world };
      }
      return h;
    });

    for (const sh of serverHomes) {
      if (!existingByName.has(sh.name)) {
        updated.push({ id: crypto.randomUUID(), isPublic: false, ...sh });
        changed = true;
      }
    }

    if (!changed) return;

    await this._persistHomes(uid, updated);
    this.profile.update(p => ({ ...p, savedHomes: updated }));
  }

  async updateHome(id: string, changes: Partial<Omit<SavedHome, 'id'>>): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const updated = (this.profile().savedHomes ?? []).map(h =>
      h.id === id ? { ...h, ...changes } : h
    );

    await this._persistHomes(uid, updated);
    this.profile.update(p => ({ ...p, savedHomes: updated }));
  }

  async deleteHome(id: string): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const updated = (this.profile().savedHomes ?? []).filter(h => h.id !== id);
    await this._persistHomes(uid, updated);
    this.profile.update(p => ({ ...p, savedHomes: updated }));
  }

  async updateAllHomesVisibility(isPublic: boolean): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const updated = (this.profile().savedHomes ?? []).map(h => ({ ...h, isPublic }));
    await this._persistHomes(uid, updated);
    this.profile.update(p => ({ ...p, savedHomes: updated }));
  }

  /**
   * Upserts a set of local homes into Firestore.
   * Homes already in Firestore are updated (coords + isPublic).
   * Homes not yet in Firestore are added with the given isPublic value.
   * Homes in Firestore that are absent from the local list are left untouched.
   */
  async upsertHomesFromLocal(
    homes: readonly { name: string; x: number; y: number; z: number; world: string; isPublic: boolean }[]
  ): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid || homes.length === 0) return;

    const existing = this.profile().savedHomes ?? [];
    const existingByName = new Map(existing.map(h => [h.name, h]));
    const updated: SavedHome[] = [...existing];

    for (const h of homes) {
      const found = existingByName.get(h.name);
      if (found) {
        const idx = updated.findIndex(u => u.id === found.id);
        if (idx >= 0) updated[idx] = { ...found, x: h.x, y: h.y, z: h.z, world: h.world, isPublic: h.isPublic };
      } else {
        updated.push({ id: crypto.randomUUID(), name: h.name, x: h.x, y: h.y, z: h.z, world: h.world, isPublic: h.isPublic });
      }
    }

    await this._persistHomes(uid, updated);
    this.profile.update(p => ({ ...p, savedHomes: updated }));
  }

  /** Removes a home from Firestore by its stored name. */
  async deleteHomeByName(name: string): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const updated = (this.profile().savedHomes ?? []).filter(h => h.name !== name);
    await this._persistHomes(uid, updated);
    this.profile.update(p => ({ ...p, savedHomes: updated }));
  }

  /**
   * Returns a live Observable of public homes for a given Minecraft username.
   */
  getPublicHomesStream(minecraftName: string): Observable<SavedHome[]> {
    return new Observable(observer => {
      let unsubscribeSnapshot: (() => void) | null = null;

      getDoc(doc(this.db, 'usernames', minecraftName))
        .then(usernameSnap => {
          if (!usernameSnap.exists()) {
            observer.next([]);
            return;
          }
          const { uid } = usernameSnap.data() as { uid: string };
          unsubscribeSnapshot = onSnapshot(
            doc(this.db, 'users', uid),
            userSnap => {
              if (!userSnap.exists()) { observer.next([]); return; }
              const profile = userSnap.data() as UserProfile;
              observer.next((profile.savedHomes ?? []).filter(h => h.isPublic));
            },
            () => observer.next([])
          );
        })
        .catch(() => observer.next([]));

      return () => unsubscribeSnapshot?.();
    });
  }

  /**
   * Returns a live Observable of public saved locations for a given Minecraft
   * username. Backed by Firestore onSnapshot so it updates in real time across
   * tabs and within the same tab whenever the profile changes.
   */
  getPublicLocationsStream(minecraftName: string): Observable<SavedLocation[]> {
    return new Observable(observer => {
      let unsubscribeSnapshot: (() => void) | null = null;

      getDoc(doc(this.db, 'usernames', minecraftName))
        .then(usernameSnap => {
          if (!usernameSnap.exists()) {
            observer.next([]);
            return;
          }
          const { uid } = usernameSnap.data() as { uid: string };
          unsubscribeSnapshot = onSnapshot(
            doc(this.db, 'users', uid),
            userSnap => {
              if (!userSnap.exists()) { observer.next([]); return; }
              const profile = userSnap.data() as UserProfile;
              observer.next((profile.savedLocations ?? []).filter(l => l.isPublic));
            },
            () => observer.next([])
          );
        })
        .catch(() => observer.next([]));

      // Teardown: cancel Firestore listener when subscriber unsubscribes
      return () => unsubscribeSnapshot?.();
    });
  }

  // ---- Private helpers -----------------------------------------------------

  private async _persistLocations(uid: string, locations: SavedLocation[]): Promise<void> {
    // setDoc + merge is a single create-or-update round-trip — no read-before-write
    // (which also removed a read-modify-write race between concurrent saves).
    await setDoc(doc(this.db, 'users', uid), { savedLocations: locations }, { merge: true });
  }

  private async _persistHomes(uid: string, homes: SavedHome[]): Promise<void> {
    await setDoc(doc(this.db, 'users', uid), { savedHomes: homes }, { merge: true });
  }

  private async removePreviousUsernameMapping(
    uid: string,
    previousUsername: string | null,
    nextUsername: string,
  ): Promise<void> {
    // Delete old reverse-lookup so the previous player no longer maps to this user.
    // Only remove entries that belong to this user (or legacy entries without uid).
    if (!previousUsername || previousUsername === nextUsername) {
      return;
    }

    try {
      const previousRef = doc(this.db, 'usernames', previousUsername);
      const previousSnap = await getDoc(previousRef);
      if (!previousSnap.exists() || this.belongsToUser(previousSnap.data(), uid)) {
        await deleteDoc(previousRef);
      }
    } catch {
      // Ignore stale/missing reverse-lookup docs or permission edge cases.
    }
  }

  private belongsToUser(data: { uid?: string } | null | undefined, uid: string): boolean {
    return !data?.uid || data.uid === uid;
  }
}
