import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { SkinService } from '../../../services/skin/skin.service';

interface SkinViewerLike {
  canvas: HTMLCanvasElement;
  controls?: { enablePan: boolean };
  animation: unknown;
  width: number;
  height: number;
  loadSkin(url: string): void;
  dispose(): void;
}

@Component({
  selector: 'app-skin-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skin-viewer.component.html',
  styleUrls: ['./skin-viewer.component.scss'],
})
export class SkinViewerComponent implements OnChanges, OnDestroy {
  private readonly skinService = inject(SkinService);

  @Input({ required: true }) skinUrl!: string;
  @Input() isRaw = false;

  @ViewChild('skinContainer', { static: false })
  private skinContainer!: ElementRef<HTMLDivElement>;

  private skinViewer: SkinViewerLike | null = null;
  private currentSkinUrl: string | null = null;
  private pendingSkinUrl: string | null = null;
  private resizeObserver?: ResizeObserver;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['skinUrl'] || changes['isRaw']) {
      if (this.isRaw && this.skinUrl) {
        setTimeout(() => this.loadAndRender(this.skinUrl), 50);
      } else {
        this.disposeSkinViewer();
      }
    }
  }

  ngOnDestroy(): void {
    this.disposeSkinViewer();
  }

  private async loadAndRender(url: string): Promise<void> {
    this.pendingSkinUrl = url;
    const blobUrl = await this.skinService.getBlobUrl(url);
    if (this.pendingSkinUrl !== url) return;
    this.render3D(blobUrl, url);
  }

  private async render3D(blobUrl: string, originalUrl: string): Promise<void> {
    if (!this.skinContainer) return;
    if (originalUrl === this.currentSkinUrl) return;
    this.currentSkinUrl = originalUrl;

    const containerEl = this.skinContainer.nativeElement;

    if (!this.skinViewer) {
      const { SkinViewer, IdleAnimation } = await import('skinview3d');

      // Guard: component may have been destroyed while awaiting the import
      if (!this.skinContainer) return;

      const initW = Math.max(containerEl.clientWidth  || 220, 60);
      const initH = Math.max(containerEl.clientHeight || 192, 60);

      this.skinViewer = new SkinViewer({
        canvas: document.createElement('canvas'),
        width: initW,
        height: initH,
        zoom: 0.85,
        skin: blobUrl,
      });
      this.skinViewer.animation = new IdleAnimation();
      if (this.skinViewer.controls) {
        this.skinViewer.controls.enablePan = true;
      }
      containerEl.innerHTML = '';
      containerEl.appendChild(this.skinViewer.canvas);

      // Keep canvas in sync with container dimensions
      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver(([entry]) => {
        if (!this.skinViewer) return;
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.skinViewer.width  = width;
          this.skinViewer.height = height;
        }
      });
      this.resizeObserver.observe(containerEl);
    } else {
      this.skinViewer.loadSkin(blobUrl);
    }
  }

  private disposeSkinViewer(): void {
    this.pendingSkinUrl = null;
    this.currentSkinUrl = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    if (this.skinViewer) {
      this.skinViewer.dispose();
      this.skinViewer = null;
    }
  }
}

