/**
 * localStorage key caching a confirmed linked-account result across launches,
 * so the route guard can render optimistically instead of blocking first paint
 * on a /api/profile round-trip. Written by UserProfileService, cleared on
 * sign-out (AuthService) and on a negative recheck.
 */
export const LINKED_STATUS_CACHE_KEY = 'ev:hasLinkedAccount';
