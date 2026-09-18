import type { HttpInterceptorFn } from '@angular/common/http';

/**
 * Make the Angular service worker (ngsw) ignore our API calls.
 *
 * ngsw proxies every fetch, so each API call showed up twice in DevTools — once
 * as the page's fetch served *through* the SW, once as the SW's own network
 * fetch (`ngsw-worker.js`). More importantly, API responses are live/auth data
 * that must always come fresh from the network, never from the SW cache. The
 * documented `ngsw-bypass` header makes ngsw skip the request entirely, so it's
 * a single direct network call. (The app shell — JS/CSS/assets — stays SW-cached.)
 */
export const ngswBypassInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { 'ngsw-bypass': 'true' } }));
};
