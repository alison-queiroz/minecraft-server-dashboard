import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-ui-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="ui-toggle">
      <div class="ui-toggle__control">
        <input type="checkbox" class="ui-toggle__input"
          [checked]="checked()"
          (change)="checkedChange.emit($any($event.target).checked)" />
        <div class="ui-toggle__track"></div>
        <div class="ui-toggle__thumb"></div>
      </div>
      <span class="ui-toggle__text">
        {{ label() }}
        @if (note()) {
          <span class="ui-toggle__note">{{ note() }}</span>
        }
      </span>
    </label>
  `,
  styles: [`
    :host { display: contents; }
    .ui-toggle__note {
      font-size: 0.75rem;
      color: rgb(113 113 122);
    }
  `],
})
export class UiToggleComponent {
  readonly checked = input(false);
  readonly label = input('');
  readonly note = input('');
  readonly checkedChange = output<boolean>();
}
