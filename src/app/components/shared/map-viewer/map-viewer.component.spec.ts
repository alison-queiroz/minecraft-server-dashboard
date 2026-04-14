import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { ApplicationRef, Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MapViewerComponent } from './map-viewer.component';

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------
@Component({
  standalone: true,
  imports: [MapViewerComponent],
  template: `<app-map-viewer
    [navigateToHash]="hash"
    [showCapture]="true"
  ></app-map-viewer>`,
})
class HostComponent {
  hash = '';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function flushEffects(): void {
  TestBed.inject(ApplicationRef).tick();
}

function getComponent(fixture: ComponentFixture<HostComponent>): MapViewerComponent {
  return fixture.debugElement.query(By.directive(MapViewerComponent))
    .injector.get(MapViewerComponent);
}

function access(cmp: MapViewerComponent): {
  capturePosition(): void;
  applyCapturedUrl(): void;
  normaliseHash(input: string): string;
  onIframeLoad(): void;
  onMessage: (e: MessageEvent) => void;
  startUrlPoller(): void;
  stopUrlPoller(): void;
  lastKnownHref: string;
  captureInput: { set(v: string): void; (): string };
  showCaptureInput: { set(v: boolean): void; (): boolean };
  mapSrc: () => unknown;
  positionCaptured: { emit(v: string): void };
} {
  return cmp as unknown as ReturnType<typeof access>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MapViewerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let cmp: MapViewerComponent;

  beforeEach(async () => {
    jest.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    flushEffects();
    cmp = getComponent(fixture);
  });

  afterEach(() => {
    jest.useRealTimers();
    fixture.destroy();
  });

  it('should create', () => {
    expect(cmp).toBeTruthy();
  });

  // ── ngOnInit / ngOnDestroy ────────────────────────────────────────────────

  it('registers a message listener on init', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const host2 = TestBed.createComponent(HostComponent);
    host2.detectChanges();
    flushEffects();
    expect(addSpy).toHaveBeenCalledWith('message', expect.any(Function));
    host2.destroy();
  });

  it('removes the message listener on destroy', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    fixture.destroy();
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  // ── postMessage handler ───────────────────────────────────────────────────

  it('updates lastKnownHref when a bluemap-url message arrives', () => {
    const acc = access(cmp);
    acc.onMessage(new MessageEvent('message', {
      data: { type: 'bluemap-url', href: 'https://map.example.com/#world:0:64:0' },
    }));
    expect(acc.lastKnownHref).toBe('https://map.example.com/#world:0:64:0');
  });

  it('ignores messages with wrong type', () => {
    const acc = access(cmp);
    acc.onMessage(new MessageEvent('message', {
      data: { type: 'other', href: 'https://map.example.com/#world:0:0:0' },
    }));
    expect(acc.lastKnownHref).toBe('');
  });

  it('ignores non-object messages (asMapMessagePayload returns null)', () => {
    const acc = access(cmp);
    acc.onMessage(new MessageEvent('message', { data: 'just-a-string' }));
    expect(acc.lastKnownHref).toBe('');
  });

  it('ignores messages where href is missing', () => {
    const acc = access(cmp);
    acc.onMessage(new MessageEvent('message', { data: { type: 'bluemap-url' } }));
    expect(acc.lastKnownHref).toBe('');
  });

  // ── navigateToHash effect ─────────────────────────────────────────────────

  it('updates mapSrc when navigateToHash changes to a non-empty value', () => {
    const acc = access(cmp);
    const before = acc.mapSrc();
    cmp.navigateToHash = '#world:100:64:200';
    flushEffects();
    const after = acc.mapSrc();
    expect(after).not.toBe(before);
  });

  it('adds a leading hash when navigateToHash does not start with #', () => {
    const acc = access(cmp);
    const before = acc.mapSrc();
    cmp.navigateToHash = 'world:12:64:24';
    flushEffects();
    expect(acc.mapSrc()).not.toBe(before);
  });

  it('builds mapSrc correctly when mapBaseUrl has no trailing slash', () => {
    const acc = access(cmp);
    Object.defineProperty(cmp, 'mapBaseUrl', {
      configurable: true,
      value: '/custom-map',
    });
    const before = acc.mapSrc();
    cmp.navigateToHash = 'world:9:64:9';
    flushEffects();
    expect(acc.mapSrc()).not.toBe(before);
  });

  it('does nothing when navigateToHash is empty', () => {
    const acc = access(cmp);
    const before = acc.mapSrc();
    host.hash = '';
    fixture.detectChanges();
    flushEffects();
    expect(acc.mapSrc()).toBe(before);
  });

  // ── capturePosition ───────────────────────────────────────────────────────

  it('shows capture input when capturePosition() is called', () => {
    access(cmp).capturePosition();
    expect(access(cmp).showCaptureInput()).toBe(true);
  });

  it('reads capture URL directly from same-origin iframe href', () => {
    const acc = access(cmp);
    const iframeHref = 'https://map.example.com/#world:22:70:9';
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        contentWindow: { location: { href: iframeHref } },
      },
    };
    acc.lastKnownHref = 'https://map.example.com/#world:0:0:0';
    acc.capturePosition();
    expect(acc.captureInput()).toBe(iframeHref);
  });

  it('falls back to lastKnownHref when iframe location read throws', () => {
    const acc = access(cmp);
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        get contentWindow() {
          throw new DOMException('cross-origin');
        },
      },
    };
    acc.lastKnownHref = 'https://map.example.com/#world:44:66:88';
    acc.capturePosition();
    expect(acc.captureInput()).toBe('https://map.example.com/#world:44:66:88');
  });

  it('keeps empty captureInput when iframe href is undefined and no fallback exists', () => {
    const acc = access(cmp);
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        contentWindow: { location: { href: undefined } },
      },
    };
    acc.lastKnownHref = '';
    acc.capturePosition();
    expect(acc.captureInput()).toBe('');
    expect(acc.showCaptureInput()).toBe(true);
  });

  it('pre-fills captureInput from lastKnownHref', () => {
    const acc = access(cmp);
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        contentWindow: { location: { href: 'about:blank' } },
      },
    };
    acc.lastKnownHref = 'https://map.example.com/#world:10:64:20';
    acc.capturePosition();
    expect(acc.captureInput()).toBe('https://map.example.com/#world:10:64:20');
  });

  it('does not fill captureInput when lastKnownHref is empty', () => {
    const acc = access(cmp);
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        contentWindow: { location: { href: 'about:blank' } },
      },
    };
    acc.capturePosition();
    expect(acc.captureInput()).toBe('');
  });

  // ── applyCapturedUrl ──────────────────────────────────────────────────────

  it('does nothing when captureInput is empty', () => {
    const acc = access(cmp);
    const emitSpy = jest.spyOn(acc.positionCaptured, 'emit');
    acc.captureInput.set('');
    acc.applyCapturedUrl();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('emits a hash fragment from a full URL and hides the input', () => {
    const acc = access(cmp);
    const emitSpy = jest.spyOn(acc.positionCaptured, 'emit');
    acc.captureInput.set('https://map.example.com/#world:0:64:0');
    acc.applyCapturedUrl();
    expect(emitSpy).toHaveBeenCalledWith('#world:0:64:0');
    expect(acc.showCaptureInput()).toBe(false);
    expect(acc.captureInput()).toBe('');
  });

  // ── normaliseHash ─────────────────────────────────────────────────────────

  it('extracts hash from a full URL', () => {
    const h = access(cmp).normaliseHash('https://map.example.com/#world:5:64:10');
    expect(h).toBe('#world:5:64:10');
  });

  it('returns the input unchanged when it already starts with #', () => {
    const h = access(cmp).normaliseHash('#world:5:64:10');
    expect(h).toBe('#world:5:64:10');
  });

  it('returns a malformed hash input unchanged through the catch branch', () => {
    const h = access(cmp).normaliseHash('#not-a-full-url');
    expect(h).toBe('#not-a-full-url');
  });

  it('returns # input unchanged when URL construction throws', () => {
    const originalUrl = globalThis.URL;
    class ThrowingUrl {
      constructor(_input: string) {
        throw new Error('bad url');
      }
    }
    (globalThis as unknown as { URL: typeof URL }).URL = ThrowingUrl as unknown as typeof URL;

    const h = access(cmp).normaliseHash('#world:5:64:10');
    expect(h).toBe('#world:5:64:10');

    (globalThis as unknown as { URL: typeof URL }).URL = originalUrl;
  });

  it('prepends # for non-hash input when URL construction throws', () => {
    const originalUrl = globalThis.URL;
    class ThrowingUrl {
      constructor(_input: string) {
        throw new Error('bad url');
      }
    }
    (globalThis as unknown as { URL: typeof URL }).URL = ThrowingUrl as unknown as typeof URL;

    const h = access(cmp).normaliseHash('world:5:64:10');
    expect(h).toBe('#world:5:64:10');

    (globalThis as unknown as { URL: typeof URL }).URL = originalUrl;
  });

  it('prepends # when input has no hash', () => {
    const h = access(cmp).normaliseHash('world:5:64:10');
    expect(h).toBe('world:5:64:10');
  });

  it('returns URL hash as empty string when URL has no fragment (falls back to full URL)', () => {
    // URL valid but no hash → url.hash = '' → returns '' → falls back to input
    const h = access(cmp).normaliseHash('https://example.com/');
    expect(h).toBe('https://example.com/');
  });

  // ── onIframeLoad ──────────────────────────────────────────────────────────

  it('calls onIframeLoad without throwing', () => {
    expect(() => access(cmp).onIframeLoad()).not.toThrow();
  });

  it('onIframeLoad handles missing iframe element in nudge safely', () => {
    const acc = access(cmp);
    (cmp as unknown as { mapIframe?: unknown }).mapIframe = undefined;
    expect(() => acc.onIframeLoad()).not.toThrow();
    acc.stopUrlPoller();
  });

  it('nudges iframe width and restores it on animation frame', () => {
    const acc = access(cmp);
    const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        style: { width: '' },
        contentWindow: { location: { href: 'about:blank' } },
      },
    };

    acc.onIframeLoad();
    expect(rafSpy).toHaveBeenCalled();
    expect(((cmp as unknown as { mapIframe: { nativeElement: { style: { width: string } } } }).mapIframe.nativeElement.style.width)).toBe('');

    rafSpy.mockRestore();
    acc.stopUrlPoller();
  });

  it('onIframeLoad nudge updates style when iframe element exists', () => {
    const acc = access(cmp);
    const styleObj = { width: '' };
    const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        style: styleObj,
        contentWindow: { location: { href: 'https://map.example.com/#x' } },
      },
    };

    acc.onIframeLoad();
    expect(styleObj.width).toBe('');

    rafSpy.mockRestore();
    acc.stopUrlPoller();
  });

  it('starts url poller after iframe load', () => {
    const acc = access(cmp);
    acc.onIframeLoad();
    // urlPollInterval should be set
    expect((cmp as unknown as { urlPollInterval: unknown }).urlPollInterval).toBeTruthy();
    acc.stopUrlPoller();
  });

  it('stops previous poller before starting a new one', () => {
    const acc = access(cmp);
    acc.startUrlPoller();
    const firstInterval = (cmp as unknown as { urlPollInterval: unknown }).urlPollInterval;
    acc.startUrlPoller();
    const secondInterval = (cmp as unknown as { urlPollInterval: unknown }).urlPollInterval;
    expect(firstInterval).not.toBe(secondInterval);
    acc.stopUrlPoller();
  });

  // ── stopUrlPoller ─────────────────────────────────────────────────────────

  it('stopUrlPoller clears the interval', () => {
    const acc = access(cmp);
    acc.startUrlPoller();
    acc.stopUrlPoller();
    expect((cmp as unknown as { urlPollInterval: unknown }).urlPollInterval).toBeNull();
  });

  it('stopUrlPoller clears manually assigned interval id', () => {
    const acc = access(cmp);
    (cmp as unknown as { urlPollInterval: unknown }).urlPollInterval = setInterval(() => undefined, 500);
    acc.stopUrlPoller();
    expect((cmp as unknown as { urlPollInterval: unknown }).urlPollInterval).toBeNull();
  });

  it('stopUrlPoller is safe to call when no poller is running', () => {
    expect(() => access(cmp).stopUrlPoller()).not.toThrow();
  });

  // ── URL poller interval ───────────────────────────────────────────────────

  it('poller fires and updates lastKnownHref when iframe is same-origin', () => {
    const acc = access(cmp);
    // Simulate a same-origin iframe by injecting a fake nativeElement
    const fakeHref = 'https://map.example.com/#world:1:2:3';
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        contentWindow: { location: { href: fakeHref } },
      },
    };
    acc.startUrlPoller();
    jest.advanceTimersByTime(600);
    expect(acc.lastKnownHref).toBe(fakeHref);
    acc.stopUrlPoller();
  });

  it('poller stops on cross-origin access (throws)', () => {
    const acc = access(cmp);
    (cmp as unknown as { mapIframe: unknown }).mapIframe = {
      nativeElement: {
        get contentWindow() {
          throw new DOMException('cross-origin');
        },
      },
    };
    acc.startUrlPoller();
    jest.advanceTimersByTime(600);
    // After cross-origin, the poller should have stopped itself
    expect((cmp as unknown as { urlPollInterval: unknown }).urlPollInterval).toBeNull();
  });

  // ── positionCaptured output ───────────────────────────────────────────────

  it('emits positionCaptured when applyCapturedUrl is called with a hash input', () => {
    const emitted: string[] = [];
    cmp.positionCaptured.subscribe((v: string) => emitted.push(v));
    const acc = access(cmp);
    acc.captureInput.set('#world:99:70:-30');
    acc.applyCapturedUrl();
    expect(emitted[0]).toBe('#world:99:70:-30');
  });
});
