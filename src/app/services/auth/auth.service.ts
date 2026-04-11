import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { initializeApp, getApps } from 'firebase/app';
import type {
  User} from 'firebase/auth';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly e2eAuthEnabled = !environment.production && !!(globalThis as { __E2E_AUTH_USER__?: User }).__E2E_AUTH_USER__;
  private readonly auth = (() => {
    const app = getApps().length ? getApps()[0] : initializeApp(environment.firebaseConfig);
    return getAuth(app);
  })();

  readonly currentUser = signal<User | null>(null);
  /** True while waiting for Firebase to restore session from local storage. */
  readonly isLoading = signal(true);

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
      !!(globalThis as Record<string, unknown>)['__E2E_UNAUTHENTICATED__'];
    if (e2eUnauth) {
      this.currentUser.set(null);
      this.isLoading.set(false);
      return;
    }

    onAuthStateChanged(this.auth, (user) => {
      this.currentUser.set(user);
      this.isLoading.set(false);
    });
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(this.auth, provider);
  }

  async signOut(): Promise<void> {
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
}
