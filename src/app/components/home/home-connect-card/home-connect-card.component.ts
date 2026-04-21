import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ServerConnectionCardComponent } from '../../server/server-connection-card/server-connection-card.component';

@Component({
  selector: 'app-home-connect-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ServerConnectionCardComponent],
  templateUrl: './home-connect-card.component.html',
})
export class HomeConnectCardComponent {}
