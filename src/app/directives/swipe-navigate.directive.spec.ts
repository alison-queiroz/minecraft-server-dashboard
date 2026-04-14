import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { SwipeNavigateDirective } from './swipe-navigate.directive';

@Component({ standalone: true, template: '' })
class BlankComponent {}

@Component({
  standalone: true,
  imports: [SwipeNavigateDirective],
  template: '<div appSwipeNavigate [appSwipeNavigatePageOrder]="pageOrder"></div>',
})
class HostComponent {
  readonly pageOrder = ['/', '/server', '/players', '/profile', '/map', '/backups', '/analytics'];
}

function createTouchList(clientX: number, clientY: number): TouchList {
  const touch = { clientX, clientY } as Touch;
  return {
    0: touch,
    length: 1,
    item: (index: number) => (index === 0 ? touch : null),
    [Symbol.iterator]: function* (): Generator<Touch, void, unknown> {
      yield touch;
    },
  } as unknown as TouchList;
}

function fakeTouchEvent(clientX: number, clientY: number, target?: Element): TouchEvent {
  return {
    touches: createTouchList(clientX, clientY),
    changedTouches: createTouchList(clientX, clientY),
    target: target ?? document.createElement('div'),
  } as unknown as TouchEvent;
}

describe('SwipeNavigateDirective', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
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
  });

  function getDirectiveInstance(): SwipeNavigateDirective {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const debug = fixture.debugElement.query(By.directive(SwipeNavigateDirective));
    return debug.injector.get(SwipeNavigateDirective);
  }

  it('skips gestures that start on editable elements', () => {
    const directive = getDirectiveInstance();
    const input = document.createElement('input');
    const dragSpy = jest.fn();

    directive.dragXChange.subscribe(dragSpy);
    directive.onTouchStart(fakeTouchEvent(50, 50, input));
    directive.onTouchMove(fakeTouchEvent(150, 50));

    expect(dragSpy).not.toHaveBeenCalled();
  });

  it('emits drag updates for a horizontal swipe on middle pages', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/players']);

    const directive = getDirectiveInstance();
    const dragSpy = jest.fn();
    const draggingSpy = jest.fn();

    directive.dragXChange.subscribe(dragSpy);
    directive.draggingChange.subscribe(draggingSpy);

    directive.onTouchStart(fakeTouchEvent(300, 50));
    directive.onTouchMove(fakeTouchEvent(250, 52));

    expect(draggingSpy).toHaveBeenCalledWith(true);
    expect(dragSpy).toHaveBeenCalledWith(-50);
  });

  it('navigates forward on committed left swipe', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/']);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const directive = getDirectiveInstance();
    const directionSpy = jest.fn();

    directive.navigateDirection.subscribe(directionSpy);

    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    directive.onTouchStart(fakeTouchEvent(500, 50));
    directive.onTouchMove(fakeTouchEvent(300, 50));
    directive.onTouchEnd({ changedTouches: createTouchList(10, 52) } as unknown as TouchEvent);

    expect(directionSpy).toHaveBeenCalledWith('right');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/server');
  });

  it('does not navigate when swipe threshold is not met', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/players']);
    const navigateSpy = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const directive = getDirectiveInstance();
    const dragSpy = jest.fn();

    directive.dragXChange.subscribe(dragSpy);

    directive.onTouchStart(fakeTouchEvent(300, 50));
    directive.onTouchMove(fakeTouchEvent(280, 52));
    directive.onTouchEnd({ changedTouches: createTouchList(260, 52) } as unknown as TouchEvent);

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(dragSpy).toHaveBeenCalledWith(0);
  });

  it('resets skipGesture flag on touchend after an editable-element gesture', () => {
    const directive = getDirectiveInstance();
    const input = document.createElement('input');

    // Start on an editable element (skipGesture = true)
    directive.onTouchStart(fakeTouchEvent(50, 50, input));
    expect((directive as unknown as { skipGesture: boolean }).skipGesture).toBe(true);

    // touchend should clear the flag
    directive.onTouchEnd({ changedTouches: createTouchList(50, 50) } as unknown as TouchEvent);
    expect((directive as unknown as { skipGesture: boolean }).skipGesture).toBe(false);
  });

  it('resets drag and emits 0 on touchend when no horizontal drag occurred', () => {
    const directive = getDirectiveInstance();
    const dragSpy = jest.fn();
    directive.dragXChange.subscribe(dragSpy);

    // touchstart but NO touchmove → isDraggingHorizontal stays false
    directive.onTouchStart(fakeTouchEvent(300, 50));
    directive.onTouchEnd({ changedTouches: createTouchList(300, 50) } as unknown as TouchEvent);

    expect(dragSpy).toHaveBeenCalledWith(0);
  });

  it('emits direction without calling router.navigateByUrl when useRouter=false', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/']);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const debug = fixture.debugElement.query(By.directive(SwipeNavigateDirective));
    const directive = debug.injector.get(SwipeNavigateDirective);
    directive.appSwipeNavigateUseRouter = false;

    const directionSpy = jest.fn();
    directive.navigateDirection.subscribe(directionSpy);

    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    directive.onTouchStart(fakeTouchEvent(500, 50));
    directive.onTouchMove(fakeTouchEvent(300, 50));
    directive.onTouchEnd({ changedTouches: createTouchList(10, 52) } as unknown as TouchEvent);

    expect(directionSpy).toHaveBeenCalledWith('right');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('uses appSwipeNavigateCurrentIndex override when both index and itemCount are set', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const debug = fixture.debugElement.query(By.directive(SwipeNavigateDirective));
    const directive = debug.injector.get(SwipeNavigateDirective);
    directive.appSwipeNavigateCurrentIndex = 2;
    directive.appSwipeNavigateItemCount = 5;

    const idx = (directive as unknown as { getCurrentIndex(): number }).getCurrentIndex();
    expect(idx).toBe(2);
  });

  it('does not navigate when index is out of range (last page, swiping forward)', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/analytics']);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const directive = getDirectiveInstance();

    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    directive.onTouchStart(fakeTouchEvent(500, 50));
    directive.onTouchMove(fakeTouchEvent(300, 50));
    directive.onTouchEnd({ changedTouches: createTouchList(10, 52) } as unknown as TouchEvent);

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

});

// ── Additional coverage tests ─────────────────────────────────────────────

function createEmptyTouchList(): TouchList {
  return { length: 0, item: () => null } as unknown as TouchList;
}

@Component({
  standalone: true,
  imports: [SwipeNavigateDirective],
  template: '<div appSwipeNavigate [appSwipeNavigatePageOrder]="pageOrder"></div>',
})
class CoverageHostComponent {
  readonly pageOrder = ['/', '/server', '/players', '/profile', '/map', '/backups', '/analytics'];
}

describe('SwipeNavigateDirective — coverage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CoverageHostComponent],
      providers: [
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
  });

  function getHostEl(): { directive: SwipeNavigateDirective; el: HTMLElement } {
    const fixture = TestBed.createComponent(CoverageHostComponent);
    fixture.detectChanges();
    const debug = fixture.debugElement.query(By.directive(SwipeNavigateDirective));
    return { directive: debug.injector.get(SwipeNavigateDirective), el: debug.nativeElement as HTMLElement };
  }

  it('onTouchStart: does nothing when touches list has no items', () => {
    const { directive } = getHostEl();
    const dragSpy = jest.fn();
    directive.dragXChange.subscribe(dragSpy);

    directive.onTouchStart({
      touches: createEmptyTouchList(),
      target: document.createElement('div'),
    } as unknown as TouchEvent);
    directive.onTouchMove({ touches: createTouchList(200, 50) } as unknown as TouchEvent);

    expect(dragSpy).not.toHaveBeenCalled();
  });

  it('onTouchMove: skips when skipGesture is already true', () => {
    const { directive } = getHostEl();
    const dragSpy = jest.fn();
    directive.dragXChange.subscribe(dragSpy);

    (directive as unknown as { skipGesture: boolean }).skipGesture = true;
    directive.onTouchMove({ touches: createTouchList(100, 50) } as unknown as TouchEvent);

    expect(dragSpy).not.toHaveBeenCalled();
  });

  it('onTouchMove: stops when swipe is purely vertical (dy > dx)', () => {
    const { directive } = getHostEl();
    const dragSpy = jest.fn();
    directive.dragXChange.subscribe(dragSpy);

    directive.onTouchStart({ touches: createTouchList(100, 50), target: document.createElement('div') } as unknown as TouchEvent);
    directive.onTouchMove({ touches: createTouchList(101, 150) } as unknown as TouchEvent);

    expect(dragSpy).not.toHaveBeenCalled();
  });

  it('onTouchEnd: clears skipGesture flag via DOM event dispatch', () => {
    const { el, directive } = getHostEl();
    (directive as unknown as { skipGesture: boolean }).skipGesture = true;

    el.dispatchEvent(new TouchEvent('touchend', {
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: 50, clientY: 50 })],
    }));

    expect((directive as unknown as { skipGesture: boolean }).skipGesture).toBe(false);
  });

  it('onTouchEnd: resets drag when changedTouches is empty (null delta)', () => {
    const { directive } = getHostEl();
    const dragSpy = jest.fn();
    directive.dragXChange.subscribe(dragSpy);

    directive.onTouchStart({ touches: createTouchList(300, 50), target: document.createElement('div') } as unknown as TouchEvent);
    directive.onTouchMove({ touches: createTouchList(200, 50) } as unknown as TouchEvent);
    directive.onTouchEnd({ changedTouches: createEmptyTouchList() } as unknown as TouchEvent);

    expect(dragSpy).toHaveBeenCalledWith(0);
  });

  it('onTouchEnd: resets drag when currentIndex is -1 (page not in pageOrder)', async () => {
    const { directive } = getHostEl();
    directive.appSwipeNavigatePageOrder = [];
    const dragSpy = jest.fn();
    directive.dragXChange.subscribe(dragSpy);

    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    directive.onTouchStart({ touches: createTouchList(500, 50), target: document.createElement('div') } as unknown as TouchEvent);
    directive.onTouchMove({ touches: createTouchList(300, 50) } as unknown as TouchEvent);
    directive.onTouchEnd({ changedTouches: createTouchList(10, 52) } as unknown as TouchEvent);

    expect(dragSpy).toHaveBeenCalledWith(0);
  });

  it('navigateToIndex: calls event.stopPropagation when stopPropagation flag is true', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/']);
    jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const { directive } = getHostEl();
    directive.appSwipeNavigateStopPropagation = true;
    const stopSpy = jest.fn();

    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    directive.onTouchStart({ touches: createTouchList(500, 50), target: document.createElement('div') } as unknown as TouchEvent);
    directive.onTouchMove({ touches: createTouchList(300, 50), stopPropagation: jest.fn() } as unknown as TouchEvent);
    directive.onTouchEnd({ changedTouches: createTouchList(10, 52), stopPropagation: stopSpy } as unknown as TouchEvent);

    expect(stopSpy).toHaveBeenCalled();
  });

  it('canDragForIndex: blocks drag when index is -1 (not in page order)', async () => {
    const { directive } = getHostEl();
    directive.appSwipeNavigatePageOrder = [];
    const draggingSpy = jest.fn();
    directive.draggingChange.subscribe(draggingSpy);

    directive.onTouchStart({ touches: createTouchList(300, 50), target: document.createElement('div') } as unknown as TouchEvent);
    directive.onTouchMove({ touches: createTouchList(200, 50) } as unknown as TouchEvent);

    expect(draggingSpy).not.toHaveBeenCalledWith(true);
  });

  it('canDragForIndex: blocks right drag (dx>0) at first page (index 0)', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/']);

    const { directive } = getHostEl();
    const draggingSpy = jest.fn();
    directive.draggingChange.subscribe(draggingSpy);

    directive.onTouchStart({ touches: createTouchList(100, 50), target: document.createElement('div') } as unknown as TouchEvent);
    directive.onTouchMove({ touches: createTouchList(200, 50) } as unknown as TouchEvent);

    expect(draggingSpy).not.toHaveBeenCalledWith(true);
  });

  it('navigateToIndex: skips navigation when targetPath is undefined (pageOrder index out of bounds)', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/analytics']);
    const navigateSpy = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const { directive } = getHostEl();
    directive.appSwipeNavigateCurrentIndex = 5;
    directive.appSwipeNavigateItemCount = 6;

    Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });
    directive.onTouchStart({ touches: createTouchList(500, 50), target: document.createElement('div') } as unknown as TouchEvent);
    directive.onTouchMove({ touches: createTouchList(300, 50) } as unknown as TouchEvent);
    directive.onTouchEnd({ changedTouches: createTouchList(10, 52) } as unknown as TouchEvent);

    expect(navigateSpy).not.toHaveBeenCalled();
  });

});
