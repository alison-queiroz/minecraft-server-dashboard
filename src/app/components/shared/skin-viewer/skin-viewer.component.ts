import type {
  ElementRef,
  OnDestroy} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  Input,
  signal,
  ViewChild,
  inject,
} from '@angular/core';
import { SkinService } from '../../../services/skin/skin.service';
import { RAW_SKIN_RENDER_DELAY_MS } from '../../../constants/ui.constants';

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
export class SkinViewerComponent implements OnDestroy {
  private readonly skinService = inject(SkinService);

  @Input({ required: true })
  set skinUrl(value: string) {
    this.skinUrlInput.set(value);
  }

  @Input()
  set isRaw(value: boolean) {
    this.isRawInput.set(value);
  }

  @ViewChild('skinContainer', { static: false })
  private skinContainer!: ElementRef<HTMLDivElement>;

  private skinViewer: SkinViewerLike | null = null;
  private currentSkinUrl: string | null = null;
  private pendingSkinUrl: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly skinUrlInput = signal('');
  private readonly isRawInput = signal(false);
  private pendingRenderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const skinUrl = this.skinUrlInput();
      const isRaw = this.isRawInput();

      if (this.pendingRenderTimer != null) {
        clearTimeout(this.pendingRenderTimer);
        this.pendingRenderTimer = null;
      }

      if (isRaw && skinUrl) {
        this.pendingRenderTimer = setTimeout(() => {
          void this.loadAndRender(skinUrl);
        }, RAW_SKIN_RENDER_DELAY_MS);
      } else {
        this.disposeSkinViewer();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.pendingRenderTimer != null) {
      clearTimeout(this.pendingRenderTimer);
      this.pendingRenderTimer = null;
    }
    this.disposeSkinViewer();
  }

  private async loadAndRender(url: string): Promise<void> {
    this.pendingSkinUrl = url;
    const blobUrl = await this.skinService.getBlobUrl(url);
    if (this.pendingSkinUrl !== url) return;
    await this.render3D(blobUrl, url);
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
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!this.skinViewer) return;
        if (!entry) return;
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
    this.resizeObserver = null;
    if (this.skinViewer) {
      this.skinViewer.dispose();
      this.skinViewer = null;
    }
  }
}

