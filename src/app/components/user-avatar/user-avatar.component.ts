import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { AuthService } from '../../services/auth/auth.service';

@Component({
  selector: 'app-user-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size' },
  templateUrl: './user-avatar.component.html',
  styleUrls: ['./user-avatar.component.scss'],
})
export class UserAvatarComponent {
  /** sm = 8×8 (nav), lg = 16×16 (profile header) */
  @Input() size: 'sm' | 'lg' = 'sm';

  protected readonly auth = inject(AuthService);
}
