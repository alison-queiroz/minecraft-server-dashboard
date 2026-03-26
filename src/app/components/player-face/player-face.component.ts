import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Player } from '../../services/player/player.model';
import { PlayerService } from '../../services/player/player.service';

@Component({
  selector: 'app-player-face',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block relative overflow-hidden pixelated bg-zinc-800' },
  imports: [],
  templateUrl: './player-face.component.html',
})
export class PlayerFaceComponent {
  private readonly playerService = inject(PlayerService);

  readonly player    = input.required<Player>();
  readonly size      = input<number>(40);
  readonly showBadge = input<boolean>(false);

  /** Shifts the 8×-scaled skin texture so the face tile is visible.
   *  x uses a 0.925 factor (empirically -37px at size 40) to align correctly. */
  protected readonly bgPosition = computed(() => {
    const s = this.size();
    const x = Math.round(s * 0.925);
    return `-${x}px -${s}px`;
  });

  protected readonly avatarSrc = computed(() =>
    this.playerService.getAvatarUrl(this.player().avatarUrl(this.size()))
  );
}
