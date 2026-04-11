import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Shared view-mode card layout for profile items (locations, homes).
 * Provides the card frame, name/badge header row, meta/actions/footer slots.
 *
 * Slot selectors for content projection:
 *   [appItemLeading]  — optional icon before the name
 *   [appItemMeta]     — secondary info line (description, coords, etc.)
 *   [appItemActions]  — action buttons on the right
 *   [appItemFooter]   — optional footer row below the main layout (e.g. map hash)
 */
@Component({
  selector: 'app-profile-item-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-item-card.component.html',
  styleUrls: ['./profile-item-card.component.scss'],
})
export class ProfileItemCardComponent {
  @Input({ required: true }) name!: string;
  @Input() isPublic = false;
}
