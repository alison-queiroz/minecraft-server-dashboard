import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Shimmering placeholder shown in the main content area while a route's chunk
 * and component load. Mirrors the dashboard's card layout (a hero banner plus
 * two columns of cards) so the transition reads as "content arriving" instead
 * of a bare spinner. Purely decorative — exposed as an aria-busy status region.
 */
@Component({
  selector: 'app-card-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './card-skeleton.component.html',
  styleUrls: ['./card-skeleton.component.scss'],
})
export class CardSkeletonComponent {
  /** Placeholder card counts per column, matching the home dashboard shape. */
  protected readonly leftCards = [0, 1, 2];
  protected readonly rightCards = [0, 1];
}
