import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-save-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button"
      class="ui-button ui-button--primary"
      [class.ui-button--compact]="compact()"
      [disabled]="saving()"
      (click)="save.emit()">
      {{ saving() ? loadingLabel() : label() }}
    </button>
  `,
  styles: [`.ui-button--compact { padding: 0.375rem 0.75rem; font-size: 0.75rem; }`],
})
export class SaveButtonComponent {
  readonly saving = input(false);
  readonly label = input('Save');
  readonly loadingLabel = input('Saving...');
  readonly compact = input(false);
  readonly save = output<void>();
}
