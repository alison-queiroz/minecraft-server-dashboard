import { ChangeDetectionStrategy, Component, OnDestroy, Type, computed, inject, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { NgComponentOutlet } from '@angular/common';
import { NavComponent } from './components/layout/nav/nav.component';
import { FooterComponent } from './components/layout/footer/footer.component';
import { SwipeNavigateModule } from './directives/swipe-navigate.module';
import { filter } from 'rxjs/operators';
import { SWIPE_ANIMATION_RESET_MS } from './constants/ui.constants';
import { LoadingService } from './services/loading/loading.service';
import { ThemeService } from './services/theme/theme.service';

const PAGE_ORDER = ['/', '/server', '/players', '/profile', '/map', '/backups', '/analytics'];
/** How long to keep the preview in DOM after drag ends so the spring-back animation plays (ms) */
const PREVIEW_CLEAR_DELAY_MS = 300;

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NavComponent, FooterComponent, SwipeNavigateModule, NgComponentOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnDestroy {
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
   * When the navigation came from a committed drag with an active preview, this holds the
   * pixel offset (translateX) where the preview was on screen when the finger lifted.
   * The slide-in animation starts from this position rather than from ±100vw.
   */
  protected readonly enterFromX = signal<number | null>(null);
  /** Resolved component type rendered as the drag-peek preview layer */
  protected readonly previewComponentType = signal<Type<unknown> | null>(null);
  /** translateX origin (px) that positions the preview off-screen before/after drag */
  protected readonly previewOrigin = signal<number>(0);
  /** CSS transform applied to the preview layer during drag */
  protected readonly previewTransform = computed(
    () => `translateX(${this.previewOrigin() + this.dragX()}px)`,
  );

  private previewClearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Clear slide-in class once animation completes
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      setTimeout(() => {
        this.enterFrom.set(null);
        this.enterFromX.set(null);
      }, SWIPE_ANIMATION_RESET_MS);
    });
  }

  ngOnDestroy(): void {
    if (this.previewClearTimer !== null) {
      clearTimeout(this.previewClearTimer);
    }
  }

  protected onDragXChange(value: number): void {
    this.dragX.set(value);
  }

  protected onDraggingChange(value: boolean): void {
    this.isDragging.set(value);
  }

  protected onNavigateDirection(direction: 'left' | 'right'): void {
    const hadPreview = this.previewComponentType() !== null;
    if (hadPreview) {
      // Capture where the preview was on screen when the finger lifted.
      // navigateDirection fires BEFORE resetDrag, so dragX and previewOrigin still hold
      // the committed values. We use this as the CSS animation start so the new page
      // continues from where the drag left off instead of restarting from ±100vw.
      this.enterFromX.set(this.previewOrigin() + this.dragX());
    } else {
      this.enterFromX.set(null);
    }
    this.enterFrom.set(direction);
    // dragX and previewComponentType are reset by resetDrag() (called right after
    // navigateDirection.emit in the directive), so no need to touch them here.
    this.clearPreviewNow();
  }

  protected onPreviewIndexChange(index: number | null): void {
    if (this.previewClearTimer !== null) {
      clearTimeout(this.previewClearTimer);
      this.previewClearTimer = null;
    }

    if (index === null) {
      // Keep preview in DOM until the spring-back animation finishes, then remove it
      this.previewClearTimer = setTimeout(() => {
        this.previewComponentType.set(null);
        this.previewOrigin.set(0);
        this.previewClearTimer = null;
      }, PREVIEW_CLEAR_DELAY_MS);
      return;
    }

    const path = this.pageOrder[index];
    if (!path) return;

    // Position the preview off-screen on the correct side before the component loads
    const currentUrl = this.router.url.split('?')[0].split('#')[0];
    const currentIndex = this.pageOrder.indexOf(currentUrl);
    const origin = index > currentIndex ? window.innerWidth : -window.innerWidth;
    this.previewOrigin.set(origin);

    // Trigger lazy-load and render the preview component
    void this.loadPreviewComponent(path).then(type => {
      if (type !== null && this.previewOrigin() === origin) {
        this.previewComponentType.set(type);
      }
    });
  }

  private clearPreviewNow(): void {
    if (this.previewClearTimer !== null) {
      clearTimeout(this.previewClearTimer);
      this.previewClearTimer = null;
    }
    this.previewComponentType.set(null);
    this.previewOrigin.set(0);
  }

  private async loadPreviewComponent(path: string): Promise<Type<unknown> | null> {
    const routePath = path === '/' ? '' : path.replace(/^\//, '');
    const route = this.router.config.find(r => r.path === routePath);
    if (!route?.loadComponent) return null;
    const loaded: unknown = await route.loadComponent();
    if (typeof loaded === 'function') return loaded as Type<unknown>;
    if (loaded !== null && typeof loaded === 'object' && 'default' in loaded && typeof (loaded as Record<string, unknown>)['default'] === 'function') {
      return (loaded as Record<string, unknown>)['default'] as Type<unknown>;
    }
    return null;
  }
}
