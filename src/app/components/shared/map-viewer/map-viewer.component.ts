import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LucideMapPin } from '@lucide/angular';
import { IconComponent } from '../icon/icon.component';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-map-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.h-full]': 'fillHeight', '[class.flex]': 'fillHeight', '[class.flex-col]': 'fillHeight' },
  imports: [IconComponent],
  templateUrl: './map-viewer.component.html',
  styleUrls: ['./map-viewer.component.scss'],
})
export class MapViewerComponent implements OnInit, OnChanges, OnDestroy {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly LucideMapPin = LucideMapPin;

  protected readonly mapBaseUrl =
    (environment as Record<string, unknown>)['mapBaseUrl'] as string
      ?? '/map/';

  /** A per-instance cache-bust nonce appended as ?_r=<timestamp> so Android Chrome
   *  bypasses any BlueMap service-worker cache on every dashboard load. */
  private readonly cacheBust = '?_r=' + Date.now();

  /** Navigate the embedded map to this position hash when it changes */
  @Input() navigateToHash = '';

  /** Allow the user to vertically drag-resize the iframe */
  @Input() resizable = false;

  /** Make the iframe fill 100% of the parent height (for use in a flex/grid column) */
  @Input() fillHeight = false;

  /** Show or hide the capture-position toolbar below the iframe */
  @Input() showCapture = true;

  /** Emits a normalised #world:x:y:z:... hash when the user captures a position */
  @Output() positionCaptured = new EventEmitter<string>();

  @ViewChild('mapIframe') private mapIframe?: ElementRef<HTMLIFrameElement>;

  protected readonly mapSrc = signal<SafeResourceUrl>(
    this.sanitizer.bypassSecurityTrustResourceUrl(this.mapBaseUrl + this.cacheBust)
  );
  protected readonly captureInput = signal('');
  protected readonly showCaptureInput = signal(false);

  /** Last known href from the map iframe, received via postMessage from BlueMap */
  private lastKnownHref = '';
  private urlPollInterval?: ReturnType<typeof setInterval>;

  /** Bound postMessage listener — stored so we can removeEventListener correctly */
  private readonly onMessage = (e: MessageEvent) => {
    if (e.data?.type !== 'bluemap-url') return;
    const href = e.data.href as string;
    if (!href) return;
    this.lastKnownHref = href;
  };

  ngOnInit(): void {
    window.addEventListener('message', this.onMessage);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['navigateToHash'] && this.navigateToHash) {
      const base = this.mapBaseUrl.endsWith('/') ? this.mapBaseUrl : this.mapBaseUrl + '/';
      const url = base + this.cacheBust + (this.navigateToHash.startsWith('#') ? this.navigateToHash : '#' + this.navigateToHash);
      this.mapSrc.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.onMessage);
    this.stopUrlPoller();
  }

  protected capturePosition(): void {
    let href = '';
    try {
      href = this.mapIframe?.nativeElement?.contentWindow?.location?.href ?? '';
    } catch { /* cross-origin */ }

    if (!href || href === 'about:blank') {
      href = this.lastKnownHref;
    }

    // Always show the input so the user can review / confirm; pre-fill if we have a URL
    if (href && href !== 'about:blank') {
      this.captureInput.set(href);
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

  /**
   * Called when the iframe finishes loading. Briefly nudges the iframe width by
   * 1 px so the iframe viewport fires a resize event, which causes BlueMap/
   * Leaflet to call invalidateSize() and clear grey tiles.
   */
  protected onIframeLoad(): void {
    const nudge = () => {
      const el = this.mapIframe?.nativeElement;
      if (!el) return;
      el.style.width = 'calc(100% - 1px)';
      requestAnimationFrame(() => { el.style.width = ''; });
    };
    nudge();
    setTimeout(nudge, 250);
    setTimeout(nudge, 900);

    // Poll the iframe URL every 500 ms.
    // BlueMap uses history.replaceState (not hashchange/popstate) so event
    // listeners don't fire — polling is the only reliable approach.
    this.startUrlPoller();
  }

  private startUrlPoller(): void {
    this.stopUrlPoller();
    // Also try direct same-origin read (works if a /map/ proxy is configured)
    this.urlPollInterval = setInterval(() => {
      try {
        const href = this.mapIframe?.nativeElement?.contentWindow?.location?.href;
        if (href && href !== 'about:blank') this.lastKnownHref = href;
      } catch {
        // Cross-origin: stop polling, rely on postMessage from sub_filter injection
        this.stopUrlPoller();
      }
    }, 500);
  }

  private stopUrlPoller(): void {
    if (this.urlPollInterval != null) {
      clearInterval(this.urlPollInterval);
      this.urlPollInterval = undefined;
    }
  }
}
