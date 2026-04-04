import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Router, NavigationEnd } from '@angular/router';
import { NavComponent } from './components/layout/nav/nav.component';
import { FooterComponent } from './components/layout/footer/footer.component';
import { filter } from 'rxjs/operators';

const PAGE_ORDER = ['/', '/server', '/players', '/profile', '/map', '/backups', '/analytics'];

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NavComponent, FooterComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  private readonly router = inject(Router);
  private touchStartX = 0;
  private touchStartY = 0;
  private isDraggingHorizontal = false;
  /** True when the touch started on an input/textarea — skip the swipe gesture entirely */
  private skipGesture = false;

  /** Live drag offset — follows the finger */
  protected readonly dragX = signal(0);
  /** True while finger is held down (no transition on the drag) */
  protected readonly isDragging = signal(false);
  /** Set just before navigation so the new page can slide in from the right direction */
  protected readonly enterFrom = signal<'left' | 'right' | null>(null);

  constructor() {
    // Clear slide-in class once animation completes
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      setTimeout(() => this.enterFrom.set(null), 350);
    });
  }

  onTouchStart(e: TouchEvent): void {
    // Don't start a swipe when the user is interacting with an editable element
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) {
      this.skipGesture = true;
      return;
    }
    this.skipGesture = false;
    const touch = e.touches.item(0);
    if (!touch) return;
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.isDraggingHorizontal = false;
  }

  onTouchMove(e: TouchEvent): void {
    if (this.skipGesture) return;
    const touch = e.touches.item(0);
    if (!touch) return;
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;

    if (!this.isDraggingHorizontal) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      this.isDraggingHorizontal = true;
    }

    const [pathWithHash = ''] = this.router.url.split('?');
    const [current = ''] = pathWithHash.split('#');
    const idx = PAGE_ORDER.indexOf(current);
    if (idx === -1) return;
    if (dx > 0 && idx === 0) return;
    if (dx < 0 && idx === PAGE_ORDER.length - 1) return;

    this.isDragging.set(true);
    this.dragX.set(dx);
  }

  onTouchEnd(e: TouchEvent): void {
    if (this.skipGesture) { this.skipGesture = false; return; }
    const wasDragging = this.isDraggingHorizontal;
    this.isDragging.set(false);

    if (!wasDragging) {
      this.dragX.set(0);
      return;
    }

    const touch = e.changedTouches.item(0);
    if (!touch) return;
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;
    const threshold = window.innerWidth * 0.5;

    if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) {
      // Didn't reach threshold — spring back
      this.dragX.set(0);
      return;
    }

    const [pathWithHash = ''] = this.router.url.split('?');
    const [current = ''] = pathWithHash.split('#');
    const idx = PAGE_ORDER.indexOf(current);
    if (idx === -1) { this.dragX.set(0); return; }

    if (dx < 0 && idx < PAGE_ORDER.length - 1) {
      // Going forward: new page enters from the right
      this.dragX.set(0);
      this.enterFrom.set('right');
      const nextPath = PAGE_ORDER[idx + 1];
      if (!nextPath) return;
      this.router.navigateByUrl(nextPath);
    } else if (dx > 0 && idx > 0) {
      // Going backward: new page enters from the left
      this.dragX.set(0);
      this.enterFrom.set('left');
      const prevPath = PAGE_ORDER[idx - 1];
      if (!prevPath) return;
      this.router.navigateByUrl(prevPath);
    } else {
      this.dragX.set(0);
    }
  }
}
