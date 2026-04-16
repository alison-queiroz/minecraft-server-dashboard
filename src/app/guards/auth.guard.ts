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
      // Load the Firestore profile (idempotent — instant if already loaded).
      // This lets us check whether a Minecraft account has been linked.
      return from(profileService.loadProfile()).pipe(
        map(() => {
          if (!profileService.minecraftAccounts().java) {
            void router.navigate(['/login']);
            return false;
          }
          return true;
        }),
      );
    }),
  );
};
