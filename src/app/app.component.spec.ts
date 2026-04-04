import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { AppComponent } from './app.component';

/** Minimal stub route target to avoid importing real pages */
@Component({ standalone: true, template: '' })
class BlankComponent {}

type WritableSignalLike<T> = (() => T) & { set(value: T): void };

interface AppComponentTestAccess {
  onTouchStart(e: TouchEvent): void;
  onTouchMove(e: TouchEvent): void;
  onTouchEnd(e: TouchEvent): void;
  touchStartX: number;
  touchStartY: number;
  isDraggingHorizontal: boolean;
  skipGesture: boolean;
  dragX: WritableSignalLike<number>;
  isDragging: WritableSignalLike<boolean>;
}

function asTestAccess(component: AppComponent): AppComponentTestAccess {
  return component as unknown as AppComponentTestAccess;
}

/** Helper that creates a synthetic TouchEvent-like object */
function fakeTouchEvent(clientX: number, clientY: number, target?: Element): TouchEvent {
  return {
    touches: [{ clientX, clientY } as Touch],
    changedTouches: [{ clientX, clientY } as Touch],
    target: target ?? document.createElement('div'),
  } as unknown as TouchEvent;
}

describe('AppComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: BlankComponent },
          { path: 'server', component: BlankComponent },
          { path: 'players', component: BlankComponent },
          { path: 'profile', component: BlankComponent },
          { path: 'map', component: BlankComponent },
          { path: 'backups', component: BlankComponent },
          { path: 'analytics', component: BlankComponent },
        ]),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // Service constructors and ngOnInit fire background HTTP requests; absorb them before verifying
    httpMock.match(() => true);
    httpMock.verify();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the nav and footer', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-nav')).toBeTruthy();
    expect(el.querySelector('app-footer')).toBeTruthy();
  });

  it('should render the router outlet', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('router-outlet')).toBeTruthy();
  });

  // ── Touch gesture: onTouchStart ────────────────────────────────────────────

  it('onTouchStart sets touch coordinates and clears skipGesture for normal elements', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(120, 80));
    expect(comp.touchStartX).toBe(120);
    expect(comp.touchStartY).toBe(80);
    expect(comp.skipGesture).toBeFalse();
  });

  it('onTouchStart skips gesture when touch target is an input', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = asTestAccess(fixture.componentInstance);
    const input = document.createElement('input');
    comp.onTouchStart({ touches: [{ clientX: 50, clientY: 50 }], target: input } as unknown as TouchEvent);
    expect(comp.skipGesture).toBeTrue();
  });

  it('onTouchStart skips gesture when touch target is inside a textarea', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = asTestAccess(fixture.componentInstance);
    const textarea = document.createElement('textarea');
    const inner = document.createElement('span');
    textarea.appendChild(inner);
    comp.onTouchStart({ touches: [{ clientX: 50, clientY: 50 }], target: inner } as unknown as TouchEvent);
    expect(comp.skipGesture).toBeTrue();
  });

  // ── Touch gesture: onTouchMove ─────────────────────────────────────────────

  it('onTouchMove returns early when skipGesture is true', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = asTestAccess(fixture.componentInstance);
    comp.skipGesture = true;
    comp.onTouchMove(fakeTouchEvent(200, 50));
    expect(comp.isDragging()).toBeFalse();
  });

  it('onTouchMove returns early when dx is below 8px threshold', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(100, 50));
    comp.onTouchMove(fakeTouchEvent(104, 50)); // dx = 4
    expect(comp.isDragging()).toBeFalse();
  });

  it('onTouchMove returns early when vertical movement exceeds horizontal', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(100, 50));
    comp.onTouchMove(fakeTouchEvent(115, 80)); // dx=15, dy=30 — dy > dx
    expect(comp.isDragging()).toBeFalse();
  });

  it('onTouchMove returns early when on first page and swiping right (dx > 0, idx=0)', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/']);
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(100, 50));
    comp.onTouchMove(fakeTouchEvent(130, 52)); // dx=30 > 0 and idx=0
    expect(comp.isDragging()).toBeFalse();
  });

  it('onTouchMove sets isDragging and dragX when on a middle page and swiping left', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/players']); // idx = 2
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(300, 50));
    comp.onTouchMove(fakeTouchEvent(255, 52)); // dx=-45, dy=2 → horizontal drag
    expect(comp.isDragging()).toBeTrue();
    expect(comp.dragX()).toBe(-45);
  });

  it('onTouchMove returns early when URL is not in PAGE_ORDER (idx === -1)', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    const comp = asTestAccess(fixture.componentInstance);
    // Set already-dragging state so we skip the initiation guards
    comp.isDraggingHorizontal = true;
    // Trick the component into seeing an unmapped URL
    spyOnProperty(router, 'url', 'get').and.returnValue('/unknown-route');
    comp.onTouchStart(fakeTouchEvent(300, 50));
    comp.isDraggingHorizontal = true; // re-set after onTouchStart resets it
    comp.onTouchMove(fakeTouchEvent(255, 52)); // dx=-45 — would normally drag
    // isDragging should NOT be set because idx === -1 causes an early return
    expect(comp.isDragging()).toBeFalse();
  });

  it('onTouchMove returns early when on last page and swiping left (dx < 0, idx=last)', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/analytics']); // last page, idx=6
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(300, 50));
    comp.onTouchMove(fakeTouchEvent(255, 52)); // dx=-45 < 0 but idx=last
    expect(comp.isDragging()).toBeFalse();
  });

  // ── Touch gesture: onTouchEnd ──────────────────────────────────────────────

  it('onTouchEnd with skipGesture resets flag and returns', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = asTestAccess(fixture.componentInstance);
    comp.skipGesture = true;
    comp.onTouchEnd(fakeTouchEvent(100, 50));
    expect(comp.skipGesture).toBeFalse();
    expect(comp.dragX()).toBe(0);
  });

  it('onTouchEnd without horizontal drag resets dragX to 0', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const comp = asTestAccess(fixture.componentInstance);
    comp.isDraggingHorizontal = false;
    comp.dragX.set(30);
    comp.onTouchEnd(fakeTouchEvent(100, 50));
    expect(comp.dragX()).toBe(0);
  });

  it('onTouchEnd spring-backs when swipe is below width threshold', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/players']);
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(300, 50));
    comp.isDraggingHorizontal = true;
    // Small dx of 20px — well below innerWidth * 0.5
    comp.onTouchEnd({ changedTouches: [{ clientX: 320, clientY: 50 }] } as unknown as TouchEvent);
    expect(comp.dragX()).toBe(0);
  });

  it('onTouchEnd spring-backs when dy exceeds dx', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/players']);
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(300, 50));
    comp.isDraggingHorizontal = true;
    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    // dx=100 meets threshold but dy=200 > dx
    comp.onTouchEnd({ changedTouches: [{ clientX: 200, clientY: 250 }] } as unknown as TouchEvent);
    expect(comp.dragX()).toBe(0);
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  });

  it('onTouchEnd swipe left navigates to next page', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/']);
    const navigateSpy = spyOn(router, 'navigateByUrl').and.stub();
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(500, 50));
    comp.isDraggingHorizontal = true;
    // Ensure threshold is exceeded (innerWidth * 0.5)
    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    // dx = 10 - 500 = -490, threshold = 50 — dy=2 < |dx|
    comp.onTouchEnd({ changedTouches: [{ clientX: 10, clientY: 52 }] } as unknown as TouchEvent);
    expect(navigateSpy).toHaveBeenCalledWith('/server');
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  });

  it('onTouchEnd swipe right navigates to previous page', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/players']); // idx=2
    const navigateSpy = spyOn(router, 'navigateByUrl').and.stub();
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(10, 50));
    comp.isDraggingHorizontal = true;
    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    // dx = 500 - 10 = 490, threshold = 50 — dy=2 < dx
    comp.onTouchEnd({ changedTouches: [{ clientX: 500, clientY: 52 }] } as unknown as TouchEvent);
    expect(navigateSpy).toHaveBeenCalledWith('/server');
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  });

  it('onTouchEnd on last page swipe left does nothing (edge guard)', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/analytics']); // idx=6 (last)
    const navigateSpy = spyOn(router, 'navigateByUrl').and.stub();
    const comp = asTestAccess(fixture.componentInstance);
    comp.onTouchStart(fakeTouchEvent(500, 50));
    comp.isDraggingHorizontal = true;
    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    comp.onTouchEnd({ changedTouches: [{ clientX: 10, clientY: 52 }] } as unknown as TouchEvent);
    expect(navigateSpy).not.toHaveBeenCalled();
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  });

  it('onTouchEnd for unknown URL resets dragX', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    await router.navigate(['/']);
    const comp = asTestAccess(fixture.componentInstance);
    // Manually set touchStartX and dragging
    comp.onTouchStart(fakeTouchEvent(500, 50));
    comp.isDraggingHorizontal = true;
    // Trick the component into using an unmapped URL
    Object.defineProperty(router, 'url', { get: () => '/unknown-route', configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    comp.onTouchEnd({ changedTouches: [{ clientX: 10, clientY: 52 }] } as unknown as TouchEvent);
    expect(comp.dragX()).toBe(0);
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
  });
});

