import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { Player } from '../../../services/player/player.model';
import { PlayerService } from '../../../services/player/player.service';

@Component({
  selector: 'app-player-face',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block relative overflow-hidden bg-stone-200 pixelated dark:bg-zinc-800' },
  imports: [],
  templateUrl: './player-face.component.html',
  styleUrls: ['./player-face.component.scss'],
})
export class PlayerFaceComponent {
  private readonly playerService = inject(PlayerService);

  readonly player    = input.required<Player>();
  readonly size      = input<number>(40);
  readonly showBadge = input<boolean>(false);

  protected readonly useRawSkin = computed(() => {
    const player = this.player();
    if (player.skin_url?.includes('mc-heads.net/avatar/')) {
      return false;
    }

    return player.is_raw_skin ?? player.isRawAvatar();
  });

  protected readonly rawSkinUrl = computed(() => this.player().skin_url || this.player().avatarUrl());

  protected readonly bgPosition = computed(() => {
    const size = this.size();
    const x = Math.round(size * 0.925);
    return `-${x}px -${size}px`;
  });

  protected readonly avatarSrc = computed(() =>
    this.playerService.getAvatarUrl(this.player().avatarUrl(this.size()))
  );
}
