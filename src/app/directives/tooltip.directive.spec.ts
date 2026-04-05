import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
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
    document.querySelectorAll('.app-tooltip').forEach(el => el.remove());
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

  it('shows tooltip after long press', (done) => {
    const touchStart = new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 10, clientY: 10 })],
    });
    spanEl.nativeElement.dispatchEvent(touchStart);

    setTimeout(() => {
      expect(document.querySelector('.app-tooltip')).toBeTruthy();
      done();
    }, 600);
  });

  it('does not show tooltip if touch moves before long-press threshold', (done) => {
    const touchStart = new TouchEvent('touchstart', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 10, clientY: 10 })],
    });
    spanEl.nativeElement.dispatchEvent(touchStart);

    const touchMove = new TouchEvent('touchmove', {
      touches: [new Touch({ identifier: 1, target: spanEl.nativeElement, clientX: 100, clientY: 10 })],
    });
    spanEl.nativeElement.dispatchEvent(touchMove);

    setTimeout(() => {
      expect(document.querySelector('.app-tooltip')).toBeNull();
      done();
    }, 600);
  });

  it('does not create tooltip if text is empty', () => {
    const cmp = fixture.componentInstance as unknown as Record<string, unknown>;
    Object.assign(cmp, {}); // keep type checker happy
    // Manually set the directive text to empty
    const dir = spanEl.injector.get(TooltipDirective);
    dir.text = '';
    spanEl.nativeElement.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.app-tooltip')).toBeNull();
  });
});
