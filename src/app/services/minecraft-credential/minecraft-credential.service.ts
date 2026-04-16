import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * Centralised service for verifying a player's AuthMe in-game credentials.
 * Used by both the login flow (gate before accessing the dashboard) and the
 * profile "Minecraft Accounts" panel (linking an account to a Google profile).
 */
@Injectable({ providedIn: 'root' })
export class MinecraftCredentialService {
  private readonly http = inject(HttpClient);

  /**
   * Verifies a Minecraft username + AuthMe password against the server.
   *
   * @returns `true` when the credentials are correct, `false` when wrong.
   * @throws on network errors or unexpected server errors (5xx).
   */
  async verify(username: string, password: string): Promise<boolean> {
    const result = await firstValueFrom(
      this.http.post<{ valid: boolean }>('/api/verify-minecraft-password', { username, password }),
    );
    return result.valid;
  }
}
