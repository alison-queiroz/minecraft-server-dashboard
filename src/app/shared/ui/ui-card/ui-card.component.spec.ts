import { Component, provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { UiCardComponent } from './ui-card.component';

@Component({
  standalone: true,
  imports: [UiCardComponent],
  template: `
    <app-ui-card
      [showHeader]="showHeader"
      [showFooter]="showFooter"
      [interactive]="interactive">
      <h3 uiCardTitle>Card Title</h3>
      <p uiCardSubtitle>Card Subtitle</p>
      <button uiCardActions type="button">Action</button>
      <p>Card Body</p>
      <p uiCardFooter>Card Footer</p>
    </app-ui-card>
  `,
})
class UiCardHostComponent {
  showHeader = true;
  showFooter = true;
  interactive = true;
}

describe('UiCardComponent', () => {
  let fixture: ComponentFixture<UiCardHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiCardHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(UiCardHostComponent);
    fixture.detectChanges();
  });

  it('renders projected title, subtitle, and footer content', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Card Title');
    expect(host.textContent).toContain('Card Subtitle');
    expect(host.textContent).toContain('Card Body');
    expect(host.textContent).toContain('Card Footer');
  });

  it('applies interactive class when enabled', () => {
    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector('.ui-card');
    expect(card?.classList.contains('ui-card--interactive')).toBe(true);
  });
});
