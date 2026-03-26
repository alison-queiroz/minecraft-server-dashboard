import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type ServerIconSize = 'nav' | 'login' | 'card' | 'home';

@Component({
  selector: 'app-server-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size' },
  templateUrl: './server-icon.component.html',
  styleUrls: ['./server-icon.component.scss'],
})
export class ServerIconComponent {
  @Input() size: ServerIconSize = 'card';
}
