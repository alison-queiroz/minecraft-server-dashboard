import { inject } from '@angular/core';
import type { CanActivateFn} from '@angular/router';
import { Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs/operators';
import { AuthService } from '../services/auth/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Wait until Firebase has finished restoring the session before deciding.
  return toObservable(auth.isLoading).pipe(
    filter(loading => !loading),
    take(1),
    map(() => {
      if (auth.currentUser()) return true;
      void router.navigate(['/login']);
      return false;
    }),
  );
};
