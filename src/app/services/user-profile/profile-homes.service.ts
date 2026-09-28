import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { catchError, firstValueFrom, of } from 'rxjs';
import type {
  AccountHomes,
  HomeCoordinates,
  HomeVisibilityChange,
  PublicProfile,
} from './user-profile.models';

/** What the player card shows when there is no player or the lookup fails. */
export const EMPTY_PUBLIC_PROFILE: PublicProfile = { locations: [], homes: [] };

/**
 * EssentialsX homes and the player-card public profile, via the Python API.
 * Stateless: nothing here outlives a request, so there is nothing to reset.
 */
@Injectable({ providedIn: 'root' })
export class ProfileHomesService {
  private readonly http = inject(HttpClient);

  /** The caller's homes grouped by linked Java account, with their visibility. */
  async loadOwnHomes(): Promise<AccountHomes[]> {
    const res = await firstValueFrom(this.http.get<{ accounts: AccountHomes[] }>('/api/profile/homes'));
    return res.accounts;
  }

  /** Shows/hides the caller's own homes on their player card. */
  async setHomesVisibility(homes: readonly HomeVisibilityChange[]): Promise<void> {
    await firstValueFrom(this.http.put('/api/profile/homes/visibility', { homes }));
  }

  async createHome(uuid: string, home: HomeCoordinates): Promise<void> {
    await firstValueFrom(this.http.post(`/api/players/${uuid}/homes`, home));
  }

  async deleteHome(uuid: string, name: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/players/${uuid}/homes/${encodeURIComponent(name)}`));
  }

  /**
   * A player's public locations and homes for the player card. The server
   * applies the visibility rules; any failure just shows nothing.
   */
  getPublicProfile(uuid: string): Observable<PublicProfile> {
    return this.http
      .get<PublicProfile>(`/api/players/${uuid}/public-profile`)
      .pipe(catchError(() => of(EMPTY_PUBLIC_PROFILE)));
  }
}
