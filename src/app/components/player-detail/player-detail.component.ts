import {
  ChangeDetectionStrategy,
  Component,
  inject,
  ElementRef,
  ViewChild,
  effect,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { PlayerService } from '../../services/player/player.service';

declare const skinview3d: any;

@Component({
  selector: 'app-player-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './player-detail.component.html',
  styleUrls: ['./player-detail.component.scss'],
})
export class PlayerDetailComponent implements OnInit, OnDestroy {
  protected readonly service = inject(PlayerService);

  @ViewChild('skinContainer', { static: false })
  skinContainer!: ElementRef<HTMLDivElement>;
  private skinViewer: any = null;

  constructor() {
    // Watch for player selection changes and trigger the 3D render
    effect(() => {
      const player = this.service.selectedPlayer();
      if (player?.is_raw_skin) {
        // Timeout allows Angular to render the @if block first
        setTimeout(() => this.render3DSkin(player.skin_url), 50);
      } else {
        this.disposeSkinViewer();
      }
    });
  }

  ngOnInit() {
    this.loadSkinView3d();
  }

  ngOnDestroy() {
    this.disposeSkinViewer();
  }

  private loadSkinView3d() {
    if (document.getElementById('skinview3d-script')) return;
    const script = document.createElement('script');
    script.id = 'skinview3d-script';
    script.src =
      'https://unpkg.com/skinview3d@3.0.0/bundles/skinview3d.bundle.js';
    document.head.appendChild(script);
  }

  private render3DSkin(url: string) {
    if (!this.skinContainer) return;

    if (typeof skinview3d === 'undefined') {
      setTimeout(() => this.render3DSkin(url), 100);
      return;
    }

    if (!this.skinViewer) {
      this.skinViewer = new skinview3d.SkinViewer({
        canvas: document.createElement('canvas'),
        width: 220,
        height: 300,
        skin: url,
      });

      this.skinViewer.animation = new skinview3d.IdleAnimation();

      this.skinContainer.nativeElement.innerHTML = '';
      this.skinContainer.nativeElement.appendChild(this.skinViewer.canvas);
    } else {
      this.skinViewer.loadSkin(url);
    }
  }

  private disposeSkinViewer() {
    if (this.skinViewer) {
      this.skinViewer.dispose();
      this.skinViewer = null;
    }
  }
}
