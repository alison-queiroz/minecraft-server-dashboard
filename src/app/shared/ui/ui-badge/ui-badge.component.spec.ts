import type { ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiBadgeComponent } from './ui-badge.component';

describe('UiBadgeComponent', () => {
  let fixture: ComponentFixture<UiBadgeComponent>;
  let component: UiBadgeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiBadgeComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(UiBadgeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('sets host attributes from signal inputs', () => {
    fixture.componentRef.setInput('variant', 'success');
    fixture.componentRef.setInput('size', 'sm');
    fixture.componentRef.setInput('appearance', 'solid');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('data-variant')).toBe('success');
    expect(host.getAttribute('data-size')).toBe('sm');
    expect(host.getAttribute('data-appearance')).toBe('solid');
  });
});
