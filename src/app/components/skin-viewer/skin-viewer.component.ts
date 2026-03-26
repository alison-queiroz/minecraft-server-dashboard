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
import { SkinService } from '../../services/skin/skin.service';

declare const skinview3d: any;

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

  private skinViewer: any = null;
  private currentSkinUrl: string | null = null;
  private pendingSkinUrl: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['skinUrl'] || changes['isRaw']) {
      if (this.isRaw && this.skinUrl) {
        this.skinService.ensureSkinView3dLoaded();
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

  private render3D(blobUrl: string, originalUrl: string): void {
    if (!this.skinContainer) return;
    if (typeof skinview3d === 'undefined') {
      setTimeout(() => this.render3D(blobUrl, originalUrl), 100);
      return;
    }
    if (originalUrl === this.currentSkinUrl) return;
    this.currentSkinUrl = originalUrl;
    if (!this.skinViewer) {
      this.skinViewer = new skinview3d.SkinViewer({
        canvas: document.createElement('canvas'),
        width: 220,
        height: 300,
        zoom: 0.62,
        skin: blobUrl,
      });
      this.skinViewer.animation = new skinview3d.IdleAnimation();
      this.skinContainer.nativeElement.innerHTML = '';
      this.skinContainer.nativeElement.appendChild(this.skinViewer.canvas);
    } else {
      this.skinViewer.loadSkin(blobUrl);
    }
  }

  private disposeSkinViewer(): void {
    this.pendingSkinUrl = null;
    this.currentSkinUrl = null;
    if (this.skinViewer) {
      this.skinViewer.dispose();
      this.skinViewer = null;
    }
  }
}
