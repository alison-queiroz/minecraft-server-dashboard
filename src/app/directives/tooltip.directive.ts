import { DOCUMENT } from '@angular/common';
import type { OnDestroy } from '@angular/core';
import { Directive, ElementRef, HostListener, Input, inject } from '@angular/core';

const LONG_PRESS_DELAY_MS = 500;

@Directive({
  selector: '[appTooltip]',
  standalone: true,
})
export class TooltipDirective implements OnDestroy {
  @Input('appTooltip')
  set text(value: string) {
    this.tooltipText = value;

    if (!this.tooltipEl) {
      return;
    }

    if (!this.tooltipText) {
      this.hide();
      return;
    }

    this.tooltipEl.textContent = this.tooltipText;
  }

  get text(): string {
    return this.tooltipText;
  }

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private tooltipEl: HTMLDivElement | null = null;
  private tooltipText = '';
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;

  // ── Desktop hover + keyboard focus ───────────────────────────────────────
  @HostListener('mouseenter') onMouseEnter(): void {
    this.show();
  }

  @HostListener('mouseleave') onMouseLeave(): void {
    this.hide();
  }

  @HostListener('focus') onFocus(): void {
    this.show();
  }

  @HostListener('blur') onBlur(): void {
    this.hide();
  }

  @HostListener('document:pointerdown', ['$event']) onDocumentPointerDown(event: PointerEvent): void {
    if (!this.tooltipEl) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      this.hide();
      return;
    }

    if (this.el.nativeElement.contains(target) || this.tooltipEl.contains(target)) {
      return;
    }

    this.hide();
  }

  // ── Mobile long press ─────────────────────────────────────────────────────
  @HostListener('touchstart', ['$event']) onTouchStart(e: TouchEvent): void {
    const touch = e.touches[0];
    if (!touch) return;
    this.startX = touch.clientX;
    this.startY = touch.clientY;

    this.longPressTimer = setTimeout(() => {
      this.show();
    }, LONG_PRESS_DELAY_MS);
  }

  @HostListener('touchmove', ['$event']) onTouchMove(e: TouchEvent): void {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = Math.abs(touch.clientX - this.startX);
    const dy = Math.abs(touch.clientY - this.startY);
    if (dx > 8 || dy > 8) {
      this.cancelLongPress();
    }
  }

  @HostListener('touchend') onTouchEnd(): void {
    this.cancelLongPress();
  }

  @HostListener('touchcancel') onTouchCancel(): void {
    this.cancelLongPress();
    this.hide();
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private show(): void {
    if (!this.tooltipText) return;
    this.hide();

    const tooltip = document.createElement('div');
    tooltip.className = 'app-tooltip';
    tooltip.textContent = this.tooltipText;
    this.document.body.appendChild(tooltip);
    this.tooltipEl = tooltip;

    const rect = this.el.nativeElement.getBoundingClientRect();
    const gap = 6;
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.top - gap}px`;
    tooltip.style.transform = 'translate(-50%, -100%)';
  }

  private hide(): void {
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }

  ngOnDestroy(): void {
    this.cancelLongPress();
    this.hide();
  }
}
