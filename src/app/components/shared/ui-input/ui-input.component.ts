import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type UiInputAccent = 'emerald' | 'blue' | 'orange';

@Component({
  selector: 'app-ui-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      class="ui-input"
      [class.focus-accent-blue]="accent() === 'blue'"
      [class.focus-accent-orange]="accent() === 'orange'"
      [type]="type()"
      [value]="value()"
      [placeholder]="placeholder()"
      [attr.maxlength]="maxlength() ?? null"
      [attr.list]="list() ?? null"
      [attr.autocomplete]="autocomplete() ?? null"
      [attr.readonly]="readonly() ? '' : null"
      (input)="valueChange.emit($any($event.target).value)"
    />
  `,
  styles: [`
    :host { display: contents; }
    .focus-accent-blue:focus { border-color: rgb(96 165 250); }
    .focus-accent-orange:focus { border-color: rgb(251 146 60); }
  `],
})
export class UiInputComponent {
  readonly type = input<string>('text');
  readonly value = input<string>('');
  readonly placeholder = input('');
  readonly maxlength = input<number | null>(null);
  readonly list = input<string | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly readonly = input(false);
  readonly accent = input<UiInputAccent>('emerald');
  readonly valueChange = output<string>();
}
