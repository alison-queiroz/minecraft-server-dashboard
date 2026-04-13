import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-cancel-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button"
      class="ui-button ui-button--secondary"
      [class.ui-button--compact]="compact()"
      (click)="cancelled.emit()">
      Cancel
    </button>
  `,
  styles: [`.ui-button--compact { padding: 0.375rem 0.75rem; font-size: 0.75rem; }`],
})
export class CancelButtonComponent {
  readonly compact = input(false);
  readonly cancelled = output<void>();
}
