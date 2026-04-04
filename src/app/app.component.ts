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
    this.touchStartX = e.touches[0].clientX;
    this.touchStartY = e.touches[0].clientY;
    this.isDraggingHorizontal = false;
  }

  onTouchMove(e: TouchEvent): void {
    const dx = e.touches[0].clientX - this.touchStartX;
    const dy = e.touches[0].clientY - this.touchStartY;

    if (!this.isDraggingHorizontal) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) return;
      this.isDraggingHorizontal = true;
    }

    const current = this.router.url.split('?')[0].split('#')[0];
    const idx = PAGE_ORDER.indexOf(current);
    if (idx === -1) return;
    if (dx > 0 && idx === 0) return;
    if (dx < 0 && idx === PAGE_ORDER.length - 1) return;

    this.isDragging.set(true);
    this.dragX.set(dx);
  }

  onTouchEnd(e: TouchEvent): void {
    const wasDragging = this.isDraggingHorizontal;
    this.isDragging.set(false);

    if (!wasDragging) {
      this.dragX.set(0);
      return;
    }

    const dx = e.changedTouches[0].clientX - this.touchStartX;
    const dy = e.changedTouches[0].clientY - this.touchStartY;
    const threshold = window.innerWidth * 0.5;

    if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) {
      // Didn't reach threshold — spring back
      this.dragX.set(0);
      return;
    }

    const current = this.router.url.split('?')[0].split('#')[0];
    const idx = PAGE_ORDER.indexOf(current);
    if (idx === -1) { this.dragX.set(0); return; }

    if (dx < 0 && idx < PAGE_ORDER.length - 1) {
      // Going forward: new page enters from the right
      this.dragX.set(0);
      this.enterFrom.set('right');
      this.router.navigateByUrl(PAGE_ORDER[idx + 1]);
    } else if (dx > 0 && idx > 0) {
      // Going backward: new page enters from the left
      this.dragX.set(0);
      this.enterFrom.set('left');
      this.router.navigateByUrl(PAGE_ORDER[idx - 1]);
    } else {
      this.dragX.set(0);
    }
  }
}
