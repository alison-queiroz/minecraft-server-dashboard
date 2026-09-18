import { inject } from '@angular/core';
import type { CanActivateFn} from '@angular/router';
import { Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { from, of } from 'rxjs';
import { filter, map, switchMap, take } from 'rxjs/operators';
import { AuthService } from '../services/auth/auth.service';
import { UserProfileService } from '../services/user-profile/user-profile.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const profileService = inject(UserProfileService);

  // Wait until Firebase has finished restoring the session before deciding.
  return toObservable(auth.isLoading).pipe(
    filter(loading => !loading),
    take(1),
    switchMap(() => {
      if (!auth.currentUser()) {
        void router.navigate(['/login']);
        return of(false);
      }
      // Check whether the user has a linked Minecraft account over the Python API
      // (server-side Firestore) instead of the client Firestore SDK, so guarded
      // routes don't pull the heavy Firestore bundle into the browser. Any linked
      // account (java, bedrock, or admin) grants access.
      return from(profileService.fetchLinkedStatus()).pipe(
        map(hasLinkedAccount => {
          if (!hasLinkedAccount) {
            void router.navigate(['/login']);
            return false;
          }
          return true;
        }),
      );
    }),
  );
};
