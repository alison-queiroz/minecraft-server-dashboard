import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  RouterOutlet,
  Router,
  NavigationEnd,
  NavigationStart,
  NavigationCancel,
  NavigationError,
} from '@angular/router';
import { NavComponent } from './components/layout/nav/nav.component';
import { FooterComponent } from './components/layout/footer/footer.component';
import { SwipeNavigateModule } from './directives/swipe-navigate.module';
import { filter } from 'rxjs/operators';
import { SWIPE_ANIMATION_RESET_MS } from './constants/ui.constants';
import { LoadingService } from './services/loading/loading.service';
import { ThemeService } from './services/theme/theme.service';
import { LoadingIndicatorComponent } from './components/shared/loading-indicator/loading-indicator.component';

const PAGE_ORDER = ['/', '/server', '/players', '/profile', '/map', '/backups', '/analytics'];

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NavComponent, FooterComponent, SwipeNavigateModule, LoadingIndicatorComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  private readonly router = inject(Router);
  protected readonly loadingService = inject(LoadingService);
  protected readonly themeService = inject(ThemeService);
  protected readonly pageOrder = PAGE_ORDER;

  /** Live drag offset — follows the finger */
  protected readonly dragX = signal(0);
  /** True while finger is held down (no transition on the drag) */
  protected readonly isDragging = signal(false);
  /** Set just before navigation so the new page can slide in from the right direction */
  protected readonly enterFrom = signal<'left' | 'right' | null>(null);

  /**
   * True while a route is resolving (e.g. authGuard awaiting Firebase/Firestore).
   * Nothing renders under <router-outlet> during that window, so this drives a
   * placeholder in the main content area instead of a blank screen.
   */
  protected readonly routeLoading = signal(false);

  constructor() {
    // Clear slide-in class once animation completes
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      setTimeout(() => this.enterFrom.set(null), SWIPE_ANIMATION_RESET_MS);
    });

    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        this.routeLoading.set(true);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.routeLoading.set(false);
      }
    });
  }

  protected onDragXChange(value: number): void {
    this.dragX.set(value);
  }

  protected onDraggingChange(value: boolean): void {
    this.isDragging.set(value);
  }

  protected onNavigateDirection(direction: 'left' | 'right'): void {
    this.dragX.set(0);
    this.enterFrom.set(direction);
  }
}
