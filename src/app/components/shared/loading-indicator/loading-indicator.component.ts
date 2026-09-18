import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Shared spinner + label used for the Angular-side loading states (route
 * transitions, guards, etc). Visually mirrors the static boot splash in
 * index.html, which can't use this component because it renders before
 * Angular has bootstrapped — keep the two in sync by eye if this changes.
 */
@Component({
  selector: 'app-loading-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './loading-indicator.component.html',
  styleUrls: ['./loading-indicator.component.scss'],
})
export class LoadingIndicatorComponent {
  readonly label = input<string | null>(null);
}
