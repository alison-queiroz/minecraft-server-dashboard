import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';

type ActionButtonVariant = 'primary' | 'secondary' | 'blue' | 'orange' | 'copy' | 'copied';

@Component({
  selector: 'app-action-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './action-button.component.html',
  styleUrls: ['./action-button.component.scss'],
})
export class ActionButtonComponent {
  @Input() label = '';
  @Input() disabled = false;
  @Input() variant: ActionButtonVariant = 'primary';
  @Input() compact = false;
  @Input() uppercase = false;
  /** Optional stable hook for e2e/unit tests, rendered as data-testid. */
  @Input() testId: string | null = null;

  @Output() readonly pressed = new EventEmitter<void>();

  protected handleClick(): void {
    if (!this.disabled) {
      this.pressed.emit();
    }
  }
}
