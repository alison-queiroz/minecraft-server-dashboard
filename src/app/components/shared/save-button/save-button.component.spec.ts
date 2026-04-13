import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { SaveButtonComponent } from './save-button.component';

describe('SaveButtonComponent', () => {
  let fixture: ComponentFixture<SaveButtonComponent>;
  let component: SaveButtonComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SaveButtonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SaveButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the label text by default', () => {
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.textContent?.trim()).toBe('Save');
  });

  it('renders a custom label', () => {
    fixture.componentRef.setInput('label', 'Update');
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.textContent?.trim()).toBe('Update');
  });

  it('emits save when clicked', () => {
    const spy = jest.spyOn(component.save, 'emit');
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    btn.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shows loadingLabel when saving is true', () => {
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.textContent?.trim()).toBe('Saving...');
  });

  it('shows custom loadingLabel when saving is true', () => {
    fixture.componentRef.setInput('saving', true);
    fixture.componentRef.setInput('loadingLabel', 'Please wait');
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.textContent?.trim()).toBe('Please wait');
  });

  it('disables button when saving is true', () => {
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')!;
    expect(btn.disabled).toBe(true);
  });

  it('button is enabled when not saving', () => {
    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')!;
    expect(btn.disabled).toBe(false);
  });

  it('applies compact class when compact is true', () => {
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.classList.contains('ui-button--compact')).toBe(true);
  });

  it('does not apply compact class by default', () => {
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.classList.contains('ui-button--compact')).toBe(false);
  });

  it('has type="button" to avoid accidental form submission', () => {
    const btn = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    expect(btn.getAttribute('type')).toBe('button');
  });
});
