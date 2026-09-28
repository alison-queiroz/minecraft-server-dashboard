import { Injectable, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import type { SavedLocation } from './user-profile.models';
import { UserDocService } from './user-doc.service';
import { UserProfileService } from './user-profile.service';

/**
 * The caller's saved map locations. The list itself lives in
 * UserProfileService's profile signal (one source of truth, cleared by its
 * reset()); each change is written to the user's own Firestore doc first and
 * then applied there.
 */
@Injectable({ providedIn: 'root' })
export class SavedLocationsService {
  private readonly auth = inject(AuthService);
  private readonly userProfile = inject(UserProfileService);
  private readonly userDoc = inject(UserDocService);

  readonly savedLocations = this.userProfile.savedLocations;

  async addLocation(location: Omit<SavedLocation, 'id'>): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const id = crypto.randomUUID();
    const newLoc: SavedLocation = { id, ...location };
    await this.persist(uid, [...this.savedLocations(), newLoc]);
  }

  async updateLocation(id: string, changes: Partial<Omit<SavedLocation, 'id'>>): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    const updated = this.savedLocations().map(loc =>
      loc.id === id ? { ...loc, ...changes } : loc
    );
    await this.persist(uid, updated);
  }

  async deleteLocation(id: string): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;

    await this.persist(uid, this.savedLocations().filter(loc => loc.id !== id));
  }

  private async persist(uid: string, locations: SavedLocation[]): Promise<void> {
    await this.userDoc.merge(uid, { savedLocations: locations });
    this.userProfile.profile.update(p => ({ ...p, savedLocations: locations }));
  }
}
