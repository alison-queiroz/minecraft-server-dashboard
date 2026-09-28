import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Component } from '@angular/core';
import type { DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import type { MockInstance } from 'vitest';
import { TooltipDirective } from './tooltip.directive';

@Component({
  standalone: true,
  imports: [TooltipDirective],
  template: `<span [appTooltip]="'Hello world'" style="display:inline-block;width:40px;overflow:hidden">Hi</span>`,
})
class HostComponent {}

@Component({
  standalone: true,
  imports: [TooltipDirective],
  template: `<span [appTooltip]="tooltipText" style="display:inline-block;width:40px;overflow:hidden">Hi</span>`,
})
class DynamicHostComponent {
  tooltipText = 'Initial text';
}

/** Mirrors a player row: several tooltips side by side. */
@Component({
  standalone: true,
  imports: [TooltipDirective],
  template: `
    <span [appTooltip]="'Name'">A</span>
    <span [appTooltip]="'UUID'">B</span>
    <span [appTooltip]="'Dimension'">C</span>
  `,
})
class RowHostComponent {}

describe('TooltipDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let spanEl: DebugElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    spanEl = fixture.debugElement.query(By.directive(TooltipDirective));
  });

  afterEach(() => {
    document.querySelectorAll('.app-tooltip').forEach((el: Element) => el.remove());
    jest.useRealTimers();
  });

  it('shows tooltip on mouseenter', () => {
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeTruthy();
    expect(document.querySelector('.app-tooltip')?.textContent).toBe('Hello world');
  });

  it('hides tooltip on mouseleave', () => {
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeTruthy();

    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseleave'));
    expect(document.querySelector('.app-tooltip')).toBeNull();
  });

  it('shows tooltip after long press', () => {
    jest.useFakeTimers();
    const touchStart = new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 10, clientY: 10 })],
    });
    spanEl.nativeElement.dispatchEvent(touchStart);

    jest.advanceTimersByTime(600);

    expect(document.querySelector('.app-tooltip')).toBeTruthy();
  });

  it('keeps the tooltip visible after touchend until another target is pressed', () => {
    jest.useFakeTimers();
    const touchStart = new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 10, clientY: 10 })],
    });
    spanEl.nativeElement.dispatchEvent(touchStart);

    jest.advanceTimersByTime(600);
    spanEl.nativeElement.dispatchEvent(new TouchEvent('touchend'));
    jest.advanceTimersByTime(3000);

    expect(document.querySelector('.app-tooltip')).toBeTruthy();
  });

  it('does not show tooltip if touch moves before long-press threshold', () => {
    jest.useFakeTimers();
    const touchStart = new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 10, clientY: 10 })],
    });
    spanEl.nativeElement.dispatchEvent(touchStart);

    const touchMove = new TouchEvent('touchmove', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 100, clientY: 10 })],
    });
    spanEl.nativeElement.dispatchEvent(touchMove);

    jest.advanceTimersByTime(600);

    expect(document.querySelector('.app-tooltip')).toBeNull();
  });

  it('does not create tooltip if text is empty', () => {
    const dir = spanEl.injector.get(TooltipDirective);
    dir.text = '';
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeNull();
  });

  it('hides the tooltip when another element is pressed', () => {
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeTruthy();

    const otherButton = document.createElement('button');
    document.body.appendChild(otherButton);

    otherButton.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(document.querySelector('.app-tooltip')).toBeNull();
    otherButton.remove();
  });

  it('updates visible tooltip text when the input changes', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [DynamicHostComponent] }).compileComponents();

    const dynamicFixture = TestBed.createComponent(DynamicHostComponent);
    dynamicFixture.detectChanges();

    const dynamicSpan = dynamicFixture.debugElement.query(By.directive(TooltipDirective));
    dynamicSpan.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));

    expect(document.querySelector('.app-tooltip')?.textContent).toBe('Initial text');

    dynamicFixture.componentInstance.tooltipText = 'Updated text';
    dynamicFixture.detectChanges();

    expect(document.querySelector('.app-tooltip')?.textContent).toBe('Updated text');
  });

  it('shows tooltip on focus and hides on blur', () => {
    spanEl.nativeElement.dispatchEvent(new FocusEvent('focus'));
    expect(document.querySelector('.app-tooltip')).toBeTruthy();

    spanEl.nativeElement.dispatchEvent(new FocusEvent('blur'));
    expect(document.querySelector('.app-tooltip')).toBeNull();
  });

  it('cancels long-press and hides tooltip on touchcancel', () => {
    jest.useFakeTimers();
    const touchStart = new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 10, clientY: 10 })],
    });
    spanEl.nativeElement.dispatchEvent(touchStart);
    jest.advanceTimersByTime(600);
    expect(document.querySelector('.app-tooltip')).toBeTruthy();

    spanEl.nativeElement.dispatchEvent(new TouchEvent('touchcancel'));
    expect(document.querySelector('.app-tooltip')).toBeNull();
  });

  it('hides tooltip on pointerdown when target is not a Node instance', () => {
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeTruthy();

    // Create a PointerEvent whose target is not a Node (simulated by an object that is not a Node)
    const fakeEvent = { target: {} } as unknown as PointerEvent;
    const dir = spanEl.injector.get(TooltipDirective);
    dir.onDocumentPointerDown(fakeEvent);

    expect(document.querySelector('.app-tooltip')).toBeNull();
  });

  it('does not hide tooltip on pointerdown when the host element is the target', () => {
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeTruthy();

    spanEl.nativeElement.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    // Clicking the host itself should NOT hide the tooltip
    expect(document.querySelector('.app-tooltip')).toBeTruthy();
  });
  it('onTouchStart: does nothing (no timer) when touches list is empty', () => {
    jest.useFakeTimers();
    // TouchEvent with empty touches array — e.touches[0] is undefined → guard returns
    spanEl.nativeElement.dispatchEvent(new TouchEvent('touchstart', { touches: [] }));
    jest.advanceTimersByTime(600);
    expect(document.querySelector('.app-tooltip')).toBeNull();
  });

  it('onTouchMove: cancels nothing and does not throw when touches list is empty', () => {
    jest.useFakeTimers();
    // Start a valid long press
    spanEl.nativeElement.dispatchEvent(new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 10, clientY: 10 })],
    }));
    // touchmove with no touches — e.touches[0] is undefined → guard returns without cancelling
    expect(() => {
      spanEl.nativeElement.dispatchEvent(new TouchEvent('touchmove', { touches: [] }));
    }).not.toThrow();
    jest.advanceTimersByTime(600);
    expect(document.querySelector('.app-tooltip')).toBeTruthy();
  });

  it('registers its long-press touchstart/touchmove listeners as passive', async () => {
    const addSpy = jest.spyOn(HTMLElement.prototype, 'addEventListener');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const host = f.debugElement.query(By.directive(TooltipDirective)).nativeElement as HTMLElement;

    const passiveOnHost = (type: string): boolean => addSpy.mock.calls.some(([name, , options], i) =>
      addSpy.mock.contexts[i] === host && name === type && typeof options === 'object' && options.passive === true);
    expect(passiveOnHost('touchstart')).toBe(true);
    expect(passiveOnHost('touchmove')).toBe(true);
    addSpy.mockRestore();
  });

  it('stops reacting to touches once destroyed', () => {
    jest.useFakeTimers();
    const host = spanEl.nativeElement as HTMLElement;
    fixture.destroy();

    host.dispatchEvent(new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: host, clientX: 10, clientY: 10 })],
    }));
    jest.advanceTimersByTime(600);

    expect(document.querySelector('.app-tooltip')).toBeNull();
  });

  it('text setter hides tooltip when set to empty string while tooltip is visible', () => {
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeTruthy();

    const dir = spanEl.injector.get(TooltipDirective);
    dir.text = '';
    expect(document.querySelector('.app-tooltip')).toBeNull();
  });
});

describe('TooltipDirective shared outside-press listener', () => {
  let addSpy: MockInstance<typeof document.addEventListener>;
  let removeSpy: MockInstance<typeof document.removeEventListener>;

  const pointerdownCalls = (spy: MockInstance<typeof document.addEventListener>): number =>
    spy.mock.calls.filter(([type]) => type === 'pointerdown').length;

  function renderRow() {
    const fixture = TestBed.createComponent(RowHostComponent);
    fixture.detectChanges();
    const spans = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span'));
    return { fixture, spans };
  }

  beforeEach(async () => {
    addSpy = jest.spyOn(document, 'addEventListener');
    removeSpy = jest.spyOn(document, 'removeEventListener');
    await TestBed.configureTestingModule({ imports: [RowHostComponent] }).compileComponents();
  });

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
    document.querySelectorAll('.app-tooltip').forEach((el: Element) => el.remove());
  });

  it('adds no document listener per instance while every tooltip is hidden', () => {
    renderRow();
    expect(pointerdownCalls(addSpy)).toBe(0);
  });

  it('uses one shared listener for all visible tooltips and drops it once they all hide', () => {
    const { spans } = renderRow();
    spans[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    spans[1]?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelectorAll('.app-tooltip').length).toBe(2);
    expect(pointerdownCalls(addSpy)).toBe(1);

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    outside.remove();

    expect(document.querySelectorAll('.app-tooltip').length).toBe(0);
    expect(pointerdownCalls(removeSpy)).toBe(1);
  });

  it('keeps a tooltip open when its own host is pressed, closing only the others', () => {
    const { spans } = renderRow();
    spans[0]?.dispatchEvent(new MouseEvent('mouseenter'));
    spans[1]?.dispatchEvent(new MouseEvent('mouseenter'));

    spans[0]?.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    const open = Array.from(document.querySelectorAll('.app-tooltip')).map(el => el.textContent);
    expect(open).toEqual(['Name']);
    expect(pointerdownCalls(removeSpy)).toBe(0);
  });

  it('releases the shared listener when a visible tooltip is destroyed', () => {
    const { fixture, spans } = renderRow();
    spans[2]?.dispatchEvent(new MouseEvent('mouseenter'));

    fixture.destroy();

    expect(document.querySelector('.app-tooltip')).toBeNull();
    expect(pointerdownCalls(removeSpy)).toBe(1);
  });
});




