import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import type { AccountType, MinecraftAccounts, UserProfile } from './user-profile.models';
import { AccountLinkError, LINK_ERROR_CODES } from './user-profile.models';
import { LinkedAccessService } from './linked-access.service';
import { UserDocService } from './user-doc.service';

interface AccountsResponse {
  minecraftAccounts: MinecraftAccounts;
}

const DEFAULT_ACCOUNTS: MinecraftAccounts = { java: null, bedrock: null, admin: null };
const DEFAULT_PROFILE: UserProfile = { minecraftAccounts: DEFAULT_ACCOUNTS, savedLocations: [] };

/**
 * The signed-in user's profile (linked accounts + saved locations) and the
 * account link/unlink calls. Owns the profile signal that SavedLocationsService
 * writes to, and the reset() that clears all per-user state.
 */
@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly access = inject(LinkedAccessService);
  private readonly userDoc = inject(UserDocService);

  /**
   * Bumped by reset(). Async work captures it before awaiting and drops its
   * result if it changed, so a load started for the previous user can't land
   * after a sign-out / account switch and repopulate their state.
   */
  private _epoch = 0;

  readonly profile = signal<UserProfile>(DEFAULT_PROFILE);
  readonly isLoading = signal(false);

  /** True once the profile has been successfully loaded for the current user. */
  readonly isLoaded = signal(false);

  /** Prevents concurrent loads for the same UID. */
  private _loadedUid: string | null = null;
  private _loadingPromise: Promise<void> | null = null;

  readonly savedLocations = computed(() => this.profile().savedLocations);
  readonly minecraftAccounts = computed(() => this.profile().minecraftAccounts);
  /** Primary Java username for backward-compat display */
  readonly minecraftUsername = computed(() => this.profile().minecraftAccounts.java);

  // ---- Public API ----------------------------------------------------------

  /**
   * Forgets everything held in memory for the signed-in user (access check and
   * loaded profile) so the next account on this tab starts clean. Called by
   * AuthService on sign-out and whenever Firebase reports a different user.
   * This is the single reset entry point: it also resets LinkedAccessService.
   */
  reset(): void {
    this.access.reset();
    this._epoch++;
    this._loadedUid = null;
    this._loadingPromise = null;
    this.profile.set(DEFAULT_PROFILE);
    this.isLoading.set(false);
    this.isLoaded.set(false);
  }

  async loadProfile(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    // Return immediately if already loaded for this user session.
    if (this._loadedUid === uid) return;
    // Deduplicate concurrent calls (e.g. guard fires on multiple routes at once).
    if (this._loadingPromise) return this._loadingPromise;

    const promise = (this._loadingPromise = this._doLoadProfile(uid));
    try {
      await promise;
    } finally {
      // A reset() + new load may have replaced it meanwhile; only clear our own.
      if (this._loadingPromise === promise) this._loadingPromise = null;
    }
  }

  private async _doLoadProfile(uid: string): Promise<void> {
    const epoch = this._epoch;
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

      const raw = await this.userDoc.read(uid);
      if (epoch !== this._epoch) return; // reset() ran while we were loading
      if (raw) {
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
      if (epoch === this._epoch) {
        this.isLoading.set(false);
        this.isLoaded.set(true);
      }
    }
  }

  /**
   * Links a Minecraft account after the server verifies its AuthMe password.
   * The server writes the link (the browser can't), so the result is the
   * authoritative account map. Rejects with an AccountLinkError.
   */
  async linkAccount(type: AccountType, username: string, password: string): Promise<void> {
    const res = await this.accountRequest(
      this.http.post<AccountsResponse>('/api/profile/accounts', { type, username, password }),
    );
    this.applyAccounts(res.minecraftAccounts);
  }

  /** Unlinks one account type server-side. Rejects with an AccountLinkError. */
  async unlinkAccount(type: AccountType): Promise<void> {
    const res = await this.accountRequest(
      this.http.delete<AccountsResponse>(`/api/profile/accounts/${type}`),
    );
    this.applyAccounts(res.minecraftAccounts);
  }

  // ---- Private helpers -----------------------------------------------------

  private async accountRequest(request: Observable<AccountsResponse>): Promise<AccountsResponse> {
    try {
      return await firstValueFrom(request);
    } catch (err) {
      const body = err instanceof HttpErrorResponse ? (err.error as { code?: string } | null) : null;
      throw new AccountLinkError(LINK_ERROR_CODES.find(code => code === body?.code) ?? 'failed');
    }
  }

  /** Adopts the server's account map and keeps the guard's linked-status cache in step. */
  private applyAccounts(accounts: MinecraftAccounts): void {
    this.profile.update(p => ({ ...p, minecraftAccounts: accounts }));
    this.access.setLinkedStatus(Object.values(accounts).some(Boolean));
  }
}
