import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth/auth.service';
import { ServerService } from '../../services/server/server.service';
import { AccountLinkError, LINK_ERROR_MESSAGES } from '../../services/user-profile/user-profile.models';
import { LinkedAccessService } from '../../services/user-profile/linked-access.service';
import { UserProfileService } from '../../services/user-profile/user-profile.service';
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
  private readonly access = inject(LinkedAccessService);

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
      await this.continueByLinkStatus();
    } else {
      // About to show the Google button: get the popup machinery ready so
      // Safari/iOS don't block the popup on the first tap.
      this.auth.warmUpSignIn();
    }
  }

  protected async signIn(): Promise<void> {
    this.error.set(null);
    this.signing.set(true);
    try {
      await this.auth.signInWithGoogle();
      await this.continueByLinkStatus();
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
      // The server verifies the AuthMe password and writes the link itself.
      await this.profileService.linkAccount('java', name, pwd);
      void this.router.navigate(['/']);
    } catch (err) {
      this.error.set(err instanceof AccountLinkError ? LINK_ERROR_MESSAGES[err.code] : LINK_ERROR_MESSAGES.failed);
    } finally {
      this.signing.set(false);
    }
  }

  /**
   * Same rule as the route guard (GET /api/profile, no Firestore SDK): any
   * linked account — java, bedrock or admin — goes straight in; otherwise
   * continue to the Minecraft step.
   */
  private async continueByLinkStatus(): Promise<void> {
    if (await this.access.fetchLinkedStatus()) {
      void this.router.navigate(['/']);
    } else {
      this.step.set('minecraft');
    }
  }
}
