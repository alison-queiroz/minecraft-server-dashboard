import type { ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiStatItemComponent } from './ui-stat-item.component';

describe('UiStatItemComponent', () => {
  let fixture: ComponentFixture<UiStatItemComponent>;
  let component: UiStatItemComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiStatItemComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(UiStatItemComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Players');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders fallback value when no projected value exists', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Players');
    expect(host.textContent).toContain('—');
  });

  it('applies right alignment class', () => {
    fixture.componentRef.setInput('align', 'right');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const stat = host.querySelector('.ui-stat-item');
    expect(stat?.classList.contains('ui-stat-item--right')).toBe(true);
  });
});
