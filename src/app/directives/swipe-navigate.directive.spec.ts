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
    [Symbol.iterator]: function* () {
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
    const dragSpy = jasmine.createSpy('dragX');

    directive.dragXChange.subscribe(dragSpy);
    directive.onTouchStart(fakeTouchEvent(50, 50, input));
    directive.onTouchMove(fakeTouchEvent(150, 50));

    expect(dragSpy).not.toHaveBeenCalled();
  });

  it('emits drag updates for a horizontal swipe on middle pages', async () => {
    const router = TestBed.inject(Router);
    await router.navigate(['/players']);

    const directive = getDirectiveInstance();
    const dragSpy = jasmine.createSpy('dragX');
    const draggingSpy = jasmine.createSpy('dragging');

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
    spyOn(router, 'navigateByUrl').and.resolveTo(true);

    const directive = getDirectiveInstance();
    const directionSpy = jasmine.createSpy('direction');

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
    const navigateSpy = spyOn(router, 'navigateByUrl').and.resolveTo(true);

    const directive = getDirectiveInstance();
    const dragSpy = jasmine.createSpy('dragX');

    directive.dragXChange.subscribe(dragSpy);

    directive.onTouchStart(fakeTouchEvent(300, 50));
    directive.onTouchMove(fakeTouchEvent(280, 52));
    directive.onTouchEnd({ changedTouches: createTouchList(260, 52) } as unknown as TouchEvent);

    expect(navigateSpy).not.toHaveBeenCalled();
    expect(dragSpy).toHaveBeenCalledWith(0);
  });
});
