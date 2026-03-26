import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerService } from '../../services/player/player.service';

@Component({
  selector: 'app-player-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './player-search.component.html',
  styleUrls: ['./player-search.component.scss'],
})
export class PlayerSearchComponent {
  protected readonly service = inject(PlayerService);
}
