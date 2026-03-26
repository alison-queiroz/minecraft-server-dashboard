import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { UserProfileService, AccountType } from '../../services/user-profile/user-profile.service';
import { PlayerService } from '../../services/player/player.service';

@Component({
  selector: 'app-profile-accounts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './profile-accounts.component.html',
  styleUrls: ['./profile-accounts.component.scss'],
})
export class ProfileAccountsComponent implements OnInit {
  protected readonly profileService = inject(UserProfileService);
  private readonly playerService = inject(PlayerService);

  protected readonly accountInputs = signal({ java: '', bedrock: '', admin: '' });
  protected readonly savingAccount = signal<AccountType | null>(null);
  protected readonly accountError = signal<string | null>(null);

  /** Players not already linked to any account type */
  protected readonly availablePlayers = computed(() => {
    const linked = new Set(
      Object.values(this.profileService.minecraftAccounts()).filter((v): v is string => !!v)
    );
    return this.playerService.players().map(p => p.name).filter(n => !linked.has(n));
  });

  ngOnInit(): void {
    const accts = this.profileService.minecraftAccounts();
    this.accountInputs.set({
      java: accts.java ?? '',
      bedrock: accts.bedrock ?? '',
      admin: accts.admin ?? '',
    });
  }

  protected updateInput(type: AccountType, value: string): void {
    this.accountInputs.update(v => ({ ...v, [type]: value }));
  }

  protected async save(type: AccountType): Promise<void> {
    const username = this.accountInputs()[type].trim();
    if (!username) { this.accountError.set('Please enter a username.'); return; }
    this.accountError.set(null);
    this.savingAccount.set(type);
    try {
      await this.profileService.linkAccount(type, username);
    } finally {
      this.savingAccount.set(null);
    }
  }
}
