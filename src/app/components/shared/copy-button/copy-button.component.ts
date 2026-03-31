import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnDestroy,
  signal,
} from '@angular/core';
import { ActionButtonComponent } from '../action-button/action-button.component';

@Component({
  selector: 'app-copy-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActionButtonComponent],
  templateUrl: './copy-button.component.html',
  styleUrls: ['./copy-button.component.scss'],
})
export class CopyButtonComponent implements OnDestroy {
  @Input({ required: true }) value = '';
  @Input() idleLabel = 'Copy';
  @Input() copiedLabel = 'Copied!';

  protected readonly copied = signal(false);

  private resetTimeoutId: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }

  protected async copy(): Promise<void> {
    const value = this.value.trim();
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(true);
      if (this.resetTimeoutId) {
        clearTimeout(this.resetTimeoutId);
      }
      this.resetTimeoutId = setTimeout(() => {
        this.copied.set(false);
        this.resetTimeoutId = null;
      }, 2000);
    } catch {
      this.copied.set(false);
    }
  }
}
