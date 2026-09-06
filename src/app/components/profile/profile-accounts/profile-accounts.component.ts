import type {
  OnInit} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LucideX } from '@lucide/angular';
import type { AccountType } from '../../../services/user-profile/user-profile.service';
import { UserProfileService } from '../../../services/user-profile/user-profile.service';
import { PlayerService } from '../../../services/player/player.service';
import type { Player } from '../../../services/player/player.model';
import { PlayerFaceComponent } from '../../shared/player-face/player-face.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { IconButtonComponent } from '../../shared/icon-button/icon-button.component';
import { ActionButtonComponent } from '../../shared/action-button/action-button.component';
import { UiInputComponent } from '../../shared/ui-input/ui-input.component';
import { MinecraftCredentialService } from '../../../services/minecraft-credential/minecraft-credential.service';

@Component({
  selector: 'app-profile-accounts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerFaceComponent, IconComponent, IconButtonComponent, ActionButtonComponent, UiInputComponent],
  templateUrl: './profile-accounts.component.html',
  styleUrls: ['./profile-accounts.component.scss'],
})
export class ProfileAccountsComponent implements OnInit {
  protected readonly LucideX = LucideX;
  protected readonly profileService = inject(UserProfileService);
  private readonly playerService = inject(PlayerService);
  private readonly http = inject(HttpClient);
  private readonly minecraftCredentialService = inject(MinecraftCredentialService);

  protected readonly accountInputs = signal({ java: '', bedrock: '', admin: '' });
  protected readonly gamePasswords = signal({ java: '', bedrock: '', admin: '' });
  protected readonly savingAccount = signal<AccountType | null>(null);
  protected readonly accountError = signal<string | null>(null);
  /** Names from ops.json — only these appear in the admin dropdown. */
  protected readonly opNames = signal<string[]>([]);

  /** Players not already linked to any account type */
  protected readonly availablePlayers = computed(() => {
    const linked = new Set(
      Object.values(this.profileService.minecraftAccounts()).filter((v): v is string => !!v)
    );
    return this.playerService.players().map(p => p.name).filter(n => !linked.has(n));
  });

  protected readonly availableJavaPlayers = computed(() =>
    this.playerService.players()
      .filter(p => !p.isBedrock())
      .map(p => p.name)
      .filter(n => !this.profileService.minecraftAccounts().java || this.profileService.minecraftAccounts().java !== n)
  );

  protected readonly availableBedrockPlayers = computed(() =>
    this.playerService.players()
      .filter(p => p.isBedrock())
      .map(p => p.name)
      .filter(n => !this.profileService.minecraftAccounts().bedrock || this.profileService.minecraftAccounts().bedrock !== n)
  );

  /** Admin dropdown is restricted to OP players only. */
  protected readonly availableAdminPlayers = computed(() => {
    const ops = new Set(this.opNames());
    const current = this.profileService.minecraftAccounts().admin;
    return this.playerService.players()
      .map(p => p.name)
      .filter(n => ops.has(n) && n !== current);
  });

  protected findPlayer(username: string | null | undefined): Player | null {
    if (!username) return null;
    return this.playerService.players().find(p => p.name === username) ?? null;
  }

  /** Finds a Java (non-Bedrock) player by username. */
  protected findJavaPlayer(username: string | null | undefined): Player | null {
    if (!username) return null;
    return this.playerService.players().find(p => p.name === username && !p.isBedrock()) ?? null;
  }

  /** Finds a Bedrock player by username. */
  protected findBedrockPlayer(username: string | null | undefined): Player | null {
    if (!username) return null;
    return this.playerService.players().find(p => p.name === username && p.isBedrock()) ?? null;
  }

  ngOnInit(): void {
    const accts = this.profileService.minecraftAccounts();
    this.accountInputs.set({
      java: accts.java ?? '',
      bedrock: accts.bedrock ?? '',
      admin: accts.admin ?? '',
    });
    firstValueFrom(this.http.get<string[]>('/api/ops'))
      .then(names => this.opNames.set(names))
      .catch(() => { /* non-critical — dropdown falls back to empty */ });
  }

  protected updateInput(type: AccountType, value: string): void {
    this.accountInputs.update(v => ({ ...v, [type]: value }));
    // Clear the password whenever the username changes so stale passwords don't carry over.
    this.gamePasswords.update(v => ({ ...v, [type]: '' }));
    this.accountError.set(null);
  }

  protected updatePassword(type: AccountType, value: string): void {
    this.gamePasswords.update(v => ({ ...v, [type]: value }));
  }

  protected async save(type: AccountType): Promise<void> {
    const username = this.accountInputs()[type].trim();
    if (!username) { this.accountError.set('Please enter a username.'); return; }

    this.accountError.set(null);
    this.savingAccount.set(type);
    try {
      const password = this.gamePasswords()[type];
      if (!password) {
        this.accountError.set('Please enter your in-game password to verify ownership.');
        return;
      }
      const valid = await this.minecraftCredentialService.verify(username, password);
      if (!valid) {
        this.accountError.set('Incorrect in-game password. Please try again.');
        return;
      }

      await this.profileService.linkAccount(type, username);
      this.accountInputs.update(v => ({ ...v, [type]: '' }));
      this.gamePasswords.update(v => ({ ...v, [type]: '' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.accountError.set(msg.includes('permission') || msg.includes('insufficient')
        ? 'Permission denied. Check your Firestore rules or try again.'
        : 'Failed to save. Please try again.');
    } finally {
      this.savingAccount.set(null);
    }
  }

  protected async unlink(type: AccountType): Promise<void> {
    this.accountError.set(null);
    this.savingAccount.set(type);
    try {
      await this.profileService.unlinkAccount(type);
      this.accountInputs.update(v => ({ ...v, [type]: '' }));
      this.gamePasswords.update(v => ({ ...v, [type]: '' }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.accountError.set(msg.includes('permission') || msg.includes('insufficient')
        ? 'Permission denied. Check your Firestore rules or try again.'
        : 'Failed to unlink. Please try again.');
    } finally {
      this.savingAccount.set(null);
    }
  }
}
