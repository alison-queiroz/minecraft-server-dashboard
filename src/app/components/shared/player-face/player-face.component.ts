import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Player } from '../../../services/player/player.model';

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
  readonly player    = input.required<Player>();
  readonly size      = input<number>(40);
  readonly showBadge = input<boolean>(false);

  protected readonly useRawSkin = computed(() => {
    const player = this.player();
    if (player.skin_url.includes('mc-heads.net/avatar/')) {
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

  /**
   * Requested at exactly the rendered size and loaded by the browser itself
   * (lazily, HTTP-cached), so each face is downloaded once.
   */
  protected readonly avatarSrc = computed(() => this.player().avatarUrl(this.size()));
}
