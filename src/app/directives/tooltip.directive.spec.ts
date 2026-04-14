import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Component } from '@angular/core';
import type { DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
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

  it('text setter hides tooltip when set to empty string while tooltip is visible', () => {
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeTruthy();

    const dir = spanEl.injector.get(TooltipDirective);
    dir.text = '';
    expect(document.querySelector('.app-tooltip')).toBeNull();
  });
});




