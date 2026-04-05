import { Component, provideZonelessChangeDetection } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { UiListItemComponent } from './ui-list-item.component';

@Component({
  standalone: true,
  imports: [UiListItemComponent],
  template: `
    <app-ui-list-item
      [showLeading]="true"
      [showSubtitle]="true"
      [showTrailing]="true"
      [interactive]="true">
      <span uiItemLeading>Icon</span>
      <span uiItemTitle>Player List</span>
      <span uiItemSubtitle>42 players registered</span>
      <span uiItemMeta>Meta</span>
      <span uiItemTrailing>Arrow</span>
    </app-ui-list-item>
  `,
})
class UiListItemHostComponent {}

describe('UiListItemComponent', () => {
  let fixture: ComponentFixture<UiListItemHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiListItemHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(UiListItemHostComponent);
    fixture.detectChanges();
  });

  it('renders projected slots', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Icon');
    expect(host.textContent).toContain('Player List');
    expect(host.textContent).toContain('42 players registered');
    expect(host.textContent).toContain('Arrow');
  });

  it('applies interactive class when enabled', () => {
    const host = fixture.nativeElement as HTMLElement;
    const item = host.querySelector('.ui-list-item');
    expect(item?.classList.contains('ui-list-item--interactive')).toBe(true);
  });
});
