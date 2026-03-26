import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-map-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './map-viewer.component.html',
  styleUrls: ['./map-viewer.component.scss'],
})
export class MapViewerComponent implements OnChanges {
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly mapBaseUrl =
    (environment as Record<string, unknown>)['mapBaseUrl'] as string
      ?? '/map/';

  /** Navigate the embedded map to this position hash when it changes */
  @Input() navigateToHash = '';

  /** Allow the user to vertically drag-resize the iframe */
  @Input() resizable = false;

  /** Emits a normalised #world:x:y:z:... hash when the user captures a position */
  @Output() positionCaptured = new EventEmitter<string>();

  @ViewChild('mapIframe') private mapIframe?: ElementRef<HTMLIFrameElement>;

  protected readonly mapSrc = signal<SafeResourceUrl>(
    this.sanitizer.bypassSecurityTrustResourceUrl(this.mapBaseUrl)
  );
  protected readonly captureInput = signal('');
  protected readonly showCaptureInput = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['navigateToHash'] && this.navigateToHash) {
      const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
      const url = base + (this.navigateToHash.startsWith('#') ? this.navigateToHash : '#' + this.navigateToHash);
      this.mapSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    }
  }

  protected capturePosition(): void {
    try {
      const href = this.mapIframe?.nativeElement?.contentWindow?.location?.href;
      if (href && href !== 'about:blank') {
        this.positionCaptured.emit(this.normaliseHash(href));
        this.showCaptureInput.set(false);
        return;
      }
    } catch {
      // cross-origin: show paste fallback
    }
    this.showCaptureInput.set(true);
  }

  protected applyCapturedUrl(): void {
    const raw = this.captureInput().trim();
    if (!raw) return;
    this.positionCaptured.emit(this.normaliseHash(raw));
    this.showCaptureInput.set(false);
    this.captureInput.set('');
  }

  private normaliseHash(input: string): string {
    try {
      const url = new URL(input);
      return url.hash || input;
    } catch {
      return input.startsWith('#') ? input : '#' + input;
    }
  }
}
