import { Injectable } from '@angular/core';
import { getApps, initializeApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import type { UserProfile } from './user-profile.models';

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
}

/** The stored `users/{uid}` doc, which may still carry the legacy single-username field. */
export type StoredUserDoc = Partial<UserProfile> & { minecraftUsername?: string };

/**
 * Reads and writes the signed-in user's own `users/{uid}` Firestore doc — the
 * only Firestore access the profile services make from the browser.
 */
@Injectable({ providedIn: 'root' })
export class UserDocService {
  private _fs: Promise<FirestoreApi> | null = null;

  /** The doc's data, or null when it doesn't exist yet. */
  async read(uid: string): Promise<StoredUserDoc | null> {
    const { db, doc, getDoc } = await this.fs();
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  }

  /**
   * setDoc + merge is a single create-or-update round-trip — no read-before-write
   * (which also removed a read-modify-write race between concurrent saves).
   */
  async merge(uid: string, data: Pick<UserProfile, 'savedLocations'>): Promise<void> {
    const { db, doc, setDoc } = await this.fs();
    await setDoc(doc(db, 'users', uid), data, { merge: true });
  }

  /**
   * Lazily loads the Firestore SDK on first use (dynamic import) so it stays out
   * of the initial bundle — the login page and app shell don't need it. Cached
   * after the first call.
   */
  private fs(): Promise<FirestoreApi> {
    return (this._fs ??= (async () => {
      const m = await import('firebase/firestore');
      const app = getApps().at(0) ?? initializeApp(environment.firebaseConfig);
      return {
        db: m.getFirestore(app),
        doc: m.doc,
        getDoc: m.getDoc,
        setDoc: m.setDoc,
      };
    })());
  }
}
