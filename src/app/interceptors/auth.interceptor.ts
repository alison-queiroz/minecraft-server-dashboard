import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { from, switchMap } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { AuthService } from '../services/auth/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Only attach a token to calls going to our own Python API.
  if (!req.url.startsWith('/api/')) return next(req);

  const auth = inject(AuthService);

  // Wait until Firebase has finished restoring the session before reading the token.
  // Without this, requests fired during app startup would get a null token → 401.
  return toObservable(auth.isLoading).pipe(
    filter(loading => !loading),
    take(1),
    switchMap(() => from(auth.getIdToken())),
    switchMap(token => {
      if (!token) return next(req);
      return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
    }),
  );
};
