import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth/auth.service';
import { ServerService } from '../../services/server/server.service';
import { ServerIconComponent } from '../../components/shared/server-icon/server-icon.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ServerIconComponent],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly server = inject(ServerService);

  protected readonly error = signal<string | null>(null);
  protected readonly signing = signal(false);

  protected async signIn(): Promise<void> {
    this.error.set(null);
    this.signing.set(true);
    try {
      await this.auth.signInWithGoogle();
      this.router.navigate(['/']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed. Please try again.';
      this.error.set(msg);
    } finally {
      this.signing.set(false);
    }
  }
}
