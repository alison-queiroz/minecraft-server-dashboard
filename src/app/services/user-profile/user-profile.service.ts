import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { getApps, initializeApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { LINKED_STATUS_CACHE_KEY } from '../../constants/storage.constants';

// Firestore is dynamically imported (kept out of the initial bundle). This
// typeof-import types its function surface without importing the values.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type FirestoreModule = typeof import('firebase/firestore');

/** The Firestore SDK surface this service uses, plus the db instance. */
interface FirestoreApi {
  db: Firestore;
  doc: FirestoreModule['doc'];
  getDoc: FirestoreModule['getDoc'];
  setDoc: FirestoreModule['setDoc'];
  updateDoc: FirestoreModule['updateDoc'];
  deleteDoc: FirestoreModule['deleteDoc'];
  onSnapshot: FirestoreModule['onSnapshot'];
}

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
  // Optional so existing Firestore-focused specs (which don't provide HttpClient
  // and never call fetchLinkedStatus) still construct the service; the running
  // app always provides HttpClient.
  private readonly http = inject(HttpClient, { optional: true });

  /** Session cache for the guard's access check — a positive result is sticky. */
  private _linkedStatus: boolean | null = null;

  /**
   * Firestore-free access check for the route guard: does the current user have
   * any linked Minecraft account? Reads it over the Python API (which queries
   * Firestore server-side) so the guard never pulls the ~166 KiB Firestore SDK
   * into the browser. A positive result is cached for the session; a negative is
   * always re-checked so a freshly-linked account is picked up immediately.
   */
  async fetchLinkedStatus(): Promise<boolean> {
    if (this._linkedStatus === true) return true;
    if (!this.http) return false;

    // Optimistic path: a previous session confirmed a linked account, so trust
    // the cached result and let the guard render immediately, revalidating in
    // the background. This keeps the /api/profile round-trip off the critical
    // path (noticeable on cold PWA launches). If the recheck comes back
    // negative it clears the cache, so the next navigation blocks correctly.
    if (this.readLinkedCache()) {
      this._linkedStatus = true;
      void this.refreshLinkedStatus();
      return true;
    }
    return this.refreshLinkedStatus();
  }

  /** Fetch the authoritative linked-account status and update the cache. */
  private async refreshLinkedStatus(): Promise<boolean> {
    if (!this.http) return false;
    try {
      const res = await firstValueFrom(
        this.http.get<{ hasLinkedAccount: boolean }>('/api/profile'),
      );
      this._linkedStatus = !!res?.hasLinkedAccount;
      this.writeLinkedCache(this._linkedStatus);
      return this._linkedStatus;
    } catch {
      return false; // fail-closed → the guard sends the user to /login
    }
  }

  private readLinkedCache(): boolean {
    try {
      return localStorage.getItem(LINKED_STATUS_CACHE_KEY) === '1';
    } catch {
      return false; // private mode / storage blocked → just skip the optimism
    }
  }

  private writeLinkedCache(linked: boolean): void {
    try {
      if (linked) localStorage.setItem(LINKED_STATUS_CACHE_KEY, '1');
      else localStorage.removeItem(LINKED_STATUS_CACHE_KEY);
    } catch {
      /* storage unavailable → optimism simply won't persist */
    }
  }

  /**
   * Lazily loads the Firestore SDK on first use (dynamic import) so it stays out
   * of the initial bundle — the login page and app shell don't need it. Cached
   * after the first call.
   */
  private _fs: Promise<FirestoreApi> | null = null;
  private fs(): Promise<FirestoreApi> {
    return (this._fs ??= (async () => {
      const m = await import('firebase/firestore');
      const app = getApps().at(0) ?? initializeApp(environment.firebaseConfig);
      return {
        db: m.getFirestore(app),
        doc: m.doc,
        getDoc: m.getDoc,
        setDoc: m.setDoc,
        updateDoc: m.updateDoc,
        deleteDoc: m.deleteDoc,
        onSnapshot: m.onSnapshot,
      };
    })());
  }

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

      const { db, doc, getDoc } = await this.fs();
      const snap = await getDoc(doc(db, 'users', uid));
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

    const { db, doc, getDoc, setDoc, updateDoc } = await this.fs();
    const ref = doc(db, 'users', uid);
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
      await setDoc(doc(db, 'usernames', username), { uid, type }, { merge: true });
    }

    this.profile.update(p => ({ ...p, minecraftAccounts: updated }));
  }

  async unlinkAccount(type: AccountType): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const { db, doc, getDoc, setDoc, updateDoc, deleteDoc } = await this.fs();
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    const current = snap.exists()
      ? (snap.data() as UserProfile).minecraftAccounts ?? DEFAULT_ACCOUNTS
      : DEFAULT_ACCOUNTS;

    const previousUsername = current[type];
    if (previousUsername) {
      try {
        const prevSnap = await getDoc(doc(db, 'usernames', previousUsername));
        if (!prevSnap.exists() || this.belongsToUser(prevSnap.data(), uid)) {
          await deleteDoc(doc(db, 'usernames', previousUsername));
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
   * Live Observable of a user's PUBLIC entries of one profile field, resolved by
   * Minecraft username via the usernames reverse-lookup and kept fresh by an
   * onSnapshot listener. Shared implementation for the homes/locations streams.
   */
  private publicFieldStream<T extends { isPublic: boolean }>(
    minecraftName: string,
    select: (profile: UserProfile) => T[],
  ): Observable<T[]> {
    return new Observable<T[]>(observer => {
      let unsubscribeSnapshot: (() => void) | null = null;
      let cancelled = false;

      this.fs()
        .then(({ db, doc, getDoc, onSnapshot }) =>
          getDoc(doc(db, 'usernames', minecraftName)).then(usernameSnap => {
            if (cancelled) return;
            if (!usernameSnap.exists()) {
              observer.next([]);
              return;
            }
            const { uid } = usernameSnap.data() as { uid: string };
            unsubscribeSnapshot = onSnapshot(
              doc(db, 'users', uid),
              userSnap => {
                if (!userSnap.exists()) { observer.next([]); return; }
                const profile = userSnap.data() as UserProfile;
                observer.next(select(profile).filter(x => x.isPublic));
              },
              () => observer.next([])
            );
          })
        )
        .catch(() => observer.next([]));

      // Teardown: cancel Firestore listener when the subscriber unsubscribes.
      return () => { cancelled = true; unsubscribeSnapshot?.(); };
    });
  }

  /** Live Observable of a user's public homes, by Minecraft username. */
  getPublicHomesStream(minecraftName: string): Observable<SavedHome[]> {
    return this.publicFieldStream(minecraftName, p => p.savedHomes ?? []);
  }

  /** Live Observable of a user's public saved locations, by Minecraft username. */
  getPublicLocationsStream(minecraftName: string): Observable<SavedLocation[]> {
    return this.publicFieldStream(minecraftName, p => p.savedLocations ?? []);
  }

  // ---- Private helpers -----------------------------------------------------

  private async _persistLocations(uid: string, locations: SavedLocation[]): Promise<void> {
    // setDoc + merge is a single create-or-update round-trip — no read-before-write
    // (which also removed a read-modify-write race between concurrent saves).
    const { db, doc, setDoc } = await this.fs();
    await setDoc(doc(db, 'users', uid), { savedLocations: locations }, { merge: true });
  }

  private async _persistHomes(uid: string, homes: SavedHome[]): Promise<void> {
    const { db, doc, setDoc } = await this.fs();
    await setDoc(doc(db, 'users', uid), { savedHomes: homes }, { merge: true });
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
      const { db, doc, getDoc, deleteDoc } = await this.fs();
      const previousRef = doc(db, 'usernames', previousUsername);
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
