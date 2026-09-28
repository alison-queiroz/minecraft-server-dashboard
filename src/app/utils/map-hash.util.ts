import { environment } from '../../environments/environment';

/**
 * Normalizes a BlueMap map reference into a `#world:x:y:z:...` hash fragment.
 *
 * Accepts either a full map URL (from which the `#…` hash is extracted) or a
 * bare hash / coords string (prefixed with `#` when missing). Shared by the map
 * viewer and the saved-locations editor so the rule lives in exactly one place.
 */
export function normaliseMapHash(input: string): string {
  try {
    const url = new URL(input);
    return url.hash || input;
  } catch {
    return input.startsWith('#') ? input : '#' + input;
  }
}

/** BlueMap base URL. Both environment files define it, so no per-component fallback. */
export const MAP_BASE_URL: string = environment.mapBaseUrl;

/**
 * Appends a fragment (`#world:…`, `?query…`) to a BlueMap base URL, inserting
 * the `/` between them when the base has none. The one place that rule lives.
 */
export function joinMapUrl(base: string, fragment: string): string {
  return (base.endsWith('/') ? base : base + '/') + fragment;
}
