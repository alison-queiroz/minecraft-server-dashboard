import { Directive, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SWIPE_COMMIT_RATIO, SWIPE_START_THRESHOLD_PX } from '../constants/ui.constants';

@Directive({
  selector: '[appSwipeNavigate]',
  standalone: true,
})
export class SwipeNavigateDirective {
  private readonly router = inject(Router);

  @Input() appSwipeNavigatePageOrder: readonly string[] = [];
  @Input() appSwipeNavigateCurrentIndex: number | null = null;
  @Input() appSwipeNavigateItemCount: number | null = null;
  @Input() appSwipeNavigateUseRouter = true;
  @Input() appSwipeNavigateStopPropagation = false;

  @Output() readonly dragXChange = new EventEmitter<number>();
  @Output() readonly draggingChange = new EventEmitter<boolean>();
  @Output() readonly navigateDirection = new EventEmitter<'left' | 'right'>();

  private touchStartX = 0;
  private touchStartY = 0;
  private isDraggingHorizontal = false;
  private skipGesture = false;

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent): void {
    this.skipGesture = this.startedOnEditableElement(event.target);
    if (this.skipGesture) {
      return;
    }

    const touch = event.touches.item(0);
    if (!touch) {
      return;
    }

    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.isDraggingHorizontal = false;
  }

  @HostListener('touchmove', ['$event'])
  onTouchMove(event: TouchEvent): void {
    if (this.skipGesture) {
      return;
    }

    const delta = this.getDelta(event.touches);
    if (!delta || !this.canContinueDrag(delta.dx, delta.dy)) {
      return;
    }

    const index = this.getCurrentIndex();
    if (!this.canDragForIndex(delta.dx, index)) {
      return;
    }

    if (this.appSwipeNavigateStopPropagation) {
      event.stopPropagation();
    }

    this.draggingChange.emit(true);
    this.dragXChange.emit(delta.dx);
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent): void {
    if (this.skipGesture) {
      this.skipGesture = false;
      return;
    }

    const wasDragging = this.isDraggingHorizontal;
    this.draggingChange.emit(false);
    if (!wasDragging) {
      this.resetDrag();
      return;
    }

    const delta = this.getDelta(event.changedTouches);
    if (!delta || !this.isSwipeCommitted(delta.dx, delta.dy)) {
      this.resetDrag();
      return;
    }

    const currentIndex = this.getCurrentIndex();
    if (currentIndex === -1) {
      this.resetDrag();
      return;
    }

    this.tryNavigate(delta.dx, currentIndex, event);
  }

  private startedOnEditableElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return !!target.closest('input, textarea, select, [contenteditable]');
  }

  private getDelta(touchList: TouchList): { dx: number; dy: number } | null {
    const touch = touchList.item(0);
    if (!touch) {
      return null;
    }
    return {
      dx: touch.clientX - this.touchStartX,
      dy: touch.clientY - this.touchStartY,
    };
  }

  private canContinueDrag(dx: number, dy: number): boolean {
    if (this.isDraggingHorizontal) {
      return true;
    }

    if (Math.abs(dx) < SWIPE_START_THRESHOLD_PX || Math.abs(dy) > Math.abs(dx)) {
      return false;
    }

    this.isDraggingHorizontal = true;
    return true;
  }

  private getCurrentIndex(): number {
    if (this.appSwipeNavigateCurrentIndex != null && this.appSwipeNavigateItemCount != null) {
      return this.appSwipeNavigateCurrentIndex;
    }

    const [pathWithHash = ''] = this.router.url.split('?');
    const [currentPath = ''] = pathWithHash.split('#');
    return this.appSwipeNavigatePageOrder.indexOf(currentPath);
  }

  private getItemCount(): number {
    if (this.appSwipeNavigateItemCount != null) {
      return this.appSwipeNavigateItemCount;
    }
    return this.appSwipeNavigatePageOrder.length;
  }

  private canDragForIndex(dx: number, index: number): boolean {
    if (index === -1) {
      return false;
    }

    if (dx > 0 && index === 0) {
      return false;
    }

    return !(dx < 0 && index === this.getItemCount() - 1);
  }

  private isSwipeCommitted(dx: number, dy: number): boolean {
    const threshold = window.innerWidth * SWIPE_COMMIT_RATIO;
    return Math.abs(dx) >= threshold && Math.abs(dy) <= Math.abs(dx);
  }

  private tryNavigate(dx: number, currentIndex: number, event: TouchEvent): void {
    if (dx < 0) {
      this.navigateToIndex(currentIndex + 1, 'right', event);
      return;
    }

    if (dx > 0) {
      this.navigateToIndex(currentIndex - 1, 'left', event);
      return;
    }

    this.resetDrag();
  }

  private navigateToIndex(index: number, direction: 'left' | 'right', event: TouchEvent): void {
    const targetPath = this.appSwipeNavigatePageOrder[index];
    this.resetDrag();

    const isInRange = index >= 0 && index < this.getItemCount();
    if (!isInRange) {
      return;
    }

    if (this.appSwipeNavigateStopPropagation) {
      event.stopPropagation();
    }

    this.navigateDirection.emit(direction);
    if (!this.appSwipeNavigateUseRouter) {
      return;
    }

    if (!targetPath) {
      return;
    }

    void this.router.navigateByUrl(targetPath);
  }

  private resetDrag(): void {
    this.dragXChange.emit(0);
  }
}
