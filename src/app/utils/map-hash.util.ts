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
