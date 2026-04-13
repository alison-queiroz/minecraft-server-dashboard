import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { CancelButtonComponent } from './cancel-button.component';

describe('CancelButtonComponent', () => {
  let fixture: ComponentFixture<CancelButtonComponent>;
  let component: CancelButtonComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CancelButtonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CancelButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a button with text "Cancel"', () => {
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button');
    expect(btn?.textContent?.trim()).toBe('Cancel');
  });

  it('emits cancelled when clicked', () => {
    const spy = jest.spyOn(component.cancelled, 'emit');
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('applies compact styles when compact is true', () => {
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.classList.contains('ui-button--compact')).toBe(true);
  });

  it('does not apply compact styles by default', () => {
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.classList.contains('ui-button--compact')).toBe(false);
  });

  it('has type="button" to avoid accidental form submission', () => {
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.getAttribute('type')).toBe('button');
  });
});
