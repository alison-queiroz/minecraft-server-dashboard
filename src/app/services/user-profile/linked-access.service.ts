import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LINKED_STATUS_CACHE_KEY } from '../../constants/storage.constants';

/**
 * The route guard's access check: does the current user have any linked
 * Minecraft account? Reads it over the Python API (which queries Firestore
 * server-side) so the guard never pulls the ~166 KiB Firestore SDK into the
 * browser. Per-user state is cleared through UserProfileService.reset().
 */
@Injectable({ providedIn: 'root' })
export class LinkedAccessService {
  private readonly http = inject(HttpClient);

  /** Session cache for the guard's access check — a positive result is sticky. */
  private _linkedStatus: boolean | null = null;

  /**
   * Bumped by reset(). A check captures it before awaiting and drops its
   * result if it changed, so an answer for the previous user can't land after
   * a sign-out / account switch and repopulate their access.
   */
  private _epoch = 0;

  /**
   * A positive result is cached for the session; a negative is always
   * re-checked so a freshly-linked account is picked up immediately.
   */
  async fetchLinkedStatus(): Promise<boolean> {
    if (this._linkedStatus === true) return true;

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

  /** Adopts an authoritative status (e.g. after a link/unlink) and keeps the cache in step. */
  setLinkedStatus(linked: boolean): void {
    this._linkedStatus = linked;
    this.writeLinkedCache(linked);
  }

  /** Forgets the in-memory result and drops any check still in flight. */
  reset(): void {
    this._epoch++;
    this._linkedStatus = null;
  }

  /** Fetch the authoritative linked-account status and update the cache. */
  private async refreshLinkedStatus(): Promise<boolean> {
    const epoch = this._epoch;
    try {
      const res = await firstValueFrom(
        this.http.get<{ hasLinkedAccount: boolean }>('/api/profile'),
      );
      if (epoch !== this._epoch) return false; // answer for a user who has since signed out
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
}
