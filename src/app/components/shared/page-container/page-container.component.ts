import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Standard page-level wrapper that enforces a consistent max-width and
 * horizontal centering across all pages. Equivalent to:
 * `max-w-7xl mx-auto w-full pb-6`.
 *
 * Usage:
 *   <app-page-container>
 *     <!-- page content -->
 *   </app-page-container>
 */
@Component({
  selector: 'app-page-container',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content></ng-content>`,
  host: {
    class: 'block max-w-7xl mx-auto w-full pb-6',
  },
})
export class PageContainerComponent {}
