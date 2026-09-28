import type { Observable } from 'rxjs';
import { fromEvent } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

/**
 * Emits whether the page is currently visible, then again on every change
 * (Page Visibility API). Lets background work (polls, live listeners) pause
 * while the tab is hidden instead of running for nobody.
 */
export function pageVisible$(doc: Document): Observable<boolean> {
  return fromEvent(doc, 'visibilitychange').pipe(
    startWith(null),
    map(() => doc.visibilityState !== 'hidden'),
    distinctUntilChanged(),
  );
}
