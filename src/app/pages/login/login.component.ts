import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth/auth.service';
import { ServerService } from '../../services/server/server.service';
import { UserProfileService } from '../../services/user-profile/user-profile.service';
import { MinecraftCredentialService } from '../../services/minecraft-credential/minecraft-credential.service';
import { ServerIconComponent } from '../../components/shared/server-icon/server-icon.component';
import { InlineErrorComponent } from '../../components/shared/inline-error/inline-error.component';
import { UiInputComponent } from '../../components/shared/ui-input/ui-input.component';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ServerIconComponent, InlineErrorComponent, UiInputComponent, FormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly server = inject(ServerService);
  private readonly profileService = inject(UserProfileService);
  private readonly minecraftCredentialService = inject(MinecraftCredentialService);

  protected readonly error = signal<string | null>(null);
  protected readonly signing = signal(false);

  /**
   * 'google'    — show the Google Sign-In button (default)
   * 'minecraft' — user is Firebase-authed but hasn't linked a Minecraft account yet;
   *               show the Minecraft credentials form
   */
  protected readonly step = signal<'google' | 'minecraft'>('google');

  protected readonly mcName = signal('');
  protected readonly mcPassword = signal('');

  async ngOnInit(): Promise<void> {
    // If the user is already Firebase-authenticated and has already linked a
    // Minecraft account, skip the login page entirely.
    if (this.auth.currentUser()) {
      await this.profileService.loadProfile();
      if (this.profileService.minecraftAccounts().java) {
        void this.router.navigate(['/']);
      } else {
        // Firebase authed but Minecraft not yet linked → skip to step 2.
        this.step.set('minecraft');
      }
    }
  }

  protected async signIn(): Promise<void> {
    this.error.set(null);
    this.signing.set(true);
    try {
      await this.auth.signInWithGoogle();
      await this.profileService.loadProfile();
      if (this.profileService.minecraftAccounts().java) {
        void this.router.navigate(['/']);
      } else {
        this.step.set('minecraft');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      this.error.set(msg);
    } finally {
      this.signing.set(false);
    }
  }

  protected async submitMinecraft(): Promise<void> {
    const name = this.mcName().trim();
    const pwd = this.mcPassword();
    if (!name || !pwd) {
      this.error.set('Please enter your in-game name and password.');
      return;
    }
    this.error.set(null);
    this.signing.set(true);
    try {
      const valid = await this.minecraftCredentialService.verify(name, pwd);
      if (!valid) {
        this.error.set('Incorrect in-game credentials. Please try again.');
        return;
      }
      await this.profileService.linkAccount('java', name);
      void this.router.navigate(['/']);
    } catch {
      this.error.set('Verification failed. Please try again.');
    } finally {
      this.signing.set(false);
    }
  }
}
