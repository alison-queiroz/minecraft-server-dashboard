import { Injectable, Injector, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { initializeApp, getApps } from 'firebase/app';
import type { Dependencies, User } from 'firebase/auth';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  getRedirectResult,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { LINKED_STATUS_CACHE_KEY } from '../../constants/storage.constants';
import { UserProfileService } from '../user-profile/user-profile.service';

/**
 * getAuth()'s defaults minus the popup/redirect resolver. With the resolver
 * registered at init, mobile browsers and Safari load gapi and the authDomain
 * iframe BEFORE restoring the session, stalling the guard and every authed
 * /api/ call; signInWithGoogle hands it to the popup call instead. Same
 * persistence order as getAuth(), so sessions already in IndexedDB keep
 * restoring. initializeAuth() returns the existing instance when called again
 * with equal deps, so a repeated bootstrap reuses it instead of throwing.
 */
const AUTH_DEPS: Dependencies = {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly e2eAuthEnabled = !environment.production && !!(globalThis as { __E2E_AUTH_USER__?: User }).__E2E_AUTH_USER__;
  private readonly auth = initializeAuth(getApps().at(0) ?? initializeApp(environment.firebaseConfig), AUTH_DEPS);

  readonly currentUser = signal<User | null>(null);
  /** True while waiting for Firebase to restore session from local storage. */
  readonly isLoading = signal(true);

  /** uid from the last auth report; undefined until the session is restored. */
  private lastUid: string | null | undefined = undefined;

  constructor() {
    // E2E-only shortcut: when a mocked user is injected before app bootstrap,
    // skip Firebase restore and treat the session as authenticated.
    const e2eUser = (globalThis as { __E2E_AUTH_USER__?: User }).__E2E_AUTH_USER__;
    if (this.e2eAuthEnabled && e2eUser) {
      this.currentUser.set(e2eUser);
      this.isLoading.set(false);
      return;
    }

    // E2E-only shortcut: unauthenticated tests set this flag so the guard and
    // login page resolve immediately without waiting for Firebase.
    const e2eUnauth = !environment.production &&
      !!(globalThis as { __E2E_UNAUTHENTICATED__?: boolean }).__E2E_UNAUTHENTICATED__;
    if (e2eUnauth) {
      this.currentUser.set(null);
      this.isLoading.set(false);
      return;
    }

    onAuthStateChanged(this.auth, (user) => {
      this.trackIdentity(user?.uid ?? null);
      this.currentUser.set(user);
      this.isLoading.set(false);
    });
  }

  private signInWarmed = false;

  /**
   * Preloads gapi + the auth iframe while the login page is showing, so the
   * sign-in popup opens straight from the tap. signInWithPopup() awaits the
   * resolver's initialisation before calling window.open(), and Safari/iOS
   * block popups that aren't opened within the user gesture — which is why
   * getAuth() used to do this eagerly on every boot. getRedirectResult()
   * initialises the resolver and resolves to null (the app never redirects).
   * Only the login page calls this; signed-in cold starts never pay for it.
   */
  warmUpSignIn(): void {
    if (this.e2eAuthEnabled || this.signInWarmed) return;
    this.signInWarmed = true;
    getRedirectResult(this.auth, browserPopupRedirectResolver).catch(() => undefined);
  }

  async signInWithGoogle(): Promise<void> {
    // Already initialised by warmUpSignIn() on the login page; otherwise the
    // resolver loads gapi and the auth iframe here, on first use.
    const provider = new GoogleAuthProvider();
    await signInWithPopup(this.auth, provider, browserPopupRedirectResolver);
  }

  async signOut(): Promise<void> {
    this.clearUserState();

    if (this.e2eAuthEnabled) {
      this.currentUser.set(null);
      this.isLoading.set(false);
      delete (globalThis as { __E2E_AUTH_USER__?: User }).__E2E_AUTH_USER__;
      sessionStorage.setItem('__E2E_FORCE_SIGNED_OUT__', '1');
      void this.router.navigate(['/login']);
      return;
    }

    await signOut(this.auth);
    void this.router.navigate(['/login']);
  }

  /** Returns the current Firebase ID token, refreshing it if expired. */
  async getIdToken(): Promise<string | null> {
    return this.auth.currentUser?.getIdToken() ?? null;
  }

  /**
   * Clears per-user state whenever the signed-in identity changes (sign-out in
   * another tab, expired session, a different account). The first report is
   * the session restore: a restored user keeps the optimistic linked-account
   * cache, but a restore with nobody signed in must not leave it behind for
   * whoever signs in next.
   */
  private trackIdentity(uid: string | null): void {
    const restoring = this.lastUid === undefined;
    if (restoring ? uid === null : uid !== this.lastUid) this.clearUserState();
    this.lastUid = uid;
  }

  /** Drops the previous user's access and profile so the next one can't inherit them. */
  private clearUserState(): void {
    try {
      localStorage.removeItem(LINKED_STATUS_CACHE_KEY);
    } catch {
      /* storage unavailable → nothing to clear */
    }
    // Resolved lazily: UserProfileService itself injects AuthService. Its
    // reset() is the one entry point for all per-user state (incl. LinkedAccessService).
    this.injector.get(UserProfileService).reset();
  }
}
