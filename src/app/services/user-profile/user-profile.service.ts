import { Injectable, inject, signal, computed } from '@angular/core';
import { getApps, initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
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

export type AccountType = 'java' | 'bedrock' | 'admin';

export interface MinecraftAccounts {
  java: string | null;
  bedrock: string | null;
  admin: string | null;
}

export interface UserProfile {
  minecraftAccounts: MinecraftAccounts;
  savedLocations: SavedLocation[];
}

const DEFAULT_ACCOUNTS: MinecraftAccounts = { java: null, bedrock: null, admin: null };
const DEFAULT_PROFILE: UserProfile = { minecraftAccounts: DEFAULT_ACCOUNTS, savedLocations: [] };

@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly auth = inject(AuthService);

  private readonly db = (() => {
    const app = getApps().length ? getApps()[0] : initializeApp(environment.firebaseConfig);
    return getFirestore(app);
  })();

  readonly profile = signal<UserProfile>(DEFAULT_PROFILE);
  readonly isLoading = signal(false);

  readonly savedLocations = computed(() => this.profile().savedLocations);
  readonly minecraftAccounts = computed(() => this.profile().minecraftAccounts);
  /** Primary Java username for backward-compat display */
  readonly minecraftUsername = computed(() => this.profile().minecraftAccounts.java);

  // ---- Public API ----------------------------------------------------------

  async loadProfile(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    this.isLoading.set(true);
    try {
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
    } finally {
      this.isLoading.set(false);
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
   * Looks up a Minecraft username in the `usernames` collection,
   * then returns public saved locations for that user.
   * Used by PlayerDetailComponent to show community-shared spots.
   */
  async getPublicLocationsForPlayer(minecraftName: string): Promise<SavedLocation[]> {
    try {
      const usernameSnap = await getDoc(doc(this.db, 'usernames', minecraftName));
      if (!usernameSnap.exists()) return [];

      const { uid } = usernameSnap.data() as { uid: string };
      const userSnap = await getDoc(doc(this.db, 'users', uid));
      if (!userSnap.exists()) return [];

      const profile = userSnap.data() as UserProfile;
      return (profile.savedLocations ?? []).filter(l => l.isPublic);
    } catch {
      return [];
    }
  }

  // ---- Private helpers -----------------------------------------------------

  private async _persistLocations(uid: string, locations: SavedLocation[]): Promise<void> {
    const ref = doc(this.db, 'users', uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      await updateDoc(ref, { savedLocations: locations });
    } else {
      await setDoc(ref, { ...DEFAULT_PROFILE, savedLocations: locations });
    }
  }
}
