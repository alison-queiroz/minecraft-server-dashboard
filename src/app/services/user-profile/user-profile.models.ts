export interface SavedLocation {
  id: string;
  name: string;
  /** The `#world:x:y:z:...` fragment from the Minecraft map URL */
  mapHash: string;
  description: string;
  /** When true other players can see this location on the player card */
  isPublic: boolean;
}

/** A saved location as other players see it on the player card. */
export type PublicLocation = Omit<SavedLocation, 'isPublic'>;

/** An EssentialsX home (set in-game with /sethome or from the dashboard). */
export interface HomeCoordinates {
  name: string;
  /** EssentialsX world id: 'world', 'world_nether', 'world_the_end' */
  world: string;
  x: number;
  y: number;
  z: number;
}

/** One of the caller's homes with its player-card visibility. */
export interface ProfileHome extends HomeCoordinates {
  isPublic: boolean;
}

/** The homes of one linked Java account, as served by /api/profile/homes. */
export interface AccountHomes {
  type: AccountType;
  name: string;
  uuid: string;
  homes: ProfileHome[];
}

export interface HomeVisibilityChange {
  uuid: string;
  name: string;
  isPublic: boolean;
}

/** What the player card may show about a player (public entries only). */
export interface PublicProfile {
  locations: PublicLocation[];
  homes: HomeCoordinates[];
}

export type AccountType = 'java' | 'bedrock' | 'admin';

export interface MinecraftAccounts {
  java: string | null;
  bedrock: string | null;
  admin: string | null;
}

export interface UserProfile {
  minecraftAccounts: MinecraftAccounts;
  savedLocations: SavedLocation[];
}

/** Error codes returned by the account link/unlink endpoints. */
export type LinkErrorCode =
  | 'invalid_request'
  | 'invalid_credentials'
  | 'not_operator'
  | 'rate_limited'
  | 'unavailable'
  | 'failed';

export const LINK_ERROR_CODES: readonly LinkErrorCode[] = [
  'invalid_request', 'invalid_credentials', 'not_operator', 'rate_limited', 'unavailable', 'failed',
];

export const LINK_ERROR_MESSAGES: Record<LinkErrorCode, string> = {
  invalid_request: 'Please enter a valid in-game name and password.',
  invalid_credentials: 'Incorrect in-game credentials. Please try again.',
  not_operator: 'Only server operators can be linked as the Admin account.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  unavailable: 'Verification is temporarily unavailable. Please try again later.',
  failed: 'Verification failed. Please try again.',
};

/** A failed link/unlink request, carrying the server's error code. */
export class AccountLinkError extends Error {
  constructor(readonly code: LinkErrorCode) {
    super(LINK_ERROR_MESSAGES[code]);
    this.name = 'AccountLinkError';
  }
}
