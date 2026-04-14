import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { SkinViewerComponent } from './skin-viewer.component';
import { SkinService } from '../../../services/skin/skin.service';

// ---------------------------------------------------------------------------
// skinview3d mock
// ---------------------------------------------------------------------------
const mockSkinViewerInstance = {
  canvas: document.createElement('canvas'),
  controls: { enablePan: false },
  animation: null as object | null,
  width: 200,
  height: 192,
  loadSkin: jest.fn(),
  dispose: jest.fn(),
};

const MockSkinViewerCtor = jest.fn().mockImplementation(function() { return mockSkinViewerInstance; });
const MockIdleAnimationCtor = jest.fn().mockImplementation(function() { return {}; });

jest.mock('skinview3d', () => ({
  SkinViewer: MockSkinViewerCtor,
  IdleAnimation: MockIdleAnimationCtor,
}));

// ---------------------------------------------------------------------------
// ResizeObserver mock
// ---------------------------------------------------------------------------
const mockObserve = jest.fn();
const mockRODisconnect = jest.fn();
let capturedResizeCallback: ResizeObserverCallback | null = null;

class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    capturedResizeCallback = cb;
  }
  observe = mockObserve;
  disconnect = mockRODisconnect;
  unobserve = jest.fn();
}

(globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = MockResizeObserver as typeof ResizeObserver;

// ---------------------------------------------------------------------------
// SkinService mock
// ---------------------------------------------------------------------------
const mockGetBlobUrl = jest.fn().mockResolvedValue('blob:fake-url');

class MockSkinService {
  getBlobUrl = mockGetBlobUrl;
  async getBlobUrlFallback(url: string): Promise<string> { return url; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function flushEffects(): void {
  TestBed.inject(ApplicationRef).tick();
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SkinViewerComponent', () => {
  let fixture: ComponentFixture<SkinViewerComponent>;
  let component: SkinViewerComponent;

  beforeEach(async () => {
    jest.useFakeTimers();
    mockGetBlobUrl.mockClear();
    mockSkinViewerInstance.loadSkin.mockClear();
    mockSkinViewerInstance.dispose.mockClear();
    MockSkinViewerCtor.mockClear();
    mockObserve.mockClear();
    mockRODisconnect.mockClear();
    capturedResizeCallback = null;

    await TestBed.configureTestingModule({
      imports: [SkinViewerComponent],
      providers: [
        { provide: SkinService, useClass: MockSkinService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SkinViewerComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    jest.useRealTimers();
    fixture.destroy();
  });

  // ── template rendering ────────────────────────────────────────────────────

  it('renders 3D container when isRaw is true', () => {
    fixture.componentRef.setInput('skinUrl', '');
    fixture.componentRef.setInput('isRaw', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.skin-canvas')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('img.skin-image')).toBeFalsy();
  });

  it('renders fallback image when isRaw is false', () => {
    fixture.componentRef.setInput('skinUrl', 'https://mc-heads.net/body/Steve/200');
    fixture.componentRef.setInput('isRaw', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.skin-canvas')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('img.skin-image')).toBeTruthy();
  });

  // ── isRaw=false → disposeSkinViewer ───────────────────────────────────────

  it('disposes existing viewer when isRaw switches to false', () => {
    fixture.componentRef.setInput('skinUrl', 'https://example.com/skin.png');
    fixture.componentRef.setInput('isRaw', true);
    fixture.detectChanges();
    flushEffects();

    // Simulate a viewer already being active
    (component as unknown as { skinViewer: unknown }).skinViewer = mockSkinViewerInstance;

    fixture.componentRef.setInput('isRaw', false);
    fixture.detectChanges();
    flushEffects();

    expect(mockSkinViewerInstance.dispose).toHaveBeenCalled();
  });

  it('does not start a getBlobUrl call when isRaw is false', () => {
    fixture.componentRef.setInput('skinUrl', 'https://example.com/skin.png');
    fixture.componentRef.setInput('isRaw', false);
    fixture.detectChanges();
    flushEffects();

    jest.advanceTimersByTime(200);
    expect(mockGetBlobUrl).not.toHaveBeenCalled();
  });

  // ── isRaw=true + skinUrl → delayed loadAndRender ──────────────────────────

  it('calls getBlobUrl after the delay when isRaw=true and skinUrl is set', () => {
    fixture.componentRef.setInput('isRaw', true);
    fixture.componentRef.setInput('skinUrl', 'https://example.com/skin.png');
    fixture.detectChanges();
    flushEffects();

    jest.advanceTimersByTime(200);

    expect(mockGetBlobUrl).toHaveBeenCalledWith('https://example.com/skin.png');
  });

  it('does not call getBlobUrl when skinUrl is empty', () => {
    fixture.componentRef.setInput('isRaw', true);
    fixture.componentRef.setInput('skinUrl', '');
    fixture.detectChanges();
    flushEffects();
    jest.advanceTimersByTime(200);
    expect(mockGetBlobUrl).not.toHaveBeenCalled();
  });

  it('cancels the pending timer when skinUrl changes before it fires', async () => {
    fixture.componentRef.setInput('isRaw', true);
    fixture.componentRef.setInput('skinUrl', 'https://example.com/skin1.png');
    fixture.detectChanges();
    flushEffects();

    fixture.componentRef.setInput('skinUrl', 'https://example.com/skin2.png');
    fixture.detectChanges();
    flushEffects();

    jest.advanceTimersByTime(200);
    await flushMicrotasks();

    expect(mockGetBlobUrl).toHaveBeenCalledWith('https://example.com/skin2.png');
    expect(mockGetBlobUrl).not.toHaveBeenCalledWith('https://example.com/skin1.png');
  });

  // ── loadAndRender race condition ──────────────────────────────────────────

  it('aborts render when URL changes while getBlobUrl is pending', async () => {
    fixture.componentRef.setInput('isRaw', true);
    fixture.componentRef.setInput('skinUrl', 'https://example.com/v1.png');
    fixture.detectChanges();
    flushEffects();

    let resolve1!: (v: string) => void;
    mockGetBlobUrl.mockReturnValueOnce(new Promise(r => { resolve1 = r; }));

    jest.advanceTimersByTime(200);

    // URL changes before first promise resolves
    fixture.componentRef.setInput('skinUrl', 'https://example.com/v2.png');
    fixture.detectChanges();
    flushEffects();
    jest.advanceTimersByTime(200);

    // Resolve the stale promise
    resolve1('blob:late-url');
    await flushMicrotasks();

    const staleCall = MockSkinViewerCtor.mock.calls.find(
      (c: unknown[]) => (c[0] as { skin?: string })?.skin === 'blob:late-url'
    );
    expect(staleCall).toBeUndefined();
  });

  // ── skinContainer absent ──────────────────────────────────────────────────

  it('does nothing in render3D when skinContainer is undefined', async () => {
    fixture.componentRef.setInput('isRaw', true);
    fixture.componentRef.setInput('skinUrl', 'https://example.com/skin.png');
    fixture.detectChanges();
    flushEffects();
    // Explicitly clear the ViewChild reference to test the guard branch
    (component as unknown as { skinContainer: unknown }).skinContainer = undefined;
    jest.advanceTimersByTime(200);
    await flushMicrotasks();
    expect(MockSkinViewerCtor).not.toHaveBeenCalled();
  });

  it('does nothing in render3D when document is unavailable', async () => {
    const originalCreateElement = globalThis.document.createElement;
    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 200, clientHeight: 192, innerHTML: '', appendChild: jest.fn() },
    };
    Object.defineProperty(globalThis.document, 'createElement', {
      configurable: true,
      value: undefined,
    });

    await (component as unknown as { render3D(blobUrl: string, originalUrl: string): Promise<void> })
      .render3D('blob:no-doc', 'https://example.com/no-doc.png');

    expect(MockSkinViewerCtor).not.toHaveBeenCalled();

    Object.defineProperty(globalThis.document, 'createElement', {
      configurable: true,
      value: originalCreateElement,
    });
  });

  // ── render3D reuses existing viewer when same URL already displayed ───────

  it('skips creating a new SkinViewer when the same URL is already rendered', async () => {
    fixture.componentRef.setInput('isRaw', true);
    fixture.componentRef.setInput('skinUrl', 'https://example.com/skin.png');
    fixture.detectChanges();
    flushEffects();

    // Pre-set currentSkinUrl and skinContainer to simulate already-rendered state
    (component as unknown as { currentSkinUrl: string }).currentSkinUrl = 'https://example.com/skin.png';
    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 200, clientHeight: 192, innerHTML: '', appendChild: jest.fn() },
    };

    jest.advanceTimersByTime(200);
    await flushMicrotasks();

    expect(MockSkinViewerCtor).not.toHaveBeenCalled();
  });

  it('calls loadSkin when a viewer already exists', async () => {
    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 200, clientHeight: 192, innerHTML: '', appendChild: jest.fn() },
    };
    (component as unknown as { skinViewer: unknown }).skinViewer = mockSkinViewerInstance;

    await (component as unknown as { render3D(blobUrl: string, originalUrl: string): Promise<void> })
      .render3D('blob:new-url', 'https://example.com/new.png');

    expect(mockSkinViewerInstance.loadSkin).toHaveBeenCalledWith('blob:new-url');
  });

  it('resets currentSkinUrl when SkinViewer construction throws', async () => {
    MockSkinViewerCtor.mockImplementationOnce(function() { throw new Error('viewer init failed'); });
    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 200, clientHeight: 192, innerHTML: '', appendChild: jest.fn() },
    };

    await (component as unknown as { render3D(blobUrl: string, originalUrl: string): Promise<void> })
      .render3D('blob:bad', 'https://example.com/bad.png');

    expect((component as unknown as { currentSkinUrl: string | null }).currentSkinUrl).toBeNull();
  });

  it('creates a SkinViewer and wires ResizeObserver when skinContainer exists', async () => {
    const appendChild = jest.fn();
    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 240, clientHeight: 200, innerHTML: '', appendChild },
    };

    await (component as unknown as { render3D(blobUrl: string, originalUrl: string): Promise<void> })
      .render3D('blob:new', 'https://example.com/new.png');

    expect(MockSkinViewerCtor).toHaveBeenCalled();
    expect(mockObserve).toHaveBeenCalled();
    expect(appendChild).toHaveBeenCalled();
  });

  it('returns after import when skinContainer is cleared before viewer creation finishes', async () => {
    const appendChild = jest.fn();
    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 240, clientHeight: 200, innerHTML: '', appendChild },
    };

    const renderPromise = (component as unknown as { render3D(blobUrl: string, originalUrl: string): Promise<void> })
      .render3D('blob:late', 'https://example.com/late.png');
    (component as unknown as { skinContainer?: unknown }).skinContainer = undefined;

    await renderPromise;

    expect(appendChild).not.toHaveBeenCalled();
  });

  it('handles resize callback guard branches safely', async () => {
    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 240, clientHeight: 200, innerHTML: '', appendChild: jest.fn() },
    };

    await (component as unknown as { render3D(blobUrl: string, originalUrl: string): Promise<void> })
      .render3D('blob:resize', 'https://example.com/resize.png');

    expect(capturedResizeCallback).toBeTruthy();

    // No entries -> early return via !entry guard
    capturedResizeCallback?.([], {} as ResizeObserver);

    // No skinViewer -> early return via !this.skinViewer guard
    (component as unknown as { skinViewer: unknown }).skinViewer = null;
    capturedResizeCallback?.([{ contentRect: { width: 10, height: 10 } } as ResizeObserverEntry], {} as ResizeObserver);
  });

  it('updates viewer width and height on positive ResizeObserver dimensions', async () => {
    const appendChild = jest.fn();
    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 240, clientHeight: 200, innerHTML: '', appendChild },
    };

    await (component as unknown as { render3D(blobUrl: string, originalUrl: string): Promise<void> })
      .render3D('blob:resize-positive', 'https://example.com/resize-positive.png');

    capturedResizeCallback?.([{ contentRect: { width: 321, height: 222 } } as ResizeObserverEntry], {} as ResizeObserver);

    expect(mockSkinViewerInstance.width).toBe(321);
    expect(mockSkinViewerInstance.height).toBe(222);
  });

  it('supports viewers without controls and ignores non-positive resize values', async () => {
    const controlLessViewer = {
      ...mockSkinViewerInstance,
      controls: undefined,
      canvas: document.createElement('canvas'),
      width: 200,
      height: 192,
      loadSkin: jest.fn(),
      dispose: jest.fn(),
    };
    MockSkinViewerCtor.mockImplementationOnce(function() { return controlLessViewer; });

    (component as unknown as { skinContainer: unknown }).skinContainer = {
      nativeElement: { clientWidth: 240, clientHeight: 200, innerHTML: '', appendChild: jest.fn() },
    };

    await (component as unknown as { render3D(blobUrl: string, originalUrl: string): Promise<void> })
      .render3D('blob:nocontrol', 'https://example.com/nocontrol.png');

    const prevW = controlLessViewer.width;
    const prevH = controlLessViewer.height;
    capturedResizeCallback?.([{ contentRect: { width: 0, height: 0 } } as ResizeObserverEntry], {} as ResizeObserver);
    expect(controlLessViewer.width).toBe(prevW);
    expect(controlLessViewer.height).toBe(prevH);
  });

  // ── ngOnDestroy ───────────────────────────────────────────────────────────

  it('clears pending timer on destroy', () => {
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    fixture.componentRef.setInput('isRaw', true);
    fixture.componentRef.setInput('skinUrl', 'https://example.com/skin.png');
    fixture.detectChanges();
    flushEffects();
    fixture.destroy();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('destroys without error even if no timer or viewer is active', () => {
    fixture.detectChanges();
    flushEffects();
    expect(() => fixture.destroy()).not.toThrow();
  });
});



