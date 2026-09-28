import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProfileAccountsComponent } from './profile-accounts.component';
import type { AccountType, LinkErrorCode, MinecraftAccounts } from '../../../services/user-profile/user-profile.models';
import { AccountLinkError } from '../../../services/user-profile/user-profile.models';
import { UserProfileService } from '../../../services/user-profile/user-profile.service';
import { PlayerService } from '../../../services/player/player.service';
import { Player } from '../../../services/player/player.model';

interface Internals {
  accountInputs: () => Record<AccountType, string>;
  gamePasswords: () => Record<AccountType, string>;
  accountError: () => string | null;
  savingAccount: () => AccountType | null;
  opNames: () => string[];
  updateInput(type: AccountType, value: string): void;
  updatePassword(type: AccountType, value: string): void;
  save(type: AccountType): Promise<void>;
  unlink(type: AccountType): Promise<void>;
  availablePlayersFor(type: AccountType): string[];
}

const makePlayer = (name: string, uuid: string): Player => new Player({
  name, uuid, level: 1, health: 20, dimension: 'Overworld', pos: [0, 0, 0], last_seen: '', skin_url: '',
});

describe('ProfileAccountsComponent', () => {
  let fixture: ComponentFixture<ProfileAccountsComponent>;
  let cmp: Internals;
  let httpMock: HttpTestingController;
  let accounts: ReturnType<typeof signal<MinecraftAccounts>>;
  let profile: {
    minecraftAccounts: typeof accounts;
    isLoading: ReturnType<typeof signal<boolean>>;
    linkAccount: ReturnType<typeof vi.fn>;
    unlinkAccount: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    accounts = signal<MinecraftAccounts>({ java: 'Steve', bedrock: null, admin: null });
    profile = {
      minecraftAccounts: accounts,
      isLoading: signal(false),
      linkAccount: vi.fn().mockResolvedValue(undefined),
      unlinkAccount: vi.fn().mockResolvedValue(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [ProfileAccountsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UserProfileService, useValue: profile },
        {
          provide: PlayerService,
          useValue: {
            players: signal([
              makePlayer('Steve', '069a79f4-44e9-4726-a5be-fca90e38aaf5'),
              makePlayer('Notch', '069a79f4-44e9-4726-a5be-fca90e38aaf6'),
              makePlayer('.Bedrocker', '00000000-0000-0000-0009-01f2c3d4e5f6'),
            ]),
            getAvatarUrl: (url: string) => url,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfileAccountsComponent);
    cmp = fixture.componentInstance as unknown as Internals;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne('/api/ops').flush(['Notch']);
    await fixture.whenStable();
  });

  afterEach(() => {
    try {
      httpMock.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('prefills the linked names and restricts admin suggestions to operators', () => {
    expect(cmp.accountInputs()).toEqual({ java: 'Steve', bedrock: '', admin: '' });
    expect(cmp.availablePlayersFor('admin')).toEqual(['Notch']);
    expect(cmp.availablePlayersFor('bedrock')).toEqual(['.Bedrocker']);
    expect(cmp.availablePlayersFor('java')).toEqual(['Notch']);
  });

  it('asks for a username before linking', async () => {
    cmp.updateInput('bedrock', '   ');
    await cmp.save('bedrock');
    expect(cmp.accountError()).toContain('username');
    expect(profile.linkAccount).not.toHaveBeenCalled();
  });

  it('asks for the in-game password before linking', async () => {
    cmp.updateInput('admin', 'Notch');
    await cmp.save('admin');
    expect(cmp.accountError()).toContain('password');
    expect(profile.linkAccount).not.toHaveBeenCalled();
  });

  it('links through the server with the password and clears the form', async () => {
    cmp.updateInput('admin', ' Notch ');
    cmp.updatePassword('admin', 'secret');
    await cmp.save('admin');
    expect(profile.linkAccount).toHaveBeenCalledWith('admin', 'Notch', 'secret');
    expect(cmp.accountInputs().admin).toBe('');
    expect(cmp.gamePasswords().admin).toBe('');
    expect(cmp.savingAccount()).toBeNull();
  });

  it('changing the username drops a typed password', () => {
    cmp.updatePassword('java', 'secret');
    cmp.updateInput('java', 'Alex');
    expect(cmp.gamePasswords().java).toBe('');
  });

  it.each<[LinkErrorCode, string]>([
    ['invalid_credentials', 'Incorrect in-game credentials'],
    ['not_operator', 'server operators'],
    ['rate_limited', 'Too many attempts'],
  ])('shows the server reason (%s) when linking is refused', async (code: LinkErrorCode, message: string) => {
    profile.linkAccount.mockRejectedValueOnce(new AccountLinkError(code));
    cmp.updateInput('admin', 'Steve');
    cmp.updatePassword('admin', 'pw');
    await cmp.save('admin');
    expect(cmp.accountError()).toContain(message);
    expect(cmp.accountInputs().admin).toBe('Steve');
  });

  it('shows a generic error for unexpected failures', async () => {
    profile.linkAccount.mockRejectedValueOnce(new Error('boom'));
    cmp.updateInput('java', 'Alex');
    cmp.updatePassword('java', 'pw');
    await cmp.save('java');
    expect(cmp.accountError()).toBe('Failed to save. Please try again.');
  });

  it('unlinks through the server', async () => {
    await cmp.unlink('java');
    expect(profile.unlinkAccount).toHaveBeenCalledWith('java');
    expect(cmp.accountInputs().java).toBe('');
    expect(cmp.accountError()).toBeNull();
  });

  it('reports a failed unlink', async () => {
    profile.unlinkAccount.mockRejectedValueOnce(new AccountLinkError('unavailable'));
    await cmp.unlink('java');
    expect(cmp.accountError()).toBe('Failed to unlink. Please try again.');
    expect(cmp.savingAccount()).toBeNull();
  });
});
