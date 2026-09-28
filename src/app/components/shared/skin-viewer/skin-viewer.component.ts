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
import type * as Skinview3d from 'skinview3d';
import { SkinService } from '../../../services/skin/skin.service';
import { RAW_SKIN_RENDER_DELAY_MS } from '../../../constants/ui.constants';

interface SkinViewerLike {
  canvas: HTMLCanvasElement;
  controls?: { enablePan: boolean };
  animation: object | null;
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

  get skinUrl(): string {
    return this.skinUrlInput();
  }

  @Input()
  set isRaw(value: boolean) {
    this.isRawInput.set(value);
  }

  get isRaw(): boolean {
    return this.isRawInput();
  }

  @ViewChild('skinContainer', { static: false })
  private skinContainer?: ElementRef<HTMLDivElement>;

  private skinViewer: SkinViewerLike | null = null;
  private currentSkinUrl: string | null = null;
  private pendingSkinUrl: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly skinUrlInput = signal('');
  private readonly isRawInput = signal(false);
  private pendingRenderTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set on destroy; the ViewChild ref is NOT cleared then, so it can't serve as the guard. */
  private destroyed = false;
  /** Bumped by every viewer creation and dispose, so a creation left waiting on the import can tell it was superseded. */
  private viewerGeneration = 0;

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
    this.destroyed = true;
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
    if (this.destroyed || !this.skinContainer) return;
    if (originalUrl === this.currentSkinUrl) return;
    const doc = globalThis.document;
    if (!doc?.createElement) return;
    this.currentSkinUrl = originalUrl;

    if (this.skinViewer) {
      this.skinViewer.loadSkin(blobUrl);
      return;
    }

    const generation = ++this.viewerGeneration;
    try {
      const skinview3d = await this.loadSkinview3d();

      // Destroyed, disposed or superseded by a newer first render while the
      // import was pending: a viewer created now would own a WebGL context
      // that nothing ever disposes.
      if (this.destroyed || generation !== this.viewerGeneration) return;
      const containerEl = this.skinContainer?.nativeElement;
      if (!containerEl) {
        this.currentSkinUrl = null;
        return;
      }

      this.mountViewer(skinview3d, doc, containerEl, blobUrl);
    } catch {
      this.currentSkinUrl = null;
    }
  }

  /** Lazy-loads the WebGL viewer bundle on first use. */
  private loadSkinview3d(): Promise<typeof Skinview3d> {
    return import('skinview3d');
  }

  private mountViewer(
    { SkinViewer, IdleAnimation }: typeof Skinview3d,
    doc: Document,
    containerEl: HTMLDivElement,
    blobUrl: string,
  ): void {
    const viewer: SkinViewerLike = new SkinViewer({
      canvas: doc.createElement('canvas'),
      width: Math.max(containerEl.clientWidth  || 220, 60),
      height: Math.max(containerEl.clientHeight || 192, 60),
      zoom: 0.85,
      skin: blobUrl,
    });
    viewer.animation = new IdleAnimation();
    this.skinViewer = viewer;
    if (viewer.controls) {
      viewer.controls.enablePan = true;
    }
    containerEl.innerHTML = '';
    containerEl.appendChild(viewer.canvas);

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
  }

  private disposeSkinViewer(): void {
    this.viewerGeneration++;
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

